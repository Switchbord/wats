import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/index";

type FetchCall = {
  readonly url: string;
  readonly init: RequestInit | undefined;
};

const tempDirs: string[] = [];
const ORIGINAL_FETCH = globalThis.fetch;
const TOKEN = "TOKEN_SENTINEL_DO_NOT_PRINT_1234567890";
const CONFIG_SENTINEL = "wats-test-config-sentinel";

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wats-cli-messages-"));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, port = 8787): string {
  const path = join(dir, `${CONFIG_SENTINEL}.json`);
  writeFileSync(path, `${JSON.stringify({
    version: 1,
    defaultProfile: "local",
    profiles: {
      local: {
        graph: { apiVersion: "v25.0", baseUrl: "https://graph.example" },
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
          port,
          apiPrefix: "/api",
          bearerToken: { env: "WATS_SERVICE_TOKEN" }
        }
      }
    }
  }, null, 2)}\n`, "utf8");
  return path;
}

function writeEnvFile(dir: string, token = TOKEN): string {
  const path = join(dir, ".env.local");
  writeFileSync(path, `WATS_SERVICE_TOKEN=${token}\n`, "utf8");
  return path;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return await handler(url, init);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function expectNoLeaks(output: string, configPath?: string): void {
  expect(output).not.toContain(TOKEN);
  expect(output).not.toContain("APP_SECRET=");
  expect(output).not.toMatch(/EAA[A-Za-z0-9_-]{20,}/u);
  expect(output).not.toMatch(/wats_(?:wh|srv)_[A-Za-z0-9_-]+/u);
  if (configPath !== undefined) expect(output).not.toContain(configPath);
  expect(output).not.toContain(CONFIG_SENTINEL);
  expect(output).not.toContain("profile: local");
}

const RECORD = Object.freeze({
  rowId: "row-2",
  waMessageId: "wamid.TWO",
  direction: "outbound",
  fromPhone: null,
  toPhone: "15551230000",
  type: "text",
  status: "sent",
  graphMessageId: "wamid.TWO",
  createdAt: "2026-06-21T00:00:02.000Z",
  updatedAt: "2026-06-21T00:00:02.000Z"
});

describe("wats messages CLI commands", () => {
  test("messages help surfaces list/show usage without requiring config", async () => {
    const root = await runCli(["messages", "--help"]);
    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("Usage: wats messages");
    expect(root.stdout).toContain("wats messages list");
    expect(root.stdout).toContain("wats messages show");
    expect(root.stdout).toContain("token is never printed");
    expect(root.stderr).toBe("");

    const list = await runCli(["messages", "list", "--help"]);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("--limit");
    expect(list.stdout).toContain("--cursor");
    expect(list.stdout).toContain("--json");

    const show = await runCli(["messages", "show", "--help"]);
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("<message-id>");
    expect(show.stdout).toContain("--json");
  });

  test("list --json calls GET /api/messages with bearer token and prints service JSON", async () => {
    const dir = makeTempDir();
    const config = writeConfig(dir, 19001);
    writeEnvFile(dir);
    const calls = mockFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:19001/api/messages?limit=2&cursor=row-1");
      expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, Accept: "application/json" });
      return jsonResponse({ items: [RECORD], nextCursor: null });
    });

    const result = await runCli(["messages", "list", "--config", config, "--env-file", ".env.local", "--limit", "2", "--cursor", "row-1", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(calls.length).toBe(1);
    const body = JSON.parse(result.stdout) as { items: typeof RECORD[]; nextCursor: string | null };
    expect(body.items[0]?.waMessageId).toBe("wamid.TWO");
    expect(body.nextCursor).toBeNull();
    expectNoLeaks(result.stdout + result.stderr, config);
  });

  test("list text mode prints TSV on stdout and nextCursor on stderr", async () => {
    const dir = makeTempDir();
    const config = writeConfig(dir, 19002);
    writeEnvFile(dir);
    mockFetch(() => jsonResponse({ items: [RECORD], nextCursor: "row-1" }));

    const result = await runCli(["messages", "list", "--config", config, "--env-file", ".env.local", "--limit", "1"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe("createdAt\tdirection\twaMessageId\ttype\tstatus\tfrom\tto");
    expect(result.stdout).toContain("2026-06-21T00:00:02.000Z\toutbound\twamid.TWO\ttext\tsent\t\t15551230000");
    expect(result.stderr).toBe("nextCursor: row-1\n");
    expectNoLeaks(result.stdout + result.stderr, config);
  });

  test("show --json calls GET /api/messages/{id} and prints one record", async () => {
    const dir = makeTempDir();
    const config = writeConfig(dir, 19003);
    writeEnvFile(dir);
    const calls = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:19003/api/messages/wamid.TWO");
      return jsonResponse(RECORD);
    });

    const result = await runCli(["messages", "show", "wamid.TWO", "--config", config, "--env-file", ".env.local", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(calls.length).toBe(1);
    const body = JSON.parse(result.stdout) as typeof RECORD;
    expect(body.waMessageId).toBe("wamid.TWO");
    expect(result.stderr).toBe("");
    expectNoLeaks(result.stdout + result.stderr, config);
  });

  test("show text mode prints key-value fields", async () => {
    const dir = makeTempDir();
    const config = writeConfig(dir, 19004);
    writeEnvFile(dir);
    mockFetch(() => jsonResponse(RECORD));

    const result = await runCli(["messages", "show", "wamid.TWO", "--config", config, "--env-file", ".env.local"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("waMessageId: wamid.TWO");
    expect(result.stdout).toContain("fromPhone: null");
    expect(result.stdout).toContain("toPhone: 15551230000");
    expect(result.stderr).toBe("");
  });

  test("missing config, missing id, invalid limit, and unknown flag fail before fetch", async () => {
    const dir = makeTempDir();
    const config = writeConfig(dir, 19005);
    const calls = mockFetch(() => jsonResponse({ items: [], nextCursor: null }));

    const noConfig = await runCli(["messages", "list"]);
    const noId = await runCli(["messages", "show", "--config", config]);
    const badLimit = await runCli(["messages", "list", "--config", config, "--limit", "abc"]);
    const unknown = await runCli(["messages", "list", "--config", config, "--bogus"]);

    for (const result of [noConfig, noId, badLimit, unknown]) {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("CliUsageError");
      expectNoLeaks(result.stderr, config);
    }
    expect(calls.length).toBe(0);
  });

  test("missing service bearer token fails before fetch but may print env var name", async () => {
    const dir = makeTempDir();
    const config = writeConfig(dir, 19006);
    const calls = mockFetch(() => jsonResponse({ items: [], nextCursor: null }));

    const result = await runCli(["messages", "list", "--config", config]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("WATS_SERVICE_TOKEN");
    expect(result.stderr).not.toContain(TOKEN);
    expect(calls.length).toBe(0);
  });

  test("service 404/401 and network failures are folded into safe CLI errors", async () => {
    const dir = makeTempDir();
    const config = writeConfig(dir, 19007);
    writeEnvFile(dir);

    mockFetch(() => jsonResponse({ error: { code: "not_found", message: "message missing" } }, 404));
    const missing = await runCli(["messages", "show", "wamid.MISSING", "--config", config, "--env-file", ".env.local"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("404 not_found");
    expectNoLeaks(missing.stderr, config);

    mockFetch(() => jsonResponse({ error: { code: "unauthorized", message: "bad token" } }, 401));
    const unauthorized = await runCli(["messages", "list", "--config", config, "--env-file", ".env.local"]);
    expect(unauthorized.exitCode).toBe(1);
    expect(unauthorized.stderr).toContain("401 unauthorized");
    expectNoLeaks(unauthorized.stderr, config);

    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const network = await runCli(["messages", "list", "--config", config, "--env-file", ".env.local"]);
    expect(network.exitCode).toBe(1);
    expect(network.stderr).toContain("Could not reach the local service");
    expect(network.stderr).toContain("127.0.0.1:19007");
    expectNoLeaks(network.stderr, config);
  });
});
