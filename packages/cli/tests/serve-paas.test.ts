import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// WATS-129: native PaaS serve mode.
// `wats serve --paas` makes the CLI PaaS-friendly without an external entrypoint
// shim: it reads the platform-injected $PORT and defaults the bind host to
// 0.0.0.0 (unless --host is given explicitly). It is opt-in and isolated so a
// fork that ignores PaaS deployment sees byte-identical default behavior: $PORT
// is NEVER consulted unless --paas is passed.

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

type ServeProcess = ReturnType<typeof Bun.spawn>;

const SENTINELS = [
  "WATS_ACCESS_TOKEN",
  "WATS_APP_SECRET",
  "WATS_SERVICE_TOKEN",
  "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890",
  "APP_SECRET_DO_NOT_PRINT",
  "raw-service-bearer-token-do-not-print"
] as const;

function isJsonRecord(value: unknown): value is Record<string, unknown> {
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
    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);
const entrypoint = join(repoRoot, "packages/cli/dist/bin.js");

function runCli(args: readonly string[], env: Record<string, string | undefined> = {}): CliResult {
  const completed = Bun.spawnSync(["bun", entrypoint, ...args], {
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
  const proc = Bun.spawn(["bun", entrypoint, ...args], {
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
  return {
    proc,
    stdout: new Response(proc.stdout).text(),
    stderr: new Response(proc.stderr).text()
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "wats-cli-paas-"));
}

function writeConfig(dir: string): string {
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
    service: { host: "127.0.0.1", port: 8787, apiPrefix: "/api", bearerToken: { env: "WATS_SERVICE_TOKEN" } }
  };
  const config = { version: 1, defaultProfile: "local", profiles: { local: profile } };
  const configPath = join(dir, "wats.config.json");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
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
    server.close((error) => (error === undefined || error === null ? resolvePromise() : rejectPromise(error)));
  });
  return port;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForHttpStatus(proc: ServeProcess, url: string, status: number): Promise<Response> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const early = await Promise.race([
      proc.exited.then((exitCode) => ({ exited: true as const, exitCode })),
      delay(25).then(() => ({ exited: false as const }))
    ]);
    if (early.exited) throw new Error(`serve exited before ${url} ready: ${early.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status === status) return response;
      await response.arrayBuffer();
    } catch {
      // retry
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${url} -> ${status}`);
}

async function stopServe(proc: ServeProcess): Promise<void> {
  proc.kill("SIGTERM");
  const result = await Promise.race([proc.exited, delay(5000).then(() => "timeout" as const)]);
  if (result === "timeout") {
    proc.kill("SIGKILL");
    await proc.exited;
  }
}

function expectNoLeaks(output: string): void {
  for (const sentinel of SENTINELS) expect(output).not.toContain(sentinel);
  expect(output).not.toContain("profile: local");
}

describe("wats serve --paas native PaaS mode (WATS-129)", () => {
  test("--help documents --paas and $PORT/0.0.0.0 behavior", () => {
    const result = runCli(["serve", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--paas");
    expect(result.stdout).toContain("PORT");
    expect(result.stdout).toContain("0.0.0.0");
  });

  test("--paas reads $PORT and binds 0.0.0.0 by default (dry-run)", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const serve = spawnServe(["serve", "--config", configPath, "--dry-run", "--paas"], { PORT: String(port) });
    try {
      const response = await waitForHttpStatus(serve.proc, `http://127.0.0.1:${port}/healthz`, 200);
      expect(response.status).toBe(200);
      const stderr = await Promise.race([serve.stderr, delay(50).then(() => "")]);
      expect(stderr).toBe("");
    } finally {
      await stopServe(serve.proc);
    }
    const stdout = await serve.stdout;
    expect(stdout).toContain("serve dry-run");
    expect(stdout).toContain("status: listening");
    expect(stdout).toContain(`address: http://0.0.0.0:${port}`);
    expectNoLeaks(stdout);
  });

  test("--paas honors an explicit --host over the 0.0.0.0 default", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const serve = spawnServe(
      ["serve", "--config", configPath, "--dry-run", "--paas", "--host", "127.0.0.1"],
      { PORT: String(port) }
    );
    try {
      await waitForHttpStatus(serve.proc, `http://127.0.0.1:${port}/healthz`, 200);
    } finally {
      await stopServe(serve.proc);
    }
    const stdout = await serve.stdout;
    expect(stdout).toContain(`address: http://127.0.0.1:${port}`);
    expect(stdout).not.toContain("address: http://0.0.0.0");
  });

  test("--paas with explicit --port prefers --port over $PORT", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const explicitPort = await getFreePort();
    const envPort = await getFreePort();
    const serve = spawnServe(
      ["serve", "--config", configPath, "--dry-run", "--paas", "--port", String(explicitPort)],
      { PORT: String(envPort) }
    );
    try {
      await waitForHttpStatus(serve.proc, `http://0.0.0.0:${explicitPort}/healthz`, 200);
    } finally {
      await stopServe(serve.proc);
    }
    const stdout = await serve.stdout;
    expect(stdout).toContain(`address: http://0.0.0.0:${explicitPort}`);
    expect(stdout).not.toContain(`:${envPort}`);
  });

  test("--paas fails closed when $PORT is missing", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const result = runCli(["serve", "--config", configPath, "--dry-run", "--paas"], { PORT: undefined });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain("status: listening");
    expectNoLeaks(result.stderr);
  });

  test("--paas fails closed when $PORT is out of range or non-numeric", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    for (const bad of ["0", "65536", "abc", "-1", "80 ", "0x50", "8080.0", ""]) {
      const result = runCli(["serve", "--config", configPath, "--dry-run", "--paas"], { PORT: bad });
      expect(result.exitCode, `PORT=${JSON.stringify(bad)} should fail closed`).toBe(1);
      expect(result.stdout).not.toContain("status: listening");
      expect(result.stderr).not.toContain(bad.length > 0 ? bad : "status: listening");
    }
  });

  test("without --paas, $PORT is ignored (config.port governs) — fork-safe isolation", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const envPort = await getFreePort();
    // config.port is 8787; provide a different $PORT and assert it is NOT used.
    const serve = spawnServe(
      ["serve", "--config", configPath, "--dry-run", "--host", "127.0.0.1"],
      { PORT: String(envPort) }
    );
    try {
      await waitForHttpStatus(serve.proc, `http://127.0.0.1:8787/healthz`, 200);
    } finally {
      await stopServe(serve.proc);
    }
    const stdout = await serve.stdout;
    expect(stdout).toContain("address: http://127.0.0.1:8787");
    expect(stdout).not.toContain(`:${envPort}`);
  });

  test("--print-routes works with --paas without binding or reading $PORT", () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    // No $PORT set: print-routes must still succeed because it never binds.
    const result = runCli(["serve", "--config", configPath, "--dry-run", "--paas", "--print-routes"], { PORT: undefined });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("serve dry-run routes");
    expect(result.stdout).toContain("GET /healthz");
    expect(result.stdout).not.toContain("status: listening");
  });
});
