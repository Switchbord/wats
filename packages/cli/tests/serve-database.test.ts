// WATS-204: opt-in durable persistence for `wats serve`.
//
// Battery scope (CLI-owned):
//   - `--database <sqlite-path>` opens+migrates a SQLite store before binding,
//     injects it into the synthetic (dry-run) and real (live) service configs,
//     and closes it on startup/bind failure and shutdown.
//   - `--database-url-env <env-name>` is an optional safe env-NAME reference
//     for PostgreSQL (no raw DSN ever on the command line). Mutually exclusive
//     with `--database`.
//   - Default (no persistence flags) is byte-identical stateless behavior.
//   - Graceful finite drain: async shutdown () => void | Promise<void>; the
//     bin awaits it; server.stop(false) stops admission and drains active
//     work, default 10s timeout force-stops, the store closes AFTER active
//     work, repeated stop is idempotent.
//
// These tests spawn the REAL built CLI binary as a Bun child process and
// assert against actual PIDs, real HTTP readiness, real request drain, real
// SQLite files on disk, and real restart-survival of metadata/history.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type JsonRecord = Record<string, unknown>;
type ServeProcess = ReturnType<typeof Bun.spawn>;

const SENTINELS = [
  "WATS_ACCESS_TOKEN",
  "WATS_VERIFY_TOKEN",
  "WATS_APP_SECRET",
  "WATS_SERVICE_TOKEN",
  "WATS_WEBHOOK_VERIFY_TOKEN",
  "WATS_WEBHOOK_APP_SECRET",
  "WATS_SERVICE_BEARER_TOKEN",
  "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
  "APP_SECRET_DO_NOT_PRINT",
  "raw-service-bearer-token-do-not-print",
  "LIVE_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
  "LIVE_VERIFY_TOKEN_DO_NOT_PRINT",
  "LIVE_APP_SECRET_DO_NOT_PRINT",
  "LIVE_SERVICE_TOKEN_DO_NOT_PRINT",
  "FILE_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
  "FILE_VERIFY_TOKEN_DO_NOT_PRINT",
  "FILE_APP_SECRET_DO_NOT_PRINT",
  "FILE_SERVICE_TOKEN_DO_NOT_PRINT",
  "../../.env.local"
] as const;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      if (isJsonRecord(manifest) && manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);
const entrypoint = join(repoRoot, "packages/cli/dist/bin.js");

function runCli(args: readonly string[], cwd: string = repoRoot, env: Record<string, string | undefined> = {}): CliResult {
  const bunPath = process.execPath ?? "bun";
  const completed = Bun.spawnSync([bunPath, entrypoint, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WATS_ACCESS_TOKEN: "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
      WATS_APP_SECRET: "APP_SECRET_DO_NOT_PRINT",
      WATS_SERVICE_TOKEN: "raw-service-bearer-token-do-not-print",
      ...env
    }
  });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

