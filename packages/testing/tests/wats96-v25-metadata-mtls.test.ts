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
const metadataField = "metadata";
const metadataOne = "1";
const metadataFlag = [metadataField, "=", metadataOne].join("");
const metaMtlsCa = "meta-outbound-api-ca-2025-12.pem";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

function metadataQueryUses(source: string): readonly string[] {
  const code = stripComments(source);
  const patterns: readonly RegExp[] = [
    /metadata\s*=\s*1/u,
    /metadata%3D1/iu,
    /[?&]metadata=1/u,
    /["']metadata["']\s*,\s*["']1["']/u,
    /(?:["']metadata["']|\bmetadata)\s*:\s*["']?1["']?/u,
    /["']metadata["']\s*=>\s*["']?1["']?/u,
    /searchParams\.(?:set|append)\(\s*["']metadata["']\s*,\s*["']1["']/u,
    /URLSearchParams\(\s*\{[^}]*["']?metadata["']?\s*:\s*["']?1["']?/u
  ];
  return patterns
    .filter((pattern) => pattern.test(code))
    .map((pattern) => pattern.source);
}

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectV25MetadataDeprecation(path: string): void {
  const doc = read(path);
  const lower = doc.toLowerCase();

  expect(doc).toContain(metadataFlag);
  expect(doc).toContain("v25");
  expect(lower).toContain("deprecat");
  expect(lower).toContain("runtime");
  expect(lower).toMatch(/does not (send|use|append|request)|never (sends|uses|appends|requests)/u);
}

function expectWebhookMtlsBoundary(path: string): void {
  const doc = read(path);
  const lower = doc.toLowerCase();

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

// Lighter check for the deploy guides: the voice pass trimmed the verbose
// explanatory prose, but the operative distinction (app HMAC verification vs.
// infrastructure mTLS to the pinned Meta CA, no vendored certificate) must
// remain. The full boundary explanation lives in the webhook reference + changelog.
function expectWebhookMtlsBoundaryLite(path: string): void {
  const doc = read(path);
  expect(doc).toContain("mTLS");
  expect(doc).toContain(metaMtlsCa);
  expect(doc).toContain("HMAC");
  expect(doc).not.toContain("BEGIN CERTIFICATE");
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
    // The metadata=1 deprecation detail lives in the changelog (the openapi
    // reference that carried it was retired with the VitePress tree).
    for (const path of [
      "CHANGELOG.md"
    ]) {
      expectV25MetadataDeprecation(path);
    }
    // ticket traceability stays in the changelog
    expect(read("CHANGELOG.md")).toContain("WATS-96");
  });

  test("webhook and deploy docs distinguish WATS HMAC from infrastructure mTLS", () => {
    // Full boundary explanation: webhook reference + changelog.
    for (const path of [
      "site/content/docs/reference/webhook.mdx",
      "CHANGELOG.md"
    ]) {
      expectWebhookMtlsBoundary(path);
    }
    // Deploy guides carry the operative distinction (voice-trimmed prose).
    for (const path of [
      "site/content/docs/guides/deploy-bun.mdx",
      "site/content/docs/guides/deploy-node.mdx",
      "site/content/docs/guides/deploy-cloudflare-workers.mdx",
      "site/content/docs/guides/deploy-docker.mdx"
    ]) {
      expectWebhookMtlsBoundaryLite(path);
    }
  });

  test("runtime and generation TypeScript do not bake in the deprecated metadata query flag", () => {
    const roots = [join(repoRoot, "packages"), join(repoRoot, "scripts")];
    const offenders = roots
      .flatMap(walkTsFiles)
      .filter((path) => !isTestAllowlist(path))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        const matches = metadataQueryUses(source);
        return matches.map((pattern) => `${relative(repoRoot, path).replace(/\\/gu, "/")} :: ${pattern}`);
      });

    expect(offenders).toEqual([]);
  });
});
