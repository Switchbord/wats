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

type PackageManifest = {
  name?: string;
  private?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
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

function readPackageManifest(pkg: string): PackageManifest {
  return JSON.parse(readFileSync(join(repoRoot, "packages", pkg, "package.json"), "utf8")) as PackageManifest;
}

function packageNameForPackage(pkg: string): string {
  const packageName = readPackageManifest(pkg).name;
  if (typeof packageName !== "string") throw new Error(`Missing package name for ${pkg}`);
  return packageName;
}

function exportSpecifiersForPackage(pkg: string): string[] {
  const manifest = readPackageManifest(pkg);
  const packageName = packageNameForPackage(pkg);
  if (typeof manifest.exports !== "object" || manifest.exports === null || Array.isArray(manifest.exports)) {
    throw new Error(`${packageName} exports map required for packed export-map smoke`);
  }
  return Object.keys(manifest.exports).map((key) => key === "." ? packageName : `${packageName}${key.slice(1)}`);
}

function writeConsumerSmoke(pkg: string, installRoot: string): void {
  const packageName = packageNameForPackage(pkg);
  const specifiers: string[] = [];
  for (const specifier of exportSpecifiersForPackage(pkg)) {
    specifiers.push(specifier);
  }

  const consumerDir = join(installRoot, `consumer-${pkg}`);
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));

  writeFileSync(
    join(consumerDir, "subpath-smoke.ts"),
    `const specifiers = ${JSON.stringify(specifiers, null, 2)} as const;\n` +
      `for (const specifier of specifiers) {\n` +
      `  const mod = await import(specifier);\n` +
      `  if (typeof mod !== "object" || mod === null) throw new Error(\`runtime import failed for \${specifier}\`);\n` +
      `  if (specifier === ${JSON.stringify(packageName)} && Object.keys(mod).length === 0) throw new Error(\`root export for \${specifier} has no runtime symbols\`);\n` +
      `}\n` +
      `console.log(${JSON.stringify(`${packageName}:export-map-import-ok`)});\n`
  );

  writeFileSync(
    join(consumerDir, "types.ts"),
    specifiers.map((specifier, index) => {
      return `import type * as mod${index} from ${JSON.stringify(specifier)};\n` +
        `type Keys${index} = keyof typeof mod${index};\n` +
        `const ok${index}: Keys${index} | null = null;\n` +
        `void ok${index};\n`;
    }).join("\n")
  );

  run("bun", [join(consumerDir, "subpath-smoke.ts")], consumerDir);
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

    const packageJson = readPackageManifest(pkg);
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

  console.log(`pack-smoke: verified ${PUBLISHABLE_PACKAGES.length} package tarballs including packed export-map import/type smokes; no package publication, npm publish, GitHub release, or registry login performed`);
  console.log("pack-smoke: root LICENSE, CONTRIBUTING.md, and SECURITY.md remain repository-level policy files; package tarballs include package-local dist artifacts only");
} finally {
  rmSync(packRoot, { recursive: true, force: true });
}
