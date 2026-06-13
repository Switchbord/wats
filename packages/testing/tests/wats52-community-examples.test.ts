import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

type PublicDocsManifest = {
  pages?: unknown;
};

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; private?: boolean };
      if (manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);
const guidePath = "site/content/docs/guides/community-examples.mdx";
const examplesReadmePath = "examples/README.md";

function absolute(path: string): string {
  return join(repoRoot, path);
}

function read(path: string): string {
  return readFileSync(absolute(path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function walkFiles(startPath: string): string[] {
  if (!existsSync(absolute(startPath))) return [];
  const entries = readdirSync(absolute(startPath), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = `${startPath}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...walkFiles(relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

function expectMentionsCommunitySafety(text: string): void {
  // Voice-pass removed the "WATS-52" ticket ref from the published guide MDX
  // (the examples/README.md keeps it). Guard the safety-contract substance,
  // not the ticket id.
  expect(text).toMatch(/community examples/iu);
  expect(text).toMatch(/offline by default/iu);
  expect(text).toContain("MockTransport");
  expect(text).toMatch(/synthetic webhook (payloads|envelopes)/iu);
  // Voice-pass reworded the guide to "Webhook tunnel ... (credential-gated)" /
  // "credential-gated guidance" rather than the exact "credential-gated webhook
  // tunnel" string (README keeps that order). Match credential-gated co-occurring
  // with webhook-tunnel guidance in either order.
  expect(text).toMatch(/credential-gated[^.]*tunnel|tunnel[^.]*credential-gated/iu);
}

const falseAvailabilityClaims = [
  /(?:run|start|use)\s+`?wats serve`?\s+(?:to|for|in|with|as)\s+(?:live|production|production-ready|Docker|credentialed|live credentials|real credentials)/iu,
  /`?wats serve`?\s+(?:is|now|currently)\s+(?:live|production-ready|dockerized|credentialed|ready for production)/iu,
  /Docker image\s+(?:is|has been|was)\s+published/iu,
  /published\s+Docker image/iu,
  /GitHub release\s+(?:is|has been|was)\s+published/iu,
  /published\s+GitHub release/iu,
  /wats\/wats\s+(?:is|has been|was|now)\s+(?:available|published|released|created|pushed)/iu
];

function expectNoFalseAvailabilityClaims(text: string): void {
  for (const pattern of falseAvailabilityClaims) {
    expect(text).not.toMatch(pattern);
  }
}

function expectFalseAvailabilityClaimIsCaught(text: string): void {
  expect(falseAvailabilityClaims.some((pattern) => pattern.test(text)), text).toBe(true);
}

const rawSecretPatterns = [
  /(?:access[_-]?token|bearer[_-]?token|service[_-]?token|verify[_-]?token|app[_-]?secret|webhook[_-]?secret)\s*[:=]\s*["']?(?!\*{3}|<|>|\$\{|process\.env|env:|$)[A-Za-z0-9_./+=-]{12,}["']?/iu,
  /Authorization\s*[:=]\s*["']?Bearer\s+(?!<|\$\{|process\.env)[A-Za-z0-9_.-]{12,}["']?/iu,
  /\bEAA[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]*:[^\s"'<>]*@[^\s"'<>]+/iu,
  /\b(?:whatsapp_business_account_id|phone_number_id)_[A-Za-z0-9_-]+\b/iu,
  /\b(?:WABA|PHONE|WHATSAPP|BUSINESS)[_-]?(?:ID|ACCOUNT)[_-]?[:=]\s*["']?[1-9][0-9]{10,}["']?/iu,
  /\bsk_live_[A-Za-z0-9_-]{12,}\b/u
];

function expectNoRawSecrets(path: string): void {
  const text = read(path);
  for (const pattern of rawSecretPatterns) {
    expect(text, `${path} should not contain raw-looking secrets matching ${pattern}`).not.toMatch(pattern);
  }
}

function isExampleCodeFile(path: string): boolean {
  if (path === examplesReadmePath) return false;
  if (path.startsWith("examples/config/") && [".json", ".yaml", ".yml"].includes(extname(path))) return false;
  return [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"].includes(extname(path));
}

describe("WATS-52 community examples docs scaffold", () => {
  test("public guide and examples README exist and the guide is in the public pages manifest", () => {
    expect(existsSync(absolute(guidePath)), `${guidePath} should exist`).toBe(true);
    expect(existsSync(absolute(examplesReadmePath)), `${examplesReadmePath} should exist`).toBe(true);

    // Repointed from the retired VitePress docs/public-docs-manifest.json (which
    // listed file paths) to the new prerendered-routes manifest
    // site/public-pages-manifest.json (which lists ROUTES). Same intent: the
    // community-examples guide must be part of the published public docs surface.
    const manifest = readJson<PublicDocsManifest>("site/public-pages-manifest.json");
    expect(Array.isArray(manifest.pages)).toBe(true);
    expect(manifest.pages).toContain("/docs/guides/community-examples");
  });

  test("guide and examples README document the offline community examples safety contract", () => {
    const guide = read(guidePath);
    const examplesReadme = read(examplesReadmePath);

    expectMentionsCommunitySafety(guide);
    expectMentionsCommunitySafety(examplesReadme);

    for (const configPath of [
      "examples/config/wats.config.example.yaml",
      "examples/config/wats.config.example.json",
      ".env.example"
    ]) {
      expect(guide).toContain(configPath);
    }
  });

  test("community docs are honest about unavailable runtime, release, and repository claims", () => {
    const guide = read(guidePath);
    const examplesReadme = read(examplesReadmePath);

    expectNoFalseAvailabilityClaims(guide);
    expectNoFalseAvailabilityClaims(examplesReadme);
  });

  test("false availability guard still catches live, Docker, and production serve claims", () => {
    for (const claim of [
      "run `wats serve` in production",
      "use `wats serve` with live credentials",
      "start `wats serve` with Docker",
      "`wats serve` is production-ready"
    ]) {
      expectFalseAvailabilityClaimIsCaught(claim);
    }
  });

  test("example code imports only public WATS package specifiers", () => {
    const codeFiles = walkFiles("examples").filter(isExampleCodeFile);
    for (const path of codeFiles) {
      const text = read(path);
      expect(text, `${path} must not import WATS package internals`).not.toMatch(
        /from\s+["'][.]{1,2}\/.*packages\/[^"']*\/src[^"']*["']/u
      );
      expect(text, `${path} must not reference repo package src internals`).not.toMatch(/packages\/[^\s"']+\/src/u);

      const importSpecifiers = Array.from(text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu)).map(
        (match) => match[1] ?? ""
      );
      for (const specifier of importSpecifiers) {
        if (specifier.includes("wats") || specifier.includes("packages/")) {
          expect(specifier, `${path} should use public @wats/* package specifiers`).toMatch(
            /^@wats\/[a-z0-9-]+(?:\/testing|\/endpoints\/[a-z0-9-]+)?$/u
          );
        }
      }
    }
  });

  test("community docs and examples contain no raw-looking secrets or live IDs", () => {
    const filesToScan = [guidePath, ...walkFiles("examples")].filter((path) => statSync(absolute(path)).isFile());
    expect(filesToScan).toContain(examplesReadmePath);
    for (const path of filesToScan) expectNoRawSecrets(path);
  });

  test("guide does not infer delivered/read state from send success", () => {
    const guide = read(guidePath);
    expect(guide).toMatch(/delivered.*read.*observed webhook\/event-store evidence/isu);
    // Voice-pass reworded "not from send success" → "do not infer ... `delivered`
    // or `read` from send success". Allow the intervening words; the guard that
    // the guide refuses to derive delivery/read state from send success survives.
    expect(guide).toMatch(/not\s+(?:infer|claim)[^.]*\b(?:from|by)\s+send success/iu);
  });
});