function spawnServe(
  args: readonly string[],
  env: Record<string, string | undefined> = {}
): { proc: ServeProcess; stdout: Promise<string>; stderr: Promise<string> } {
  const bunPath = process.execPath ?? "bun";
  const proc = Bun.spawn([bunPath, entrypoint, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WATS_ACCESS_TOKEN: "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
      WATS_APP_SECRET: "APP_SECRET_DO_NOT_PRINT",
      WATS_SERVICE_TOKEN: "raw-service-bearer-token-do-not-print",
      ...env
    }
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  return { proc, stdout, stderr };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wats-cli-serve-db-"));
}

function validConfig(overrides: Partial<JsonRecord> = {}): JsonRecord {
  const profile = {
    graph: { apiVersion: "v25.0", baseUrl: "https://graph.facebook.com" },
    whatsapp: { wabaId: "123456789012345", phoneNumberId: "15551234567" },
    auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
    webhook: {
      path: "/webhooks/whatsapp",
      verifyToken: { env: "WATS_VERIFY_TOKEN" },
      appSecret: { env: "WATS_APP_SECRET" },
      maxBodyBytes: 1048576
    },
    service: {
      host: "127.0.0.1",
      port: 8787,
      apiPrefix: "/api",
      bearerToken: { env: "WATS_SERVICE_TOKEN" }
    }
  } satisfies JsonRecord;

  return {
    version: 1,
    defaultProfile: "local",
    profiles: { local: profile },
    ...overrides
  };
}

function writeConfig(dir: string, value: unknown = validConfig(), fileName = "wats.config.json"): string {
  const configPath = join(dir, fileName);
  writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return configPath;
}

function expectNoLeaks(output: string, configPath?: string): void {
  for (const sentinel of SENTINELS) {
    expect(output).not.toContain(sentinel);
  }
  if (configPath !== undefined) expect(output).not.toContain(configPath);
  expect(output).not.toContain("profile: local");
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/u);
  expect(output).not.toMatch(/wats_(?:wh|srv)_[A-Za-z0-9_-]+/u);
  expect(output).not.toMatch(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/iu);
  expect(output).not.toContain(" at ");
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP address");
  const port = address.port;
  await new Promise<void>((resolvePromise) => {
    server.close((error) => (error === undefined || error === null ? resolvePromise() : undefined));
  });
  return port;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForHttpStatus(proc: Pick<ServeProcess, "exited">, url: string, status: number): Promise<Response> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const earlyExit = await Promise.race([
      proc.exited.then((exitCode) => ({ exited: true as const, exitCode })),
      delay(25).then(() => ({ exited: false as const }))
    ]);
    if (earlyExit.exited) {
      throw new Error(`serve exited before ${url} became ready: ${earlyExit.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === status) return response;
      await response.arrayBuffer();
    } catch {
      // Retry until the process reports ready or exits.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${url} to return ${status}`);
}

async function stopServe(proc: ServeProcess): Promise<number> {
  proc.kill("SIGTERM");
  const result = await Promise.race([
    proc.exited,
    delay(8000).then(() => "timeout" as const)
  ]);
  if (result === "timeout") {
    proc.kill("SIGKILL");
    await proc.exited;
    throw new Error("serve did not exit after SIGTERM");
  }
  return result;
}

async function canBind(port: number): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(port, "127.0.0.1", resolvePromise);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  }
}

// A fake Graph server that delays its response by `delayMs`. Used to test
// graceful drain: the admitted request is genuinely in-flight on the Graph
// transport when shutdown is signaled.
function createSlowFakeGraphServer(delayMs: number): {
  readonly baseUrl: string;
  readonly stop: () => void;
} {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
      return Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.SLOW_DRAIN_TEST" }] });
    }
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true)
  };
}

