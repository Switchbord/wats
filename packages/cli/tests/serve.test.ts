import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
type ProcessSignalMethod = (event: string | symbol, listener: (...args: unknown[]) => void) => typeof process;

type ProcessLikeWithSignals = typeof process & {
  addListener: ProcessSignalMethod;
  on: ProcessSignalMethod;
  once: ProcessSignalMethod;
  prependListener: ProcessSignalMethod;
  prependOnceListener: ProcessSignalMethod;
  exit(code?: number): never;
};

type SignalListenerRegistration = Readonly<{
  event: string | symbol;
  listener: (...args: unknown[]) => void;
}>;

const SENTINELS = [
  "WATS_ACCESS_TOKEN",
  "WATS_WEBHOOK_VERIFY_TOKEN",
  "WATS_WEBHOOK_APP_SECRET",
  "WATS_SERVICE_BEARER_TOKEN",
  "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
  "APP_SECRET_DO_NOT_PRINT",
  "raw-service-bearer-token-do-not-print",
  "../../.env.local"
] as const;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) throw new Error(`Expected JSON object at ${filePath}`);
  return parsed;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);
const entrypoint = join(repoRoot, "packages/cli/dist/bin.js");

const originalProcessSignalMethods = Object.freeze({
  addListener: process.addListener,
  on: process.on,
  once: process.once,
  prependListener: process.prependListener,
  prependOnceListener: process.prependOnceListener
});
const originalProcessExit = process.exit;

afterEach(() => {
  const mutableProcess = process as ProcessLikeWithSignals;
  mutableProcess.addListener = originalProcessSignalMethods.addListener.bind(process) as ProcessLikeWithSignals["addListener"];
  mutableProcess.on = originalProcessSignalMethods.on.bind(process) as ProcessLikeWithSignals["on"];
  mutableProcess.once = originalProcessSignalMethods.once.bind(process) as ProcessLikeWithSignals["once"];
  mutableProcess.prependListener = originalProcessSignalMethods.prependListener.bind(process) as ProcessLikeWithSignals["prependListener"];
  mutableProcess.prependOnceListener = originalProcessSignalMethods.prependOnceListener.bind(process) as ProcessLikeWithSignals["prependOnceListener"];
  mutableProcess.exit = originalProcessExit.bind(process) as ProcessLikeWithSignals["exit"];
});


function runCli(args: readonly string[], cwd = repoRoot, env: Record<string, string | undefined> = {}): CliResult {
  const completed = Bun.spawnSync(["bun", entrypoint, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WATS_ACCESS_TOKEN: "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
      WATS_WEBHOOK_APP_SECRET: "APP_SECRET_DO_NOT_PRINT",
      WATS_SERVICE_BEARER_TOKEN: "raw-service-bearer-token-do-not-print",
      ...env
    }
  });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

