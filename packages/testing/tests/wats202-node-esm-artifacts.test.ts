// WATS-202 — plain-Node24 ESM importability of every public package/subpath
// artifact, plus an authentic behavioral test of the build-time ESM-specifier
// normalizer (scripts/normalize-esm-specifiers.ts), imported directly — no
// copied shim — so the test exercises the exact algorithm the build runs.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeEsmSpecifiers, resolveRelativeSpecifier } from "../../../scripts/normalize-esm-specifiers.ts";

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
  // External consumer dir with a node_modules/@wats symlink farm pointing at the
  // built dist (not source) — like a packed registry consumer. No custom loader.
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

  test("plain Node24 imports @wats/persistence root without ERR_MODULE_NOT_FOUND on ./sqlite", () => {
    const result = runRuntimeProbe("node", ["@wats/persistence"]);
    expect(result.ok, `Node @wats/persistence import failed: ${result.code ?? ""} ${result.message ?? ""}`).toBe(true);
  });

  test("plain Node24 imports every public export-map key with concrete runtime shape", () => {
    const result = runRuntimeProbe("node", ALL_SPECIFIERS);
    expect(result.ok, `Node import probe failed: ${result.code ?? ""} ${result.message ?? ""}`).toBe(true);
    const shapes = result.shapes ?? {};
    for (const specifier of ALL_SPECIFIERS) {
      expect(shapes[specifier], `Node import ${specifier} must have concrete runtime exports`).toBe(true);
    }
  });

  test("Bun imports every public export-map key with concrete runtime shape", () => {
    const result = runRuntimeProbe("bun", ALL_SPECIFIERS);
    expect(result.ok, `Bun import probe failed: ${result.code ?? ""} ${result.message ?? ""}`).toBe(true);
    const shapes = result.shapes ?? {};
    for (const specifier of ALL_SPECIFIERS) {
      expect(shapes[specifier], `Bun import ${specifier} must have concrete runtime exports`).toBe(true);
    }
  });

  test("emitted dist .js and .d.ts relative specifiers carry .js extensions", () => {
    for (const pkg of PUBLISHABLE_PACKAGES) {
      const distDir = join(repoRoot, "packages", pkg, "dist");
      if (!existsSync(distDir)) continue;
      const visit = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { visit(full); continue; }
          if (!entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) continue;
          const text = readFileSync(full, "utf8");
          const re = /\bfrom\s+(["'])(\.{1,2}\/[^"']+)\1/gu;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            const specifier = m[2];
            if (/\.[A-Za-z0-9]+$/.test(specifier)) continue;
            throw new Error(`${full} has extensionless relative specifier ${JSON.stringify(specifier)}`);
          }
        }
      };
      visit(distDir);
    }
  });
});