const dirsToClean: string[] = [];
afterEach(() => {
  while (dirsToClean.length > 0) {
    const dir = dirsToClean.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function trackedTempDir(): string {
  const dir = makeTempDir();
  dirsToClean.push(dir);
  return dir;
}

describe("WATS-204 serve --database help and arg validation", () => {
  test("--help documents --database and --database-url-env", () => {
    const result = runCli(["serve", "--help"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--database");
    expect(result.stdout).toContain("--database-url-env");
    expectNoLeaks(result.stdout + result.stderr);
  });

  test("--database and --database-url-env are mutually exclusive (dry-run)", () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const port = 39901;
    const result = runCli([
      "serve", "--config", configPath, "--dry-run",
      "--database", join(dir, "db.sqlite"),
      "--database-url-env", "WATS_DATABASE_URL",
      "--host", "127.0.0.1", "--port", String(port)
    ]);
    expect(result.exitCode, result.stdout).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("wats serve --help");
    expect(canBind(port).then((b) => b)).resolves.toBe(true);
  });

  test("--database-url-env rejects non-identifier env names (static, redacted)", () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const port = 39902;
    const cases: readonly string[] = [
      "   ",
      "../../.env.local",
      "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
      "WATS-DATABASE-URL",
      "wats database url"
    ];
    for (const bad of cases) {
      const result = runCli([
        "serve", "--config", configPath, "--dry-run",
        "--database-url-env", bad,
        "--host", "127.0.0.1", "--port", String(port)
      ]);
      expect(result.exitCode, `bad=${JSON.stringify(bad)}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("wats serve --help");
      if (bad.trim().length > 0) expect(result.stderr).not.toContain(bad);
    }
  });

  test("--database rejects traversal, control chars, and unsafe paths (static, redacted)", () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const port = 39903;
    const cases: readonly string[] = [
      "   ",
      "../../.env.local",
      "../../../etc/passwd",
      "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
      "/etc/passwd"
    ];
    for (const bad of cases) {
      const result = runCli([
        "serve", "--config", configPath, "--dry-run",
        "--database", bad,
        "--host", "127.0.0.1", "--port", String(port)
      ]);
      expect(result.exitCode, `bad=${JSON.stringify(bad)}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("wats serve --help");
      if (bad.trim().length > 0) expect(result.stderr).not.toContain(bad);
    }
  });

  test("invalid --database does not create any file on disk", () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const before = new Set(readdirSafe(dir));
    runCli([
      "serve", "--config", configPath, "--dry-run",
      "--database", "../../.env.local",
      "--host", "127.0.0.1", "--port", "39904"
    ]);
    const after = new Set(readdirSafe(dir));
    expect([...after].filter((f) => !before.has(f))).toEqual([]);
  });
});

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

describe("WATS-204 serve --database durable SQLite (dry-run)", () => {
  test("opens+migrates a SQLite file before binding and reports listening", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const dbPath = join(dir, "wats.sqlite");
    const port = await getFreePort();
    const serve = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port)
    ]);
    try {
      const response = await waitForHttpStatus(serve.proc, `http://127.0.0.1:${port}/healthz`, 200);
      expect(response.status).toBe(200);
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      // Kill the process BEFORE reading stdout/stderr (the Response text()
      // promise only resolves when the stream closes, which happens on exit).
      await stopServe(serve.proc);
    }
    const stdout = await serve.stdout;
    expect(stdout).toContain("status: listening");
    expectNoLeaks(stdout);
  });

  test("stateless default (no --database) is unchanged: no SQLite file created", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const serve = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--host", "127.0.0.1", "--port", String(port)
    ]);
    try {
      await waitForHttpStatus(serve.proc, `http://127.0.0.1:${port}/healthz`, 200);
      const before = new Set(readdirSafe(dir));
      // Wait a beat to ensure no async file write sneaks in.
      await delay(200);
      const after = new Set(readdirSafe(dir));
      expect([...after].filter((f) => !before.has(f))).toEqual([]);
    } finally {
      if (await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)]) === false) {
        serve.proc.kill("SIGKILL");
      }
    }
  });

  test("SQLite metadata and message history survive a restart", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const dbPath = join(dir, "wats-persist.sqlite");
    // Dry-run uses synthetic placeholder secrets; the bearer token is the
    // dry-run placeholder, NOT the env WATS_SERVICE_TOKEN.
    const dryRunToken = "dry-run-service-placeholder";

    // First boot: start, send a message (projected to SQLite), stop.
    const port1 = await getFreePort();
    const serve1 = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port1)
    ]);
    try {
      await waitForHttpStatus(serve1.proc, `http://127.0.0.1:${port1}/healthz`, 200);
      const send = await fetch(`http://127.0.0.1:${port1}/api/messages/text`, {
        method: "POST",
        headers: { authorization: `Bearer ${dryRunToken}`, "content-type": "application/json" },
        body: JSON.stringify({ to: "15551230000", text: "persist-me" })
      });
      expect(send.status).toBe(200);
      await send.json();
      // Give the projection a beat to land.
      await delay(150);
    } finally {
      await stopServe(serve1.proc);
    }

    expect(existsSync(dbPath)).toBe(true);
    const fileSizeAfterFirst = statSync(dbPath).size;
    expect(fileSizeAfterFirst).toBeGreaterThan(0);

    // Second boot: same db file, different port. History must survive.
    const port2 = await getFreePort();
    const serve2 = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port2)
    ]);
    try {
      await waitForHttpStatus(serve2.proc, `http://127.0.0.1:${port2}/healthz`, 200);
      const list = await fetch(`http://127.0.0.1:${port2}/api/messages?limit=10`, {
        headers: { authorization: `Bearer ${dryRunToken}` }
      });
      expect(list.status).toBe(200);
      const body = await list.json() as JsonRecord;
      const items = body.items as JsonRecord[] | undefined;
      expect(Array.isArray(items)).toBe(true);
      // The message projected in the first boot must be present after restart.
      const persisted = (items ?? []).some((m) => typeof m.waMessageId === "string");
      expect(persisted).toBe(true);
    } finally {
      await stopServe(serve2.proc);
    }
  });
});

