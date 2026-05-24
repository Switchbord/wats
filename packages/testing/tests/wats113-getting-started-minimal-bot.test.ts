import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type PublicDocsManifest = { pages?: unknown };

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
const exampleRoot = "examples/minimal-bot";
const gettingStartedPath = "docs/getting-started.md";

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
    if (entry.isDirectory()) files.push(...walkFiles(relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

const rawSecretPatterns = [
  /(?:access[_-]?token|bearer[_-]?token|service[_-]?token|verify[_-]?token|app[_-]?secret|webhook[_-]?secret)\s*[:=]\s*["']?(?!\*{3}|<|>|\$\{|process\.env|env:|$)[A-Za-z0-9_./+=-]{12,}["']?/iu,
  /Authorization\s*[:=]\s*["']?Bearer\s+(?!<|\$\{|process\.env|DEMO_SERVICE_TOKEN|example-service-token)[A-Za-z0-9_.-]{12,}["']?/iu,
  /\bEAA[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]*:[^\s"'<>]*@[^\s"'<>]+/iu,
  /\b(?:WABA|PHONE|WHATSAPP|BUSINESS)[_-]?(?:ID|ACCOUNT)[_-]?[:=]\s*["']?[1-9][0-9]{10,}["']?/iu,
  /\bsk_live_[A-Za-z0-9_-]{12,}\b/u
];

function expectNoRawSecrets(path: string): void {
  const text = read(path);
  for (const pattern of rawSecretPatterns) {
    expect(text, `${path} should not contain raw-looking secrets matching ${pattern}`).not.toMatch(pattern);
  }
}

function run(command: string, args: readonly string[], cwd = repoRoot): { status: number | null; output: string } {
  const completed = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env } });
  return { status: completed.status, output: `${completed.stdout ?? ""}${completed.stderr ?? ""}` };
}

describe("WATS-113 getting-started minimal bot", () => {
  test("public docs and examples index link a 60-second offline minimal bot onramp", () => {
    const manifest = readJson<PublicDocsManifest>("docs/public-docs-manifest.json");
    const gettingStarted = read(gettingStartedPath);
    const examplesReadme = read("examples/README.md");
    const communityGuide = read("docs/guides/community-examples.md");

    expect(Array.isArray(manifest.pages)).toBe(true);
    expect(manifest.pages).toContain("getting-started.md");
    expect(gettingStarted).toContain("60-second offline onramp");
    expect(gettingStarted).toContain("examples/minimal-bot");
    expect(gettingStarted).toContain("bun run demo");
    expect(gettingStarted).toContain("curl -s -X POST http://127.0.0.1:8787/api/messages/text");
    expect(gettingStarted).toContain("No live Meta credentials are required");
    expect(gettingStarted).toContain("MockTransport");
    expect(gettingStarted).toContain("synthetic webhook envelope");
    expect(examplesReadme).toContain("examples/minimal-bot");
    expect(examplesReadme).toContain("WATS-113");
    expect(communityGuide).toContain("examples/minimal-bot");
  });

  test("minimal bot package is a complete runnable workspace example", () => {
    expect(existsSync(absolute(`${exampleRoot}/README.md`))).toBe(true);
    expect(existsSync(absolute(`${exampleRoot}/package.json`))).toBe(true);
    expect(existsSync(absolute(`${exampleRoot}/src/index.ts`))).toBe(true);

    const manifest = readJson<Record<string, unknown>>(`${exampleRoot}/package.json`);
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
    expect((manifest.scripts as Record<string, string>).demo).toBe("bun run src/index.ts");
    expect((manifest.dependencies as Record<string, string>)["@wats/service"]).toBe("workspace:*");
    expect((manifest.dependencies as Record<string, string>)["@wats/graph"]).toBe("workspace:*");
  });

  test("minimal bot source stays offline, public-package-only, and demonstrates service plus template intent", () => {
    const source = read(`${exampleRoot}/src/index.ts`);
    expect(source).toContain("createWatsServiceApp");
    expect(source).toContain("createMockTransport");
    expect(source).toContain("syntheticWebhookEnvelope");
    expect(source).toContain("sendTemplateIntent");
    expect(source).not.toContain("createFetchTransport");
    expect(source).not.toMatch(/from\s+["'][.]{1,2}\/.*packages\/[^"']*\/src[^"']*["']/u);
    expect(source).not.toMatch(/packages\/[^\s"']+\/src/u);

    const importSpecifiers = Array.from(source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu)).map((match) => match[1] ?? "");
    expect(importSpecifiers).toContain("@wats/service");
    expect(importSpecifiers).toContain("@wats/graph/testing");
    for (const specifier of importSpecifiers) {
      if (specifier.includes("wats") || specifier.includes("packages/")) {
        expect(specifier).toMatch(/^@wats\/[a-z0-9-]+(?:\/testing)?$/u);
      }
    }
  });

  test("minimal bot demo runs in CI without credentials and exercises text plus template paths", () => {
    const result = run("bun", ["run", "demo"], absolute(exampleRoot));
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("wats-minimal-bot:ready");
    expect(result.output).toContain("textStatus=200");
    expect(result.output).toContain("templateIntent=recorded");
    expect(result.output).toContain("syntheticWebhookUpdates=1");
    expect(result.output).toContain("graphRequests=1");
    expect(result.output).not.toMatch(/ACCESS_TOKEN|APP_SECRET|SERVICE_BEARER|Bearer\s+[A-Za-z0-9_.-]{12,}/u);
  });

  test("CI workflow and root scripts run the minimal bot smoke", () => {
    const rootManifest = readJson<{ scripts?: Record<string, string> }>("package.json");
    const workflow = read(".github/workflows/ci.yml");
    expect(rootManifest.scripts?.["examples:minimal-bot"]).toBe("bun run --cwd examples/minimal-bot demo");
    expect(workflow).toContain("Run minimal bot example smoke");
    expect(workflow).toContain("bun run examples:minimal-bot");
  });

  test("minimal bot docs and files are credential-safe", () => {
    const files = [gettingStartedPath, "examples/README.md", ...walkFiles(exampleRoot)]
      .filter((path) => statSync(absolute(path)).isFile())
      .filter((path) => ![".lockb", ".png", ".jpg"].includes(extname(path)));
    expect(files).toContain(`${exampleRoot}/README.md`);
    expect(files).toContain(`${exampleRoot}/src/index.ts`);
    for (const path of files) expectNoRawSecrets(path);
  });
});