// Behavioral tests of the ACTUAL normalizer helper imported from
// scripts/normalize-esm-specifiers.ts (no copied shim). Each test builds a tiny
// dist fixture in a temp dir and runs normalizeEsmSpecifiers on it, then asserts
// the on-disk result. The fixture never touches any owned package source.
describe("WATS-202 normalizer behavioral tests (real helper)", () => {
  function makeFixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "wats202-norm-"));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return dir;
  }

  test("relative file target gets .js extension; index target gets /index.js", () => {
    const dir = makeFixture({
      "dist/real.js": "export const R = 1;\n",
      "dist/sub/index.js": "export const S = 2;\n",
      "dist/main.js": 'import { R } from "./real";\nimport { S } from "./sub";\nexport { R, S };\n'
    });
    try {
      const main = join(dir, "dist", "main.js");
      const edits = normalizeEsmSpecifiers(main);
      expect(edits).toBe(2);
      const out = readFileSync(main, "utf8");
      expect(out).toContain('from "./real.js"');
      expect(out).toContain('from "./sub/index.js"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dynamic import() string literal and ImportType declaration are normalized", () => {
    // .d.ts covers the ScriptKind.TS / ImportTypeNode path; both specifiers
    // reference ./lazy (whose .js exists) so each is rewritten to ./lazy.js.
    const dir = makeFixture({
      "dist/lazy.js": "export const L = 1;\n",
      "dist/host.d.ts": [
        'import("./lazy");',
        'export type X = import("./lazy").L;',
        'export { X };',
        ''
      ].join("\n")
    });
    try {
      const host = join(dir, "dist", "host.d.ts");
      normalizeEsmSpecifiers(host);
      const out = readFileSync(host, "utf8");
      expect(out).toContain('import("./lazy.js")');
      expect(out).toContain('import("./lazy.js").L');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dynamic import() string literal in .js is normalized", () => {
    const dir = makeFixture({
      "dist/lazy.js": "export const L = 1;\n",
      "dist/host.js": 'const p = import("./lazy");\nexport { p };\n'
    });
    try {
      const host = join(dir, "dist", "host.js");
      normalizeEsmSpecifiers(host);
      const out = readFileSync(host, "utf8");
      expect(out).toContain('import("./lazy.js")');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fake import-looking strings and comments are preserved even when fake target files exist", () => {
    // Create fake target files so a naive string-replacer WOULD rewrite them;
    // the AST normalizer must still leave them byte-for-byte untouched.
    const dir = makeFixture({
      "dist/real.js": "export const REAL = 1;\n",
      "dist/comment-literal.js": "export const C = 1;\n",
      "dist/string-literal.js": "export const STR = 1;\n",
      "dist/block-comment.js": "export const B = 1;\n",
      "dist/crafted.js": [
        'import { real } from "./real";',
        '// fake: from "./comment-literal";',
        'const trick = "from \\"./string-literal\\"";',
        'const tmpl = `from ${"./template-literal"}`;',
        '/* from "./block-comment" */',
        'export { real };',
        ''
      ].join("\n")
    });
    try {
      const crafted = join(dir, "dist", "crafted.js");
      const edits = normalizeEsmSpecifiers(crafted);
      // Only the one real import is a specifier literal.
      expect(edits).toBe(1);
      const out = readFileSync(crafted, "utf8");
      expect(out).toContain('from "./real.js"');
      expect(out).toContain('// fake: from "./comment-literal";');
      expect(out).toContain('const trick = "from \\"./string-literal\\"";');
      expect(out).toContain('`from ${"./template-literal"}`');
      expect(out).toContain('/* from "./block-comment" */');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing-target relative specifier is left untouched (no silent hiding)", () => {
    const dir = makeFixture({
      "dist/main.js": 'import { ghost } from "./missing";\nexport { ghost };\n'
    });
    try {
      const main = join(dir, "dist", "main.js");
      const edits = normalizeEsmSpecifiers(main);
      expect(edits).toBe(0);
      const out = readFileSync(main, "utf8");
      expect(out).toContain('from "./missing"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolveRelativeSpecifier returns null for bare and already-extended specifiers", () => {
    const dir = makeFixture({ "dist/x.js": "" });
    try {
      const x = join(dir, "dist", "x.js");
      expect(resolveRelativeSpecifier(x, "@wats/core")).toBe(null);
      expect(resolveRelativeSpecifier(x, "node:fs")).toBe(null);
      expect(resolveRelativeSpecifier(x, "./real.js")).toBe(null);
      expect(resolveRelativeSpecifier(x, "./nope")).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("normalization is idempotent — a second pass rewrites nothing", () => {
    const dir = makeFixture({
      "dist/real.js": "export const R = 1;\n",
      "dist/main.js": 'import { R } from "./real";\nexport { R };\n'
    });
    try {
      const main = join(dir, "dist", "main.js");
      const first = normalizeEsmSpecifiers(main);
      expect(first).toBe(1);
      const second = normalizeEsmSpecifiers(main);
      expect(second).toBe(0);
      const out = readFileSync(main, "utf8");
      expect(out).toContain('from "./real.js"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
