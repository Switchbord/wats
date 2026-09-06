// WATS-202 RED — plain-Node24 ESM importability of every public package/subpath artifact.
//
// The build emits `dist/*.js` via `bun build --no-bundle`. Some package sources
// (notably @wats/persistence) use extensionless relative specifiers (`./sqlite`)
// which `bun` resolves transparently but plain Node ESM rejects with
// ERR_MODULE_NOT_FOUND. This test drives real `node` and `bun` subprocesses that
// import every export-map key via the external `@wats/...` specifiers (no custom
// loader, no bundler) and assert meaningful runtime shape per export.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, unknown>;

const PUBLISHABLE_PACKAGES = [
  "types",
  "crypto",
  "graph",
  "core",
  "http",
  "internal-utils",
  "config",
  "persistence",
  "service",
  "cli"
] as const;

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

function readJson(path: string): JsonRecord {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as JsonRecord;
}

function exportSpecifiersForPackage(pkg: string): string[] {
  const manifest = readJson(`packages/${pkg}/package.json`);
  const packageName = manifest.name as string;
  const exportsMap = manifest.exports as Record<string, unknown>;
  if (typeof exportsMap !== "object" || exportsMap === null || Array.isArray(exportsMap)) {
    throw new Error(`${packageName} exports map required`);
  }
  return Object.keys(exportsMap).map((key) => (key === "." ? packageName : `${packageName}${key.slice(1)}`));
}

function distExists(pkg: string): boolean {
  return existsSync(join(repoRoot, "packages", pkg, "dist", "index.js"));
}

interface RuntimeResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly shapes?: Record<string, boolean>;
}

function runRuntimeProbe(runtime: string, specifiers: readonly string[]): RuntimeResult {
  // External consumer dir: a real node_modules/@wats symlink farm pointing at
  // the built dist artifacts (not source), exactly like a packed consumer that
  // installed from the registry. Node ESM resolves bare specifiers by walking
  // up from the importing file for node_modules — the symlink farm makes the
  // external @wats/... specifiers resolve to packages/<pkg>/dist, with no
  // custom loader and no bundler.
  const consumerDir = mkdtempSync(join(tmpdir(), "wats202-esm-"));
  try {
    mkdirSync(join(consumerDir, "node_modules", "@wats"), { recursive: true });
    for (const pkg of PUBLISHABLE_PACKAGES) {
      symlinkSync(join(repoRoot, "packages", pkg), join(consumerDir, "node_modules", "@wats", pkg));
    }
    writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
    const probe = [
      `const specifiers = ${JSON.stringify(specifiers)};`,
      `const shapes = {};`,
      `const failures = [];`,
      `for (const specifier of specifiers) {`,
      `  try {`,
      `    const mod = await import(specifier);`,
      `    if (typeof mod !== "object" || mod === null) { failures.push(specifier + ": not object"); continue; }`,
      `    const keys = Object.keys(mod);`,
      `    if (keys.length === 0) { failures.push(specifier + ": empty namespace"); continue; }`,
      `    // meaningful runtime shape: at least one named export must be a concrete`,
      `    // (non-undefined) value — functions, classes, constants, objects all count.`,
      `    let hasConcrete = false;`,
      `    for (const k of keys) {`,
      `      const v = mod[k];`,
      `      if (v !== undefined && v !== null && (typeof v === "function" || typeof v === "object" || typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "symbol" || typeof v === "bigint")) { hasConcrete = true; }`,
      `    }`,
      `    shapes[specifier] = hasConcrete;`,
      `    if (!shapes[specifier]) failures.push(specifier + ": no concrete runtime exports");`,
      `  } catch (e) {`,
      `    failures.push(specifier + ": " + (e && e.code ? e.code : "throw") + " " + (e && e.message ? e.message.slice(0,200) : ""));`,
      `  }`,
      `}`,
      `if (failures.length > 0) { console.log(JSON.stringify({ ok: false, code: "IMPORT_FAILURE", message: failures.join(" | ") })); process.exit(1); }`,
      `console.log(JSON.stringify({ ok: true, shapes }));`
    ].join("\n");
    writeFileSync(join(consumerDir, "probe.mjs"), probe);
    const result = spawnSync(runtime, [join(consumerDir, "probe.mjs")], {
      cwd: consumerDir,
      encoding: "utf8",
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(repoRoot, ".bun-cache") }
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status !== 0) {
      return { ok: false, code: "EXIT_" + String(result.status), message: output.split("\n").slice(-4).join(" | ") };
    }
    const line = output.split("\n").find((l) => l.startsWith("{")) ?? "";
    try {
      return JSON.parse(line) as RuntimeResult;
    } catch {
      return { ok: false, message: output.split("\n").slice(-4).join(" | ") };
    }
  } finally {
    rmSync(consumerDir, { recursive: true, force: true });
  }
}

const ALL_SPECIFIERS: string[] = PUBLISHABLE_PACKAGES.flatMap((pkg) => exportSpecifiersForPackage(pkg));

describe("WATS-202 plain-Node ESM artifact importability", () => {
  test("dist artifacts are built before this gate runs", () => {
    for (const pkg of PUBLISHABLE_PACKAGES) {
      expect(distExists(pkg), `packages/${pkg}/dist/index.js must exist — run \`bun run build:packages\` first`).toBe(true);
    }
  });

  test("total export-map key count matches the publishable surface", () => {
    expect(ALL_SPECIFIERS.length).toBe(47);
  });

  test("RED: plain Node24 currently fails to import @wats/persistence with ERR_MODULE_NOT_FOUND on ./sqlite", () => {
    // Behavioral subprocess: plain node importing the external specifier via a
    // real node_modules/@wats symlink farm. Before the build-time ESM-specifier
    // normalization, the emitted dist/index.js re-exports from "./sqlite" (no
    // .js) which Node ESM cannot resolve.
    const result = runRuntimeProbe("node", ["@wats/persistence"]);
    if (result.ok) {
      // Fix already landed — RED assertion is satisfied by the GREEN branch.
      expect(result.ok).toBe(true);
    } else {
      expect(result.ok).toBe(false);
      expect(String(result.message)).toContain("sqlite");
    }
  });

  test("GREEN: plain Node24 imports every public export-map key with concrete runtime shape", () => {
    const result = runRuntimeProbe("node", ALL_SPECIFIERS);
    if (!result.ok) {
      throw new Error(`Node import probe failed: ${result.code ?? ""} ${result.message ?? ""}`);
    }
    expect(result.ok).toBe(true);
    const shapes = result.shapes ?? {};
    for (const specifier of ALL_SPECIFIERS) {
      expect(shapes[specifier], `Node import ${specifier} must have concrete runtime exports`).toBe(true);
    }
  });

  test("GREEN: Bun imports every public export-map key with concrete runtime shape", () => {
    const result = runRuntimeProbe("bun", ALL_SPECIFIERS);
    if (!result.ok) {
      throw new Error(`Bun import probe failed: ${result.code ?? ""} ${result.message ?? ""}`);
    }
    expect(result.ok).toBe(true);
    const shapes = result.shapes ?? {};
    for (const specifier of ALL_SPECIFIERS) {
      expect(shapes[specifier], `Bun import ${specifier} must have concrete runtime exports`).toBe(true);
    }
  });
});
