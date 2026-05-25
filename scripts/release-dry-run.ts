import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLISHABLE_PACKAGES = ["types", "crypto", "graph", "core", "http", "internal-utils", "config", "persistence", "service", "cli"] as const;
const PRIVATE_PACKAGES = ["testing"] as const;

function run(command: string, args: readonly string[]): string {
  const rendered = `${command} ${args.join(" ")}`;
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`${rendered} failed with status ${result.status}\n${output}`);
  }
  return output;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as Record<string, unknown>;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertFile(path: string): void {
  assert(existsSync(join(repoRoot, path)), `Missing required release dry-run file: ${path}`);
}

function assertNoPublishAuthority(scriptText: string): void {
  const forbiddenCommands = [
    ["npm", "publish"],
    ["bun", "publish"],
    ["gh", "release", "create"],
    ["git", "tag"],
    ["git", "push"],
    ["docker", "push"],
    ["registry", "login"]
  ] as const;
  for (const forbiddenParts of forbiddenCommands) {
    const forbidden = forbiddenParts.join(" ");
    assert(!scriptText.includes(forbidden), `release dry-run must not contain side-effecting command: ${forbidden}`);
  }
}

function assertManifestDistShape(pkg: string): void {
  const manifest = readJson(`packages/${pkg}/package.json`) as {
    name?: string;
    private?: boolean;
    main?: string;
    types?: string;
    exports?: Record<string, { import?: string; types?: string }>;
  };
  assert(manifest.private === false, `${manifest.name ?? pkg} must be publishable (private false) for the current release`);
  assert(manifest.main === "./dist/index.js", `${manifest.name ?? pkg} main must point at dist/index.js`);
  assert(manifest.types === "./dist/index.d.ts", `${manifest.name ?? pkg} types must point at dist/index.d.ts`);
  assert(typeof manifest.exports === "object" && manifest.exports !== null, `${manifest.name ?? pkg} exports map required`);
  for (const [key, value] of Object.entries(manifest.exports)) {
    assert(value.import?.startsWith("./dist/"), `${manifest.name ?? pkg} export ${key} import must point at dist`);
    assert(value.types?.startsWith("./dist/"), `${manifest.name ?? pkg} export ${key} types must point at dist`);
  }
}

function assertPrivateGuard(pkg: string): void {
  const manifest = readJson(`packages/${pkg}/package.json`) as { name?: string; private?: boolean; exports?: unknown; files?: unknown };
  assert(manifest.private === true, `${manifest.name ?? pkg} must remain private`);
  assert(manifest.files === undefined, `${manifest.name ?? pkg} must not define publish files`);
}

const scriptText = readFileSync(fileURLToPath(import.meta.url), "utf8");
assertNoPublishAuthority(scriptText);

const dryRunMode = process.env.WATS_RELEASE_DRY_RUN === "1" || process.env.CI === "true";
console.log(`release-dry-run: mode=${dryRunMode ? "WATS_RELEASE_DRY_RUN" : "local"}`);
console.log("release-dry-run: provenance preflight only; no package publication, no GitHub release, no tags/releases, no repository push");

const status = run("git", ["status", "--short"]);
const blockingStatus = status.split("\n").filter((line) => line.length > 0);
assert(blockingStatus.length === 0, `git status --short must be clean before release dry-run\n${status}`);

assertFile("LICENSE");
assertFile("CONTRIBUTING.md");
assertFile("SECURITY.md");
assertFile("CHANGELOG.md");
assertFile("docs/architecture/release-policy.md");

for (const pkg of PUBLISHABLE_PACKAGES) {
  assertManifestDistShape(pkg);
}
for (const pkg of PRIVATE_PACKAGES) {
  assertPrivateGuard(pkg);
}

run("bun", ["run", "typecheck"]);
run("bun", ["run", "build:packages"]);
run("bun", ["run", "pack:smoke"]);
run("bun", ["run", "docs:check"]);

console.log("release-dry-run: provenance preflight passed");
