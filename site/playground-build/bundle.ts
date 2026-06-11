// playground-build/bundle.ts
//
// T18 — Playground asset pipeline. Bundles the published @wats/* packages
// (re-exported by ./index.ts) into a single browser ESM file plus a bundled
// .d.ts, written into site/public/playground/.
//
//   bun run bundle.ts
//
// Steps:
//   1. esbuild: ./index.ts -> wats-bundle.js (esm, browser, es2022, minified).
//      - conditions: ["browser"] FIRST. We do NOT shim node builtins; if any
//        package pulls one in, esbuild errors (browser platform) and we surface
//        it as a finding rather than papering over it.
//   2. dts-bundle-generator: ./index.ts -> wats-types.d.ts.
//   3. Size gate: fail if gzipped wats-bundle.js > 150KB. Print raw + gz.

import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(here, "index.ts");
const OUT_DIR = resolve(here, "..", "public", "playground");
const OUT_JS = resolve(OUT_DIR, "wats-bundle.js");
const OUT_DTS = resolve(OUT_DIR, "wats-types.d.ts");
const GZ_BUDGET = 150 * 1024; // 150KB gzipped

mkdirSync(OUT_DIR, { recursive: true });

// Node builtins we explicitly refuse to bundle for a browser target. If the
// graph below resolves any of these, the build fails loudly (a FINDING).
const NODE_BUILTINS = [
  "fs", "path", "os", "crypto", "http", "https", "net", "tls", "stream",
  "zlib", "util", "events", "buffer", "child_process", "url", "querystring",
  "assert", "dns", "module", "process", "worker_threads", "perf_hooks",
];
const nodeBuiltinFindings: string[] = [];

console.log("[bundle] entry:", ENTRY);

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  conditions: ["browser"],
  outfile: OUT_JS,
  metafile: true,
  legalComments: "none",
  // Do NOT inject/shim node builtins. Mark them external + collect as findings
  // so a stray node-only import surfaces instead of silently bloating/breaking.
  plugins: [
    {
      name: "node-builtin-detector",
      setup(b) {
        const filter = new RegExp(
          `^(node:)?(${NODE_BUILTINS.join("|")})$`,
        );
        b.onResolve({ filter }, (args) => {
          nodeBuiltinFindings.push(`${args.path}  (imported by ${args.importer})`);
          // Mark external so we can report ALL offenders rather than dying on
          // the first one; the gate below fails the build if any exist.
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

if (result.warnings.length) {
  console.log("[bundle] esbuild warnings:");
  for (const w of result.warnings) console.log("  ", w.text);
}

// --- Node-builtin finding gate ----------------------------------------------
if (nodeBuiltinFindings.length) {
  console.error("\n[bundle] FINDING: node builtins reached the browser bundle:");
  for (const f of [...new Set(nodeBuiltinFindings)]) console.error("  -", f);
  console.error(
    "[bundle] The packages claim browser-safe; this must be investigated, not shimmed.",
  );
  process.exit(1);
}
console.log("[bundle] node-builtin findings: NONE (clean browser graph)");

// --- Size gate ---------------------------------------------------------------
const raw = readFileSync(OUT_JS);
const gz = gzipSync(raw, { level: 9 });
const fmt = (n: number) => `${(n / 1024).toFixed(2)}KB (${n} bytes)`;
console.log(`[bundle] wats-bundle.js raw: ${fmt(raw.length)}`);
console.log(`[bundle] wats-bundle.js gz : ${fmt(gz.length)}`);
console.log(`[bundle] gz budget         : ${fmt(GZ_BUDGET)}`);

// --- Types bundle ------------------------------------------------------------
console.log("[bundle] generating wats-types.d.ts via dts-bundle-generator ...");
try {
  const dtsBin = resolve(here, "node_modules", ".bin", "dts-bundle-generator");
  execFileSync(
    dtsBin,
    [
      "-o", OUT_DTS,
      "--no-check",
      "--export-referenced-types", "false",
      // Inline the actual published @wats/* declarations so the result is a
      // SELF-CONTAINED ambient .d.ts (the playground editor has no node_modules
      // to resolve bare specifiers against).
      "--external-inlines",
      "@wats/core", "@wats/graph", "@wats/types", "@wats/crypto", "@wats/http",
      "--inline-declare-externals",
      "--project", resolve(here, "tsconfig.json"),
      "--", ENTRY,
    ],
    { stdio: "inherit", cwd: here },
  );
  const dts = readFileSync(OUT_DTS);
  console.log(`[bundle] wats-types.d.ts: ${fmt(dts.length)}`);
} catch (err) {
  console.error("[bundle] dts-bundle-generator failed:", (err as Error).message);
  process.exitCode = 2;
}

if (gz.length > GZ_BUDGET) {
  console.error(
    `\n[bundle] SIZE GATE FAILED: gz ${fmt(gz.length)} > budget ${fmt(GZ_BUDGET)}`,
  );
  process.exit(1);
}
console.log("\n[bundle] OK — assets written to", OUT_DIR);
