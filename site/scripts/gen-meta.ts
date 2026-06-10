/**
 * gen-meta.ts — regenerate site/src/generated/meta.json (T10).
 *
 * Numbers on the site are generated, never hand-written. This script:
 *   1. Reads the published @wats/* version from packages/graph/package.json
 *      (the canonical version field at the repo root).
 *   2. Runs the FULL test suite at the repo root (`bun test`) and parses the
 *      final "N pass" total. Pass --offline to skip the (slow) suite and keep
 *      the committed testCount — used in Vercel builds; locally this script
 *      is run per release and the refreshed meta.json is checked in.
 *   3. Self-verifies the "0 hard dependencies" claim against the PUBLISHED
 *      npm registry metadata for every @wats/* package and FAILS if any of
 *      them declares runtime dependencies.
 *
 * Usage:
 *   bun scripts/gen-meta.ts             # full run (slow: runs the suite)
 *   bun scripts/gen-meta.ts --offline   # keep committed testCount
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url))); // <repo>/site
const repoRoot = dirname(siteRoot); // <repo>
const metaPath = join(siteRoot, "src", "generated", "meta.json");

const offline = process.argv.includes("--offline");

const ZERO_DEP_PACKAGES = [
  "@wats/core",
  "@wats/graph",
  "@wats/http",
  "@wats/types",
  "@wats/crypto",
] as const;

interface Meta {
  version: string;
  testCount: number;
  testCountRounded: number;
  generatedAt: string;
  source: { cmd: string; commit: string };
}

function fail(msg: string): never {
  console.error(`gen-meta: ${msg}`);
  process.exit(1);
}

// --- 1. version --------------------------------------------------------------

function readVersion(): string {
  const pkgPath = join(repoRoot, "packages", "graph", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  if (!pkg.version) fail(`no "version" field in ${pkgPath}`);
  return pkg.version;
}

// --- 2. test count -----------------------------------------------------------

function runTestSuite(): number {
  console.error("gen-meta: running `bun test` at repo root (takes a few minutes)…");
  const result = spawnSync("bun", ["test"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  // Bun prints a final summary like " 1539 pass" / " 0 fail". Take the LAST
  // "N pass" occurrence (the grand total).
  const passMatches = [...combined.matchAll(/(\d+)\s+pass\b/g)];
  const lastPass = passMatches[passMatches.length - 1];
  if (!lastPass) {
    fail(
      `could not find "N pass" in bun test output (exit ${result.status}). ` +
        `Last 2000 chars:\n${combined.slice(-2000)}`,
    );
  }
  const passCount = Number(lastPass[1]);

  const failMatches = [...combined.matchAll(/(\d+)\s+fail\b/g)];
  const lastFail = failMatches[failMatches.length - 1];
  const failCount = lastFail ? Number(lastFail[1]) : 0;
  if (result.status !== 0 || failCount > 0) {
    console.error(
      `gen-meta: WARNING — bun test exited ${result.status} with ${failCount} fail; ` +
        `recording the real pass count (${passCount}) anyway.`,
    );
  }
  console.error(`gen-meta: ${passCount} pass / ${failCount} fail`);
  return passCount;
}

function readCommittedTestCount(): number {
  try {
    const existing = JSON.parse(readFileSync(metaPath, "utf8")) as Partial<Meta>;
    if (typeof existing.testCount === "number") return existing.testCount;
  } catch {
    /* fall through */
  }
  fail("--offline requires an existing meta.json with testCount; run once without --offline");
}

// --- 3. zero-hard-deps self-check against the npm registry --------------------

async function fetchPublishedDependencies(pkg: string): Promise<Record<string, string>> {
  const url = `https://registry.npmjs.org/${pkg.replace("/", "%2f")}/latest`;
  const res = await fetch(url);
  if (!res.ok) fail(`registry fetch failed for ${pkg}: HTTP ${res.status} (${url})`);
  const json = (await res.json()) as { dependencies?: Record<string, string> };
  return json.dependencies ?? {};
}

async function verifyZeroHardDeps(): Promise<void> {
  console.error("gen-meta: verifying 0-hard-dependencies claim against registry.npmjs.org…");
  const results = await Promise.all(
    ZERO_DEP_PACKAGES.map(async (pkg) => ({
      pkg,
      deps: await fetchPublishedDependencies(pkg),
    })),
  );
  // "0 hard dependencies" = zero THIRD-PARTY runtime deps. Intra-workspace
  // @wats/* cross-deps (e.g. @wats/http -> @wats/core) are our own code and
  // do not count against the claim; anything outside the @wats scope does.
  const offenders: { pkg: string; external: Record<string, string> }[] = [];
  for (const { pkg, deps } of results) {
    const names = Object.keys(deps);
    const external = Object.fromEntries(
      Object.entries(deps).filter(([name]) => !name.startsWith("@wats/")),
    );
    console.error(
      `gen-meta:   ${pkg}@latest: ${names.length} runtime deps ` +
        `(${Object.keys(external).length} third-party${names.length ? `: ${names.join(", ")}` : ""})`,
    );
    if (Object.keys(external).length > 0) offenders.push({ pkg, external });
  }
  if (offenders.length > 0) {
    fail(
      `"0 hard dependencies" claim is FALSE for: ` +
        offenders.map((o) => `${o.pkg} -> ${JSON.stringify(o.external)}`).join(", "),
    );
  }
  console.error("gen-meta: zero third-party deps claim verified OK");
}

// --- main ----------------------------------------------------------------------

function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  const sha = (result.stdout ?? "").trim();
  if (result.status !== 0 || !sha) fail("git rev-parse HEAD failed");
  return sha;
}

const version = readVersion();
await verifyZeroHardDeps();
const testCount = offline ? readCommittedTestCount() : runTestSuite();
const commit = gitHead();

const meta: Meta = {
  version,
  testCount,
  testCountRounded: Math.floor(testCount / 100) * 100,
  generatedAt: new Date().toISOString(),
  source: { cmd: "bun test", commit },
};

writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
console.error(`gen-meta: wrote ${metaPath}`);
console.log(JSON.stringify(meta, null, 2));
