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

function createFakeGraphServer(): {
  readonly baseUrl: string;
  readonly requests: Array<{ readonly method: string; readonly pathname: string; readonly authorization: string | null; readonly body: string }>;
  readonly stop: () => void;
} {
  const requests: Array<{ readonly method: string; readonly pathname: string; readonly authorization: string | null; readonly body: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        pathname: url.pathname,
        authorization: request.headers.get("authorization"),
        body: await request.text()
      });
      return Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.LIVE_TEST" }] });
    }
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true)
  };
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
  test("--help documents real dry-run usage instead of the old transition", () => {
    const result = runCli(["serve", "--help"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: wats serve --config <path> --dry-run");
    expect(result.stdout).toContain("--host <host>");
    expect(result.stdout).toContain("--port <port>");
    expect(result.stdout).toContain("--print-routes");
    expect(result.stdout).toContain("dry-run mock transport");
    expect(result.stdout).not.toContain("server runtime is not implemented");
    expect(result.stdout).not.toContain("transition");
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
      ["--config", configPath, "--dry-run", "--profile", "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890"],
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

  test("live mode requires intent acknowledgement and explicit env-file", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const missingEnvCases: readonly (readonly string[])[] = [
      ["--config", configPath, "--live"],
      ["--config", configPath, "--yes-live"],
      ["--config", configPath, "--live", "--yes-live"],
      ["--config", configPath, "--live", "--env-file", ".env.local"],
      ["--config", configPath, "--yes-live", "--env-file", ".env.local"],
      ["--config", configPath, "--dry-run", "--live", "--yes-live"],
      ["--config", configPath, "--live", "--yes-live", "--env-file"]
    ];

    try {
      const help = runCli(["serve", "--help"]);
      expect(help.exitCode, help.stderr).toBe(0);
      expect(help.stdout).toContain("--live");
      expect(help.stdout).toContain("--yes-live");
      expect(help.stdout).toContain("--env-file <path>");
      expect(help.stdout).not.toContain("env-file secret resolution is not implemented");

      for (const args of missingEnvCases) {
        const result = runCli(["serve", ...args, "--host", "127.0.0.1", "--port", String(port)]);
        expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Live serve requires --live --yes-live and --env-file");
        expect(result.stderr).toContain("wats serve --help");
        expect(result.stderr).not.toContain("Invalid serve arguments");
        expect(await canBind(port)).toBe(true);
        expectNoLeaks(result.stderr, configPath);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unsafe live env-file arguments fail closed without echoing attacker values", async () => {
    const dir = makeTempDir();
    const configPath = writeConfig(dir);
    const port = await getFreePort();
    const cases: readonly (readonly string[])[] = [
      ["--config", configPath, "--live", "--yes-live", "--env-file", "../../.env.local"],
      ["--config", configPath, "--live", "--yes-live", "--env-file", "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890"],
      ["--config", configPath, "--live", "--yes-live", "--env-file", "safe.env", "--env-file", "other.env"],
      ["--config", configPath, "--live", "--yes-live", "--env-file=../../.env.local"],
      ["--config", configPath, "--live", "--yes-live", "--env-file", "/tmp/.env.local"]
    ];

    try {
      for (const args of cases) {
        const result = runCli(["serve", ...args, "--host", "127.0.0.1", "--port", String(port)]);
        expect(result.exitCode, `args=${JSON.stringify(args)} stdout=${result.stdout}`).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Invalid serve arguments");
        expect(result.stderr).toContain("wats serve --help");
        expect(result.stderr).not.toContain("../../.env.local");
        expect(result.stderr).not.toContain("TOKEN_SENTINEL_DO_NOT_PRINT_1234567890");
        expect(result.stderr).not.toContain("safe.env");
        expect(result.stderr).not.toContain("other.env");
        expect(await canBind(port)).toBe(true);
        expectNoLeaks(result.stderr, configPath);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("starts credential-gated live service from explicit env-file and forwards message requests to Graph", async () => {
    const dir = makeTempDir();
    const graph = createFakeGraphServer();
    const config = validConfig();
    (((config.profiles as JsonRecord).local as JsonRecord).graph as JsonRecord).baseUrl = graph.baseUrl;
    const configPath = writeConfig(dir, config);
    const port = await getFreePort();
    const envPath = join(dir, ".env.local");
    writeFileSync(envPath, [
      "WATS_ACCESS_TOKEN=FILE_ACCESS_TOKEN_DO_NOT_PRINT_1234567890",
      "WATS_VERIFY_TOKEN=FILE_VERIFY_TOKEN_DO_NOT_PRINT",
      "WATS_APP_SECRET=FILE_APP_SECRET_DO_NOT_PRINT",
      "WATS_SERVICE_TOKEN=FILE_SERVICE_TOKEN_DO_NOT_PRINT",
      ""
    ].join("\n"), "utf8");
    const serve = spawnServe(["serve", "--config", configPath, "--live", "--yes-live", "--env-file", ".env.local", "--host", "127.0.0.1", "--port", String(port)], {
      WATS_ACCESS_TOKEN: undefined,
      WATS_APP_SECRET: undefined,
      WATS_SERVICE_TOKEN: undefined,
      WATS_LIVE_ENABLE: "1",
      WATS_YES_LIVE: "1"
    });

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const health = await waitForHttpStatus(serve.proc, `${baseUrl}/healthz`, 200);
      expect(await health.json()).toEqual({ ok: true, service: "wats" });

      const send = await fetch(`${baseUrl}/api/messages/text`, {
        method: "POST",
        headers: { authorization: "Bearer FILE_SERVICE_TOKEN_DO_NOT_PRINT", "content-type": "application/json" },
        body: JSON.stringify({ to: "15551230000", text: "hello live" })
      });
      expect(send.status).toBe(200);
      const sendBody = await send.json() as JsonRecord;
      expect(sendBody.messages).toEqual([{ id: "wamid.LIVE_TEST" }]);
      expect(graph.requests).toHaveLength(1);
      expect(graph.requests[0]?.method).toBe("POST");
      expect(graph.requests[0]?.pathname).toBe("/v25.0/15551234567/messages");
      expect(graph.requests[0]?.authorization).toBe("Bearer FILE_ACCESS_TOKEN_DO_NOT_PRINT_1234567890");
      expect(graph.requests[0]?.body).toContain("hello live");

      const exitCode = await stopServe(serve.proc);
      const stdout = await serve.stdout;
      const stderr = await serve.stderr;
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("serve live");
      expect(stdout).toContain("status: listening");
      expect(stdout).toContain(`address: http://127.0.0.1:${port}`);
      expect(stdout).toContain("graph: live fetch transport");
      expect(stdout).toContain("profile: [REDACTED_PROFILE]");
      expectNoLeaks(stdout + stderr, configPath);
    } finally {
      graph.stop();
      if ((await Promise.race([serve.proc.exited.then(() => true), delay(1).then(() => false)])) === false) {
        serve.proc.kill("SIGKILL");
      }
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
