// F-12 RED — edge-runtime sanity for the webhook fetch adapter.
//
// Closes WATS-25 (Arch-K edge-runtime harness). Asserts:
//   - `createFetchWebhookHandler` is callable from @switchbord/http without
//     any node:* imports flowing through its static import graph.
//   - The returned handler takes a WHATWG Request and returns a
//     Response that satisfies the edge-runtime contract.
//   - The adapters/fetchAdapter.ts source file contains ZERO static
//     node:* references (enforced structurally).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createCryptoProvider } from "@switchbord/crypto";
import { createFetchWebhookHandler, createWebhookAdapter } from "@switchbord/http";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }
  return parsed;
}

function includesWorkspacePackagesGlob(workspaces: unknown): boolean {
  if (Array.isArray(workspaces)) {
    return workspaces.includes("packages/*");
  }
  if (isJsonRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.includes("packages/*");
  }
  return false;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (includesWorkspacePackagesGlob(manifest.workspaces)) {
        return currentDir;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate workspace root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "edge-verify-token";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

async function signBody(secret: string, body: string): Promise<string> {
  const provider = await createCryptoProvider();
  const digest = await provider.hmacSha256(secret, body);
  return `sha256=${bytesToHex(digest)}`;
}

function makeFacade() {
  const dispatches: unknown[] = [];
  return {
    dispatches,
    async dispatch(update: unknown) {
      dispatches.push(update);
    }
  };
}

function makeEnvelope() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-EDGE",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "555" },
              messages: [
                {
                  from: "15550001",
                  id: "wamid.EDGE",
                  timestamp: "1",
                  type: "text",
                  text: { body: "hi" }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

describe("F-12 edge-runtime sanity — fetch webhook handler", () => {
  test("fetchAdapter.ts source contains zero node:* static imports", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const sourcePath = join(
      repoRoot,
      "packages/http/src/adapters/fetchAdapter.ts"
    );
    expect(existsSync(sourcePath)).toBe(true);
    const source = readFileSync(sourcePath, "utf8");
    // Primary guard: no static import/export referencing node:*.
    expect(source).not.toMatch(
      /^\s*import\s+(?:[^'";]+\s+from\s+)?['"]node:[^'"]+['"]/m
    );
    expect(source).not.toMatch(
      /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]node:[^'"]+['"]/m
    );
    // Defense-in-depth: the substring `node:` must not appear in any
    // import specifier position.
    expect(source).not.toContain("\"node:");
    expect(source).not.toContain("'node:");
  });

  test("webhookAdapter.ts (the shared core) contains zero node:* static imports", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const sourcePath = join(
      repoRoot,
      "packages/http/src/adapters/webhookAdapter.ts"
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toContain("\"node:");
    expect(source).not.toContain("'node:");
  });

  test("fetch handler processes a full Request/Response round-trip", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const handler = createFetchWebhookHandler(adapter);

    // Edge-runtime-shaped Request: constructed purely via WinterCG
    // globals (Request / URL / Headers). No node:http, no node:buffer.
    const body = JSON.stringify(makeEnvelope());
    const signature = await signBody(APP_SECRET, body);
    const request = new Request("https://edge.example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature
      },
      body
    });

    const response = await handler(request);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(facade.dispatches.length).toBe(1);
  });

  test("GET verify round-trip works on a pure-fetch request", async () => {
    const facade = makeFacade();
    const adapter = createWebhookAdapter({
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      whatsapp: facade
    });
    const handler = createFetchWebhookHandler(adapter);
    const url = `https://edge.example.com/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
      VERIFY_TOKEN
    )}&hub.challenge=edge-ok`;
    const response = await handler(new Request(url, { method: "GET" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("edge-ok");
  });
});
