// F-12 RED — asserts site/content/docs/reference/webhook-adapter.mdx content,
// parity matrix update, CHANGELOG entry, deploy guides, and the
// http-consumer fixture coverage of the WebhookAdapter surface.
// These checks fail until the GREEN doc/fixture commit lands.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

function runBun(args: string[], cwd: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const completed = Bun.spawnSync(["bun", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    exitCode: completed.exitCode ?? -1,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

// ---------------------------------------------------------------------
// site/content/docs/reference/webhook-adapter.mdx
// ---------------------------------------------------------------------

describe("F-12 webhook-adapter.md reference guide", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const docPath = join(repoRoot, "site/content/docs/reference/webhook-adapter.mdx");

  test("file exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  test("contains a WebhookAdapter section + runtime-neutral language", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/##\s+WebhookAdapter/i);
    expect(doc).toMatch(/runtime[- ]neutral/i);
    expect(doc).toContain("createWebhookAdapter");
  });

  test("documents the three adapter wrappers", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("createFetchWebhookHandler");
    expect(doc).toContain("createBunWebhookServer");
    expect(doc).toContain("createNodeWebhookHandler");
  });

  test("documents the status-code taxonomy (200/400/401/405/413)", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("200");
    expect(doc).toContain("400");
    expect(doc).toContain("401");
    expect(doc).toContain("405");
    expect(doc).toContain("413");
  });

  test("documents WebhookAdapterConfig surface", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("verifyToken");
    expect(doc).toContain("appSecret");
    expect(doc).toContain("maxBodyBytes");
    expect(doc).toContain("logger");
  });

  test("documents WebhookAdapterEvent taxonomy", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("request_received");
    expect(doc).toContain("signature_verified");
    expect(doc).toContain("body_normalized");
    expect(doc).toContain("dispatched");
    expect(doc).toContain("response_sent");
  });

  test("documents edge-runtime safety (no node:* in fetch adapter)", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/edge[- ]runtime/i);
    expect(doc).toMatch(/Cloudflare\s+Workers|Deno|WinterCG/i);
    // Voice-pass reworded "no node:*" → "no `node:*` static imports" / "zero
    // static `node:*` imports" (backticked + interleaved words). Fact survives.
    expect(doc).toMatch(/(?:no|zero)[^\n]{0,20}node:\*/i);
  });

  test("documents error taxonomy codes", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("WebhookAdapterConfigError");
    expect(doc).toContain("invalid_verify_token");
    expect(doc).toContain("invalid_app_secret");
  });

  test("contains a usage code sample importing from @wats/http", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/```[ \t]*(ts|typescript)/i);
    expect(doc).toContain("@wats/http");
  });

  test("ties the doc to the WebhookAdapter feature surface", () => {
    const doc = readFileSync(docPath, "utf8");
    // Voice-pass removed WATS-nn ticket refs, Arch-K labels, and the F-12 phase
    // tag. The substance these guarded — that this doc covers the runtime-neutral
    // WebhookAdapter and its wrappers — survives in the prose/headings.
    expect(doc).toMatch(/WebhookAdapter/);
    expect(doc).toMatch(/runtime[- ]neutral/i);
    expect(doc).toContain("createWebhookAdapter");
  });

  test("documents scope ledger (non-goals)", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/rate[- ]limit/i);
    expect(doc).toMatch(/TLS|HTTPS/i);
  });
});

// ---------------------------------------------------------------------
// docs/guides/deploy-*.md
// ---------------------------------------------------------------------

describe("F-12 deploy guides", () => {
  const repoRoot = findRepoRoot(import.meta.dir);

  test("deploy-bun guide exists and references createBunWebhookServer", () => {
    const docPath = join(repoRoot, "site/content/docs/guides/deploy-bun.mdx");
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("createBunWebhookServer");
    expect(doc).toContain("@wats/http");
    expect(doc).toMatch(/Bun\.serve|Bun runtime/i);
  });

  test("deploy-node guide exists and references createNodeWebhookHandler", () => {
    const docPath = join(repoRoot, "site/content/docs/guides/deploy-node.mdx");
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("createNodeWebhookHandler");
    // Voice-pass uses `createServer` from `node:http` (was "http.createServer").
    expect(doc).toContain("createServer");
    expect(doc).toContain("node:http");
  });

  test("deploy-cloudflare-workers guide exists and references createFetchWebhookHandler", () => {
    const docPath = join(repoRoot, "site/content/docs/guides/deploy-cloudflare-workers.mdx");
    expect(existsSync(docPath)).toBe(true);
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("createFetchWebhookHandler");
    expect(doc).toMatch(/Cloudflare|Workers/i);
  });
});

// ---------------------------------------------------------------------
// http-consumer fixture extension
// ---------------------------------------------------------------------

describe("F-12 http-consumer fixture coverage", () => {
  test("fixture imports WebhookAdapter surface from @wats/http", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const verifyPath = join(
      repoRoot,
      "packages/testing/fixtures/http-consumer/verify-imports.ts"
    );
    const source = readFileSync(verifyPath, "utf8");
    expect(source).toContain("createWebhookAdapter");
    expect(source).toContain("createFetchWebhookHandler");
    expect(source).toContain("WebhookAdapterConfigError");
  });

  test("running the fixture entry emits http-consumer:ok + runs F-12 assertions", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureDir = join(
      repoRoot,
      "packages/testing/fixtures/http-consumer"
    );

    const result = runBun(["run", "verify-imports"], fixtureDir);

    expect(
      result.exitCode,
      `fixture verify-imports failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    ).toBe(0);

    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const lastLine = lines.at(-1);
    expect(lastLine).toBe("http-consumer:ok");

    const jsonLine = lines.at(-2);
    expect(typeof jsonLine).toBe("string");

    const parsed = JSON.parse(jsonLine as string) as {
      ok: boolean;
      sentinel: string;
      checks: Record<string, boolean>;
    };

    expect(parsed.ok).toBe(true);

    const labels = Object.keys(parsed.checks);
    expect(labels).toContain(
      "WebhookAdapter dispatches POST with valid signature (200)"
    );
    expect(labels).toContain(
      "WebhookAdapter rejects POST with invalid signature (401)"
    );
    expect(labels).toContain(
      "WebhookAdapter echoes GET verify challenge (200)"
    );
    expect(labels).toContain(
      "WebhookAdapterConfigError on empty verifyToken (sibling-NOT TypeError)"
    );
    for (const [label, ok] of Object.entries(parsed.checks)) {
      expect(ok, `fixture check "${label}" must report true`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------
// CHANGELOG + parity matrix
// ---------------------------------------------------------------------

describe("F-12 CHANGELOG", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

  test("contains a [0.2.0-f12] section header", () => {
    expect(changelog).toMatch(/\[0\.2\.0-f12\]/);
  });

  test("mentions WebhookAdapter + the three adapter wrappers + edge-runtime", () => {
    expect(changelog).toContain("createWebhookAdapter");
    expect(changelog).toContain("createFetchWebhookHandler");
    expect(changelog).toContain("createBunWebhookServer");
    expect(changelog).toContain("createNodeWebhookHandler");
    expect(changelog).toMatch(/edge[- ]runtime/i);
  });
});

describe("F-12 parity matrix", () => {
  const repoRoot = findRepoRoot(import.meta.dir);
  const matrix = readFileSync(
    join(repoRoot, "site/content/docs/parity.mdx"),
    "utf8"
  );

  test("Webhook adapter row documents the runtime-neutral adapter", () => {
    expect(matrix).toMatch(/WebhookAdapter|webhook adapter/i);
    // Voice-pass removed WATS-nn / F-12 ticket refs from the parity matrix. The
    // row's substance — a runtime-neutral adapter with fetch/Bun/Node wrappers —
    // survives in the row text.
    expect(matrix).toMatch(/runtime[- ]neutral/i);
    expect(matrix).toMatch(/fetch\s*\/\s*Bun\s*\/\s*Node|Bun|Node/i);
  });
});