function spawnServe(args: readonly string[]): { proc: ServeProcess; stdout: Promise<string>; stderr: Promise<string> } {
  const proc = Bun.spawn(["bun", entrypoint, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WATS_ACCESS_TOKEN: "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
      WATS_WEBHOOK_APP_SECRET: "APP_SECRET_DO_NOT_PRINT",
      WATS_SERVICE_BEARER_TOKEN: "raw-service-bearer-token-do-not-print"
    }
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  return { proc, stdout, stderr };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wats-cli-serve-"));
}

function validConfig(overrides: Partial<JsonRecord> = {}): JsonRecord {
  const profile = {
    graph: { apiVersion: "v25.0", baseUrl: "https://graph.facebook.com" },
    whatsapp: { wabaId: "123456789012345", phoneNumberId: "15551234567" },
    auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
    webhook: {
      path: "/webhooks/whatsapp",
      verifyToken: { env: "WATS_WEBHOOK_VERIFY_TOKEN" },
      appSecret: { env: "WATS_WEBHOOK_APP_SECRET" },
      maxBodyBytes: 1048576
    },
    service: {
      host: "127.0.0.1",
      port: 8787,
      apiPrefix: "/api",
      bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
    }
  } satisfies JsonRecord;

  return {
    version: 1,
    defaultProfile: "local",
    profiles: {
      local: profile,
      alternate: {
        ...profile,
        webhook: { ...profile.webhook, path: "/hooks/alternate" },
        service: { ...profile.service, apiPrefix: "/alt-api", port: 9797 }
      }
    },
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
  expect(output).not.toContain("profile: alternate");
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
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => error === undefined ? resolvePromise() : rejectPromise(error));
  });
  return port;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForHttpStatus(proc: ServeProcess, url: string, status: number): Promise<Response> {
  const deadline = Date.now() + 5000;
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
    delay(5000).then(() => "timeout" as const)
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

describe("exported runCli process side effects", () => {
  test("does not install process signal handlers or call process.exit for direct programmatic serve use", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const registrations: SignalListenerRegistration[] = [];
    const mutableProcess = process as ProcessLikeWithSignals;
    const recordSignalRegistration: ProcessSignalMethod = (event, listener) => {
      registrations.push({ event, listener });
      return process;
    };
    mutableProcess.addListener = recordSignalRegistration as ProcessLikeWithSignals["addListener"];
    mutableProcess.on = recordSignalRegistration as ProcessLikeWithSignals["on"];
    mutableProcess.once = recordSignalRegistration as ProcessLikeWithSignals["once"];
    mutableProcess.prependListener = recordSignalRegistration as ProcessLikeWithSignals["prependListener"];
    mutableProcess.prependOnceListener = recordSignalRegistration as ProcessLikeWithSignals["prependOnceListener"];
    mutableProcess.exit = ((code?: number) => {
      throw new Error(`process.exit should not be called by exported runCli, got ${code ?? "undefined"}`);
    }) as ProcessLikeWithSignals["exit"];

    let result: Awaited<ReturnType<(typeof import("../src/index"))["runCli"]>> | undefined;
    try {
      const cliModule = await import("../src/index");
      result = await cliModule.runCli(["serve", "--config", configPath, "--dry-run", "--host", "127.0.0.1", "--port", String(port)]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("serve dry-run");
      expect(result.stdout).toContain("status: listening");
      expect(typeof result.shutdown).toBe("function");
      expect(registrations).toEqual([]);
      const response = await waitForHttpStatus({ exited: new Promise<never>(() => {}) } as ServeProcess, `http://127.0.0.1:${port}/healthz`, 200);
      expect(response.status).toBe(200);
    } finally {
      result?.shutdown?.();
      expect(await canBind(port)).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("wats serve dry-run process wrapper", () => {
  test("--help documents real dry-run usage instead of the old handoff", () => {
    const result = runCli(["serve", "--help"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats serve --config <path> --dry-run");
    expect(result.stdout).toContain("--host <host>");
    expect(result.stdout).toContain("--port <port>");
    expect(result.stdout).toContain("--print-routes");
    expect(result.stdout).toContain("dry-run mock transport");
    expect(result.stdout).not.toContain("server runtime is not implemented");
    expect(result.stdout).not.toContain("handoff");
    expectNoLeaks(result.stdout + result.stderr);
  });

  test("starts a Bun.serve dry-run app, serves status and OpenAPI routes, and exits cleanly on SIGTERM", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const serve = spawnServe(["serve", "--config", configPath, "--dry-run", "--host", "127.0.0.1", "--port", String(port)]);

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      for (const path of ["/healthz", "/readyz", "/openapi.json"] as const) {
        const response = await waitForHttpStatus(serve.proc, `${baseUrl}${path}`, 200);
        expect(response.status).toBe(200);
        if (path === "/openapi.json") {
          const doc = await response.json() as JsonRecord;
          expect(doc.openapi).toBe("3.1.0");
        } else {
          const body = await response.json() as JsonRecord;
          expect(body).toEqual({ ok: true, service: "wats" });
        }
      }

      const exitCode = await stopServe(serve.proc);
      const stdout = await serve.stdout;
      const stderr = await serve.stderr;

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("serve dry-run");
      expect(stdout).toContain("status: listening");
      expect(stdout).toContain(`address: http://127.0.0.1:${port}`);
      expect(stdout).toContain("graph: dry-run mock transport");
      expect(stdout).toContain("profile: [REDACTED_PROFILE]");
      expectNoLeaks(stdout + stderr, configPath);
    } finally {
      if ((await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)])) === false) {
        serve.proc.kill("SIGKILL");
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dry-run startup never calls the Graph base URL", async () => {
    const dir = makeTempDir();
    const config = validConfig();
    (((config.profiles as JsonRecord).local as JsonRecord).graph as JsonRecord).baseUrl = "http://127.0.0.1:9/graph-sentinel-do-not-print";
    const configPath = writeConfig(dir, config);
    const port = await getFreePort();
    const serve = spawnServe(["serve", "--config", configPath, "--dry-run", "--host", "127.0.0.1", "--port", String(port)]);

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      for (const path of ["/healthz", "/readyz", "/openapi.json"] as const) {
        const response = await waitForHttpStatus(serve.proc, `${baseUrl}${path}`, 200);
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
      await stopServe(serve.proc);
      const stdout = await serve.stdout;
      const stderr = await serve.stderr;
      expect(stdout + stderr).not.toContain("ECONNREFUSED");
      expect(stdout + stderr).not.toContain("Graph request failed");
      expect(stdout + stderr).not.toContain("graph-sentinel-do-not-print");
      expectNoLeaks(stdout + stderr, configPath);
    } finally {
      if ((await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)])) === false) {
        serve.proc.kill("SIGKILL");
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("route collision configs fail before binding with safe diagnostics", async () => {
    const dir = makeTempDir();
    const config = validConfig();
    (((config.profiles as JsonRecord).local as JsonRecord).webhook as JsonRecord).path = "/healthz";
    const configPath = writeConfig(dir, config);
    const port = await getFreePort();

    const result = runCli(["serve", "--config", configPath, "--dry-run", "--host", "127.0.0.1", "--port", String(port)]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Service route configuration is invalid");
    expect(result.stderr).toContain("wats serve --help");
    expect(result.stderr).not.toContain("/healthz");
    expect(await canBind(port)).toBe(true);
    expectNoLeaks(result.stderr, configPath);
    rmSync(dir, { recursive: true, force: true });
  });

  test("unsafe arguments fail closed without starting a server or echoing attacker values", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const cases: readonly (readonly string[])[] = [
      ["--dry-run"],
      ["--config", configPath],
      ["--config", configPath, "--config", configPath, "--dry-run"],
      ["--config", configPath, "--dry-run", "--dry-run"],
      ["--config", configPath, "--dry-run", "--port", "0"],
      ["--config", configPath, "--dry-run", "--port", "65536"],
      ["--config", configPath, "--dry-run", "--port", "abc"],
      ["--config", configPath, "--dry-run", "--host", "https://127.0.0.1"],
      ["--config", configPath, "--dry-run", "--host", "../../.env.local"],
      ["--config", configPath, "--dry-run", "--profile", "../../.env.local"],
      ["--config", configPath, "--dry-run", "--profile", "EAA_TEST_ACCESS_TOKEN_DO_NOT_PRINT_1234567890"],
      ["--config", configPath, "--dry-run", "--unknown=../../.env.local"]
    ];

    try {
      for (const args of cases) {
        const result = runCli(["serve", ...args, "--host", "127.0.0.1", "--port", String(port)]);
        expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Invalid serve arguments");
        expect(result.stderr).toContain("wats serve --help");
        expect(result.stderr).not.toContain("Unexpected argument");
        expect(await canBind(port)).toBe(true);
        expectNoLeaks(result.stderr, configPath);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("live guard flags are documented but fail closed before env resolution or bind", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();

    try {
      const help = runCli(["serve", "--help"]);
      expect(help.exitCode, help.stderr).toBe(0);
      expect(help.stdout).toContain("--live");
      expect(help.stdout).toContain("--yes-live");
      expect(help.stdout).toContain("WATS_LIVE_ENABLE=1");
      expect(help.stdout).toContain("WATS_YES_LIVE=1");
      expect(help.stdout).toContain("env-file secret resolution is not implemented");

      const cases: readonly Readonly<{ args: readonly string[]; env?: Record<string, string | undefined> }>[] = [
        { args: ["--config", configPath, "--live"] },
        { args: ["--config", configPath, "--yes-live"] },
        { args: ["--config", configPath, "--live", "--yes-live"] },
        { args: ["--config", configPath, "--dry-run", "--live", "--yes-live"] },
        { args: ["--config", configPath, "--live", "--yes-live", "--env-file", "../../.env.local"] },
        { args: ["--config", configPath, "--dry-run"], env: { WATS_LIVE_ENABLE: "1", WATS_YES_LIVE: undefined } },
        { args: ["--config", configPath, "--dry-run"], env: { WATS_LIVE_ENABLE: undefined, WATS_YES_LIVE: "1" } },
        { args: ["--config", configPath, "--dry-run"], env: { WATS_LIVE_ENABLE: "1", WATS_YES_LIVE: "1" } }
      ] as const;

      for (const { args, env } of cases) {
        const result = runCli(["serve", ...args, "--host", "127.0.0.1", "--port", String(port)], repoRoot, env);
        expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Live serve mode is gated and not available in this build");
        expect(result.stderr).toContain("wats serve --help");
        expect(result.stderr).not.toContain("Invalid serve arguments");
        expect(result.stderr).not.toContain("../../.env.local");
        expect(await canBind(port)).toBe(true);
        expectNoLeaks(result.stderr, configPath);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--print-routes prints safe route inventory and exits without binding", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();

    const result = runCli(["serve", "--config", configPath, "--dry-run", "--host", "127.0.0.1", "--port", String(port), "--print-routes"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("serve dry-run routes");
    for (const route of ["GET /healthz", "GET /readyz", "GET /openapi.json", "GET|POST /webhooks/whatsapp", "POST /api/messages/text", "POST /api/messages"] as const) {
      expect(result.stdout).toContain(route);
    }
    expect(result.stdout).not.toContain(`http://127.0.0.1:${port}`);
    expect(await canBind(port)).toBe(true);
    expectNoLeaks(result.stdout + result.stderr, configPath);
    rmSync(dir, { recursive: true, force: true });
  });
});