describe("WATS-204 graceful finite drain", () => {
  test("active in-flight request is allowed to finish during shutdown (live, slow Graph)", async () => {
    const dir = trackedTempDir();
    const graph = createSlowFakeGraphServer(500);
    const config = validConfig();
    (((config.profiles as JsonRecord).local as JsonRecord).graph as JsonRecord).baseUrl = graph.baseUrl;
    const configPath = writeConfig(dir, config);
    const dbPath = join(dir, "drain.sqlite");
    const port = await getFreePort();
    const envPath = join(dir, ".env.local");
    writeFileSync(envPath, [
      "WATS_ACCESS_TOKEN=LIVE_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
      "WATS_VERIFY_TOKEN=LIVE_VERIFY_TOKEN_DO_NOT_PRINT",
      "WATS_APP_SECRET=LIVE_APP_SECRET_DO_NOT_PRINT",
      "WATS_SERVICE_TOKEN=LIVE_SERVICE_TOKEN_DO_NOT_PRINT",
      ""
    ].join("\n"), "utf8");
    const serve = spawnServe([
      "serve", "--config", configPath,
      "--live", "--yes-live", "--env-file", ".env.local",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port)
    ], {
      WATS_ACCESS_TOKEN: undefined,
      WATS_APP_SECRET: undefined,
      WATS_SERVICE_TOKEN: undefined,
      WATS_LIVE_ENABLE: "1",
      WATS_YES_LIVE: "1"
    });
    try {
      await waitForHttpStatus(serve.proc, `http://127.0.0.1:${port}/healthz`, 200);

      // Start a request that the fake Graph server delays by 500ms. This is
      // an admitted request whose response is genuinely in-flight.
      const slowFetch = fetch(`http://127.0.0.1:${port}/api/messages/text`, {
        method: "POST",
        headers: { authorization: "Bearer LIVE_SERVICE_TOKEN_DO_NOT_PRINT", "content-type": "application/json" },
        body: JSON.stringify({ to: "15551230000", text: "drain-me" })
      });

      // Give the request a beat to be admitted and reach the slow Graph,
      // then signal shutdown while the response is still pending.
      await delay(100);
      serve.proc.kill("SIGTERM");

      // The in-flight request must complete (not be aborted) within a
      // finite window. This proves the server drains active work.
      const result = await Promise.race([
        slowFetch.then((r) => ({ ok: true as const, status: r.status })),
        delay(15000).then(() => ({ ok: false as const }))
      ]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.status).toBe(200);

      // Process exits cleanly (0) after draining.
      const exitCode = await serve.proc.exited;
      expect(exitCode).toBe(0);
    } finally {
      graph.stop();
      if (await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)]) === false) {
        serve.proc.kill("SIGKILL");
      }
    }
  });

  test("shutdown is idempotent: repeated stop does not throw or hang", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const dbPath = join(dir, "idempotent.sqlite");
    const port = await getFreePort();
    const serve = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port)
    ]);
    try {
      await waitForHttpStatus(serve.proc, `http://127.0.0.1:${port}/healthz`, 200);
      // Repeated SIGTERM must not hang or error; the process exits once.
      serve.proc.kill("SIGTERM");
      serve.proc.kill("SIGTERM");
      const exitCode = await Promise.race([
        serve.proc.exited,
        delay(8000).then(() => "timeout" as const)
      ]);
      expect(exitCode).not.toBe("timeout");
    } finally {
      if (await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)]) === false) {
        serve.proc.kill("SIGKILL");
      }
    }
  });

  test("the SQLite store is closed after shutdown (file handle released)", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const dbPath = join(dir, "handle.sqlite");
    const port = await getFreePort();
    const serve = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port)
    ]);
    try {
      await waitForHttpStatus(serve.proc, `http://127.0.0.1:${port}/healthz`, 200);
      await stopServe(serve.proc);
    } finally {
      if (await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)]) === false) {
        serve.proc.kill("SIGKILL");
      }
    }
    // After clean shutdown we must be able to open the file again (handle released).
    expect(existsSync(dbPath)).toBe(true);
    // Re-open by starting a second serve on the same file: if the handle
    // leaked, the WAL lock would conflict.
    const port2 = await getFreePort();
    const serve2 = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port2)
    ]);
    try {
      await waitForHttpStatus(serve2.proc, `http://127.0.0.1:${port2}/healthz`, 200);
    } finally {
      await stopServe(serve2.proc);
    }
  });
});

