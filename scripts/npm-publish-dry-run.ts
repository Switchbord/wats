import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PUBLISHABLE_PACKAGES, readReleaseVersion, repoRoot } from "./release-metadata";

const packRoot = mkdtempSync(join(tmpdir(), "wats-npm-publish-dry-run-"));
const VERSION = readReleaseVersion();

const INTERNAL_WORKSPACE_DEPS: Record<string, readonly string[]> = {
  core: ["graph", "types"],
  http: ["crypto", "core", "types"],
  service: ["config", "core", "http", "graph", "crypto"],
  cli: ["config", "service"],
  config: ["internal-utils"]
};

type Manifest = {
  name?: string;
  version?: string;
  private?: boolean;
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  main?: string;
  types?: string;
};

function run(command: string, args: readonly string[], cwd: string): string {
  const rendered = `${command} ${args.join(" ")}`;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(repoRoot, ".bun-cache") }
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${rendered} failed with status ${result.status}\n${output}`);
  return output;
}

function readManifest(pkg: string): Manifest {
  return JSON.parse(readFileSync(join(repoRoot, "packages", pkg, "package.json"), "utf8")) as Manifest;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertNoPublishSideEffects(scriptText: string): void {
  const forbiddenPatterns = [
    /spawnSync\(\s*["']npm["']\s*,\s*\[[^\]]*["']publish["']/s,
    /spawnSync\(\s*["']bun["']\s*,\s*\[[^\]]*["']publish["']/s,
    /spawnSync\(\s*["']gh["']\s*,\s*\[[^\]]*["']release["'][^\]]*["']create["']/s,
    /spawnSync\(\s*["']git["']\s*,\s*\[[^\]]*["']tag["']/s,
    /spawnSync\(\s*["']git["']\s*,\s*\[[^\]]*["']push["']/s,
    /spawnSync\(\s*["']docker["']\s*,\s*\[[^\]]*["']push["']/s,
    /spawnSync\(\s*["']registry["']\s*,\s*\[[^\]]*["']login["']/s
  ];
  for (const forbidden of forbiddenPatterns) {
    assert(!forbidden.test(scriptText), `publish dry-run script must not execute side-effecting command pattern: ${forbidden}`);
  }
}

function assertManifest(pkg: string): Manifest {
  const manifest = readManifest(pkg);
  assert(manifest.name === `@wats/${pkg}`, `${pkg} package name mismatch`);
  assert(manifest.version === VERSION, `${pkg} must be version ${VERSION}`);
  assert(manifest.private === false, `${pkg} must be publishable (private false) for alpha launch`);
  assert(manifest.publishConfig?.access === "public", `${pkg} must publish with public access`);
  assert(manifest.main === "./dist/index.js", `${pkg} main must point to dist`);
  assert(manifest.types === "./dist/index.d.ts", `${pkg} types must point to dist`);
  for (const [dep, spec] of Object.entries(manifest.dependencies ?? {})) {
    assert(!spec.includes("workspace:"), `${pkg} dependency ${dep} must not use workspace protocol`);
  }
  return manifest;
}

function rewriteInternalDeps(manifestPath: string): void {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  for (const [dep, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (dep.startsWith("@wats/") && spec.startsWith("^")) {
      manifest.dependencies![dep] = VERSION;
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

try {
  const scriptText = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assertNoPublishSideEffects(scriptText);
  run("bun", ["run", "build:packages"], repoRoot);

  const scopedRoot = join(packRoot, "install", "node_modules", "@wats");
  mkdirSync(scopedRoot, { recursive: true });

  for (const pkg of PUBLISHABLE_PACKAGES) {
    assertManifest(pkg);
    const packageDir = join(repoRoot, "packages", pkg);
    const tarballName = `${pkg}.tgz`;
    const dryRun = run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], packageDir);
    assert(dryRun.includes("dist/index.js"), `${pkg} npm pack dry-run must include dist/index.js`);
    assert(dryRun.includes("dist/index.d.ts"), `${pkg} npm pack dry-run must include dist/index.d.ts`);
    assert(!dryRun.includes("src/index.ts"), `${pkg} npm pack dry-run must not include source entrypoint`);

    run("npm", ["pack", "--ignore-scripts", "--pack-destination", repoRoot], packageDir);
    const generated = `${manifestFileSafeName(pkg)}-${VERSION}.tgz`;
    renameSync(join(repoRoot, generated), join(packRoot, tarballName));
    const tarList = run("tar", ["-tzf", join(packRoot, tarballName)], repoRoot);
    assert(tarList.includes("package/dist/index.js"), `${pkg} tarball missing dist/index.js`);
    assert(tarList.includes("package/dist/index.d.ts"), `${pkg} tarball missing dist/index.d.ts`);
    assert(!tarList.includes("package/src/index.ts"), `${pkg} tarball must not include src/index.ts`);
    run("tar", ["-xzf", join(packRoot, tarballName), "-C", scopedRoot], repoRoot);
    renameSync(join(scopedRoot, "package"), join(scopedRoot, pkg));
  }

  for (const pkg of PUBLISHABLE_PACKAGES) {
    const manifestPath = join(scopedRoot, pkg, "package.json");
    rewriteInternalDeps(manifestPath);
    const consumerDir = join(packRoot, `consumer-${pkg}`);
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    cpSync(dirname(scopedRoot), join(consumerDir, "node_modules"), { recursive: true });
    const packageName = readManifest(pkg).name;
    writeFileSync(join(consumerDir, "smoke.ts"), `import * as mod from ${JSON.stringify(packageName)};\nif (Object.keys(mod).length === 0) throw new Error("empty export");\n`);
    run("bun", [join(consumerDir, "smoke.ts")], consumerDir);
  }

  console.log(`npm-publish-dry-run: verified ${PUBLISHABLE_PACKAGES.length} public package tarballs for ${VERSION}; no package publication, GitHub release, tag, push, or registry login performed`);
} finally {
  rmSync(packRoot, { recursive: true, force: true });
}

function manifestFileSafeName(pkg: string): string {
  return `wats-${pkg}`;
}
