import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PUBLISHABLE_PACKAGES, readReleaseVersion, repoRoot } from "./release-metadata";

const packRoot = mkdtempSync(join(tmpdir(), "wats-pack-smoke-"));
const VERSION = readReleaseVersion();

const INTERNAL_WORKSPACE_DEPS: Record<string, readonly string[]> = {
  core: ["graph", "types"],
  http: ["crypto", "core", "types"],
  service: ["config", "core", "http", "graph", "crypto"],
  cli: ["config", "service"]
};

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(repoRoot, ".bun-cache") }
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}\n${output}`);
  }
  return output;
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} missing ${needle}\n${haystack}`);
  }
}

function assertExcludes(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) {
    throw new Error(`${label} unexpectedly included ${needle}\n${haystack}`);
  }
}

function writeConsumerSmoke(pkg: string, installRoot: string): void {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "packages", pkg, "package.json"), "utf8")) as { name?: string };
  const packageName = packageJson.name;
  if (typeof packageName !== "string") throw new Error(`Missing package name for ${pkg}`);

  const consumerDir = join(installRoot, `consumer-${pkg}`);
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  writeFileSync(join(consumerDir, "smoke.ts"), `import * as mod from ${JSON.stringify(packageName)};\nif (Object.keys(mod).length === 0) throw new Error(${JSON.stringify(`${packageName} exported no runtime symbols`)});\nconsole.log(${JSON.stringify(`${packageName}:import-ok`)});\n`);
  writeFileSync(join(consumerDir, "types.ts"), `import type * as mod from ${JSON.stringify(packageName)};\ntype Keys = keyof typeof mod;\nconst ok: Keys | null = null;\nvoid ok;\n`);
  run("bun", [join(consumerDir, "smoke.ts")], consumerDir);
  run("bunx", ["tsc", "--noEmit", "--module", "NodeNext", "--target", "ES2022", "--moduleResolution", "NodeNext", "--strict", "--skipLibCheck", join(consumerDir, "types.ts")], consumerDir);
}

try {
  const installRoot = join(packRoot, "install");
  const scopedRoot = join(installRoot, "node_modules", "@switchbord");
  mkdirSync(scopedRoot, { recursive: true });

  for (const pkg of PUBLISHABLE_PACKAGES) {
    const packageDir = join(repoRoot, "packages", pkg);
    const dryRunOutput = run("bun", ["pm", "pack", "--dry-run", "--ignore-scripts"], packageDir);
    const label = `@switchbord/${pkg} dry-run pack`;
    assertIncludes(dryRunOutput, "package.json", label);
    assertIncludes(dryRunOutput, "dist/index.js", label);
    assertIncludes(dryRunOutput, "dist/index.d.ts", label);
    assertExcludes(dryRunOutput, "src/index.ts", label);
    assertExcludes(dryRunOutput, ".env", label);
    assertExcludes(dryRunOutput, "node_modules", label);

    const tarballName = `${pkg}.tgz`;
    const packOutput = run(
      "bun",
      ["pm", "pack", "--ignore-scripts", "--filename", tarballName, "--quiet"],
      packageDir
    ).trim();
    assertIncludes(packOutput, tarballName, `${label} tarball output`);
    const tarballPath = join(repoRoot, tarballName);
    const smokeTarballPath = join(packRoot, tarballName);
    renameSync(tarballPath, smokeTarballPath);

    const tarList = run("tar", ["-tzf", smokeTarballPath], repoRoot);
    assertIncludes(tarList, "package/package.json", `${label} tarball`);
    assertIncludes(tarList, "package/dist/index.js", `${label} tarball`);
    assertIncludes(tarList, "package/dist/index.d.ts", `${label} tarball`);
    assertExcludes(tarList, "package/src/index.ts", `${label} tarball`);
    assertExcludes(tarList, "package/node_modules", `${label} tarball`);

    const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      name?: string;
      private?: boolean;
      main?: string;
      types?: string;
    };
    if (packageJson.private !== false) {
      throw new Error(`${packageJson.name ?? pkg} must be publishable (private false) for the current release smoke gate`);
    }
    if (packageJson.main !== "./dist/index.js" || packageJson.types !== "./dist/index.d.ts") {
      throw new Error(`${packageJson.name ?? pkg} must point main/types at dist artifacts`);
    }

    run("tar", ["-xzf", smokeTarballPath, "-C", scopedRoot], repoRoot);
    renameSync(join(scopedRoot, "package"), join(scopedRoot, pkg));
  }

  for (const pkg of PUBLISHABLE_PACKAGES) {
    for (const dep of INTERNAL_WORKSPACE_DEPS[pkg] ?? []) {
      const packageJsonPath = join(scopedRoot, pkg, "package.json");
      const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { dependencies?: Record<string, string> };
      if (manifest.dependencies?.[`@switchbord/${dep}`]?.startsWith("workspace:")) {
        manifest.dependencies[`@switchbord/${dep}`] = VERSION;
        writeFileSync(packageJsonPath, JSON.stringify(manifest, null, 2));
      }
    }
    writeConsumerSmoke(pkg, installRoot);
    if (pkg === "cli") {
      const cliBin = join(scopedRoot, "cli", "dist", "bin.js");
      const binText = readFileSync(cliBin, "utf8");
      if (!binText.startsWith("#!/usr/bin/env bun")) {
        throw new Error("@switchbord/cli packed bin must preserve the Bun shebang for package-manager installs");
      }
      run(cliBin, ["--help"], installRoot);
    }
  }

  console.log(`pack-smoke: verified ${PUBLISHABLE_PACKAGES.length} package tarballs including packed import/type smokes; no package publication, npm publish, GitHub release, or registry login performed`);
  console.log("pack-smoke: root LICENSE, CONTRIBUTING.md, and SECURITY.md remain repository-level policy files; package tarballs include package-local dist artifacts only");
} finally {
  rmSync(packRoot, { recursive: true, force: true });
}