describe("WATS-204 startup/bind failure closes the store", () => {
  test("bind failure (port in use) closes the SQLite store and does not leak a lock", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const dbPath = join(dir, "bindfail.sqlite");
    // Occupy a port with a dummy listener so serve cannot bind it.
    const blocker = createServer();
    await new Promise<void>((resolvePromise, rejectPromise) => {
      blocker.once("error", rejectPromise);
      blocker.listen(0, "127.0.0.1", resolvePromise);
    });
    const blockedPort = (blocker.address() as { port: number }).port;
    try {
      const result = runCli([
        "serve", "--config", configPath, "--dry-run",
        "--database", dbPath,
        "--host", "127.0.0.1", "--port", String(blockedPort)
      ]);
      // Bind failure: exit 1, no listening.
      expect(result.exitCode).toBe(1);
      expect(result.stdout).not.toContain("status: listening");
    } finally {
      await new Promise<void>((resolvePromise) => blocker.close(() => resolvePromise()));
    }

    // The store must have been closed: a subsequent serve on the SAME db file
    // must succeed (no stale WAL lock).
    const port2 = await getFreePort();
    const serve2 = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port2)
    ]);
    try {
      await waitForHttpStatus(serve2.proc, `http://127.0.0.1:${port2}/healthz`, 200);
    } finally {
      await stopServe(serve2.proc);
    }
  });

  test("migration/open failure fails closed without binding and without creating unintended files", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    // Point --database at a path inside a non-existent nested directory that
    // the SQLite adapter will reject (cannot create). The CLI must fail closed.
    const badDbPath = join(dir, "no-such-subdir", "wats.sqlite");
    const before = new Set(readdirSafe(dir));
    const port = await getFreePort();
    const result = runCli([
      "serve", "--config", configPath, "--dry-run",
      "--database", badDbPath,
      "--host", "127.0.0.1", "--port", String(port)
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain("status: listening");
    expect(await canBind(port)).toBe(true);
    // No unintended file/dir creation in the temp dir root.
    const after = new Set(readdirSafe(dir));
    expect([...after].filter((f) => !before.has(f))).toEqual([]);
    expectNoLeaks(result.stderr);
  });
});

describe("WATS-204 live secret validation order (no SQLite artifact from invalid creds)", () => {
  test("live + --database with invalid/missing secrets creates no SQLite file", async () => {
    const dir = trackedTempDir();
    const config = validConfig();
    const configPath = writeConfig(dir, config);
    const dbPath = join(dir, "should-not-exist.sqlite");
    const envPath = join(dir, ".env.local");
    // Empty/missing secrets: the env file exists but resolves no secret values.
    writeFileSync(envPath, ["# no secrets here", ""].join("\n"), "utf8");
    const before = new Set(readdirSafe(dir));
    const port = await getFreePort();
    const result = runCli([
      "serve", "--config", configPath,
      "--live", "--yes-live", "--env-file", ".env.local",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port)
    ], dir, {
      WATS_ACCESS_TOKEN: undefined,
      WATS_APP_SECRET: undefined,
      WATS_SERVICE_TOKEN: undefined,
      WATS_VERIFY_TOKEN: undefined,
      WATS_LIVE_ENABLE: "1",
      WATS_YES_LIVE: "1"
    });
    // SecretResolutionError: exit 1, no listening, no SQLite artifact.
    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stdout).not.toContain("status: listening");
    expect(result.stderr).toContain("SecretResolutionError");
    const after = new Set(readdirSafe(dir));
    expect([...after].filter((f) => !before.has(f))).toEqual([]);
    expect(existsSync(dbPath)).toBe(false);
    expect(await canBind(port)).toBe(true);
    expectNoLeaks(result.stderr);
  });
});

