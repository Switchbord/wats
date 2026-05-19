import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const metadataFlag = ["metadata", "=1"].join("");
const metaMtlsCa = "meta-outbound-api-ca-2025-12.pem";

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectV25MetadataDeprecation(path: string): void {
  const doc = read(path);
  const lower = doc.toLowerCase();

  expect(doc).toContain("WATS-96");
  expect(doc).toContain(metadataFlag);
  expect(doc).toContain("v25");
  expect(lower).toContain("deprecat");
  expect(lower).toContain("runtime");
  expect(lower).toMatch(/does not (send|use|append|request)|never (sends|uses|appends|requests)/u);
}

function expectWebhookMtlsBoundary(path: string): void {
  const doc = read(path);
  const lower = doc.toLowerCase();

  expect(doc).toContain("WATS-96");
  expect(doc).toContain("mTLS");
  expect(doc).toContain(metaMtlsCa);
  expect(doc).toContain("HMAC");
  expect(doc).toContain("X-Hub-Signature-256");
  expect(doc).not.toContain("BEGIN CERTIFICATE");
  expect(lower).toContain("app-level hmac");
  expect(lower).toContain("infrastructure-level");
  expect(lower).toContain("client certificate");
  expect(lower).toContain("does not vendor");
  expect(lower).toContain("does not configure");
}

function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) {
        if (entry === "node_modules" || entry === "dist") continue;
        stack.push(join(current, entry));
      }
      continue;
    }
    if (stat.isFile() && /\.tsx?$/u.test(current)) out.push(current);
  }
  return out;
}

function isTestAllowlist(path: string): boolean {
  const normalized = path.replace(/\\/gu, "/");
  return (
    normalized.includes("/packages/testing/tests/") ||
    normalized.includes("/packages/testing/fixtures/") ||
    normalized.includes("/tests/")
  );
}

describe("WATS-96 v25 Graph metadata and webhook mTLS docs", () => {
  test("Graph compatibility docs lock metadata=1 deprecation without runtime use", () => {
    for (const path of [
      "docs/reference/openapi.md",
      "docs/parity/pywa-parity-matrix.md",
      "CHANGELOG.md"
    ]) {
      expectV25MetadataDeprecation(path);
    }
  });

  test("webhook and deploy docs distinguish WATS HMAC from infrastructure mTLS", () => {
    for (const path of [
      "docs/reference/webhook.md",
      "docs/guides/deploy-bun.md",
      "docs/guides/deploy-node.md",
      "docs/guides/deploy-cloudflare-workers.md",
      "docs/guides/deploy-docker.md",
      "docs/parity/pywa-parity-matrix.md",
      "CHANGELOG.md"
    ]) {
      expectWebhookMtlsBoundary(path);
    }
  });

  test("runtime and generation TypeScript do not bake in the deprecated metadata query flag", () => {
    const roots = [join(repoRoot, "packages"), join(repoRoot, "scripts")];
    const offenders = roots
      .flatMap(walkTsFiles)
      .filter((path) => !isTestAllowlist(path))
      .filter((path) => readFileSync(path, "utf8").includes(metadataFlag))
      .map((path) => relative(repoRoot, path).replace(/\\/gu, "/"));

    expect(offenders).toEqual([]);
  });
});