describe("WATS-204 --database-url-env safe env reference", () => {
  test("resolves a postgres connection string from the named env var (fail-closed without pg)", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    // Provide a valid-looking postgres URL via the env ref. The CLI must NOT
    // print the DSN. Without the `pg` package installed it fails closed with
    // a safe error, proving the env-ref was resolved and passed to the factory.
    const serve = spawnServe([
      "serve", "--config", configPath, "--dry-run",
      "--database-url-env", "WATS_TEST_DATABASE_URL",
      "--host", "127.0.0.1", "--port", String(port)
    ], {
      WATS_TEST_DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/wats-test"
    });
    try {
      // It should either fail closed (no pg) or bind (pg present). Either way
      // the DSN must never appear in output.
      const early = await Promise.race([
        serve.proc.exited.then((code) => ({ exited: true as const, code })),
        delay(3000).then(() => ({ exited: false as const, code: 0 as number }))
      ]);
      if (!early.exited) {
        // Process is still running (pg installed + connected). Kill it first
        // so we can read stdout/stderr.
        serve.proc.kill("SIGTERM");
        await Promise.race([serve.proc.exited, delay(5000)]);
      }
      const stdout = await serve.stdout;
      const stderr = await serve.stderr;
      const combined = stdout + stderr;
      expect(combined).not.toContain("postgres://user:pass");
      expect(combined).not.toContain("WATS_TEST_DATABASE_URL");
      if (early.exited) {
        // Fail-closed path (no pg / cannot connect): exit 1, safe message.
        expect(early.code).toBe(1);
        expect(combined).not.toContain("status: listening");
      }
      expectNoLeaks(combined);
    } finally {
      if (await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)]) === false) {
        serve.proc.kill("SIGKILL");
      }
    }
  });

  test("missing env var value fails closed with a safe redacted error", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    // runCli(args, cwd, env): the env overlay MUST be the 3rd argument. An
    // earlier revision passed it as the 2nd (cwd) argument, which made cwd an
    // object and Bun.spawnSync threw a spurious ENOENT on the resolved path.
    const result = runCli([
      "serve", "--config", configPath, "--dry-run",
      "--database-url-env", "WATS_MISSING_DATABASE_URL",
      "--host", "127.0.0.1", "--port", String(port)
    ], repoRoot, { WATS_MISSING_DATABASE_URL: undefined });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("wats serve --help");
    expect(result.stderr).not.toContain("WATS_MISSING_DATABASE_URL");
    expect(await canBind(port)).toBe(true);
    expectNoLeaks(result.stderr);
  });
});

describe("WATS-204 consumer fixture: runCli shutdown is async and awaitable", () => {
  test("exported runCli returns an async shutdown () => void | Promise<void> that closes the store", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const dbPath = join(dir, "consumer.sqlite");
    const port = await getFreePort();
    const cliModule = await import("../src/index");
    let result: Awaited<ReturnType<(typeof cliModule)["runCli"]>> | undefined;
    try {
      result = await cliModule.runCli([
        "serve", "--config", configPath, "--dry-run",
        "--database", dbPath,
        "--host", "127.0.0.1", "--port", String(port)
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("status: listening");
      expect(typeof result.shutdown).toBe("function");
      // The shutdown must be awaitable (returns a Promise) and resolve.
      const shutdownResult = result.shutdown?.();
      expect(shutdownResult).toBeInstanceOf(Promise);
      await shutdownResult;
      expect(existsSync(dbPath)).toBe(true);
      expect(await canBind(port)).toBe(true);
    } finally {
      // Ensure no lingering server if the test failed before explicit shutdown.
      await result?.shutdown?.();
      if (await canBind(port) === false) {
        await delay(100);
      }
    }
  });

  test("exported runCli shutdown is idempotent (repeated calls resolve without error)", async () => {
    const dir = trackedTempDir();
    const configPath = writeConfig(dir);
    const dbPath = join(dir, "idempotent-consumer.sqlite");
    const port = await getFreePort();
    const cliModule = await import("../src/index");
    const result = await cliModule.runCli([
      "serve", "--config", configPath, "--dry-run",
      "--database", dbPath,
      "--host", "127.0.0.1", "--port", String(port)
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    await Promise.all([result.shutdown?.(), result.shutdown?.(), result.shutdown?.()]);
    expect(await canBind(port)).toBe(true);
  });
});
