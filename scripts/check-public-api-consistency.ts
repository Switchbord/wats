import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Manifest {
  readonly schema: "wats.public-api-consistency.v1";
  readonly scope: string;
  readonly graphEndpointSubpaths: readonly GraphEndpointSubpathEntry[];
}

interface GraphEndpointSubpathEntry {
  readonly packageName: "@wats/graph";
  readonly specifier: string;
  readonly exportKey: string;
  readonly source: string;
  readonly dist: string;
  readonly fixture: string;
  readonly fixtureChecks: readonly string[];
  readonly docs: readonly string[];
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_MANIFEST_PATH = "scripts/public-api-consistency-manifest.json";
const EXPECTED_SCHEMA = "wats.public-api-consistency.v1";
const EXPECTED_SCOPE = "@wats/graph endpoint subpaths";
const DOC_PACKET = [
  "docs/reference/index.md",
  "docs/architecture/public-api-surface.md",
  "docs/architecture/package-map.md",
  "docs/migration/pywa-to-wats.md",
  "CHANGELOG.md"
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function failUsage(message: string): never {
  throw new Error(`usage: ${message}`);
}

function manifestPathFromArgs(args: readonly string[]): string {
  if (args.length === 0) return DEFAULT_MANIFEST_PATH;
  if (args.length === 2 && args[0] === "--manifest") return args[1] ?? DEFAULT_MANIFEST_PATH;
  failUsage("bun run scripts/check-public-api-consistency.ts [--manifest <path>]");
}

function safeRepoPath(root: string, path: string, label: string): string {
  if (path.length === 0 || path.startsWith("/") || /[\0\r\n]/u.test(path)) {
    throw new Error(`${label} must be a non-empty relative repo path`);
  }
  const normalized = normalize(path).replace(/\\/gu, "/");
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${label} must stay inside the repository`);
  }
  const absolute = resolve(root, normalized);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || rel.includes("..")) {
    throw new Error(`${label} must stay inside the repository`);
  }
  return absolute;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value.map((item, index) => asString(item, `${label}[${index}]`));
}

function parseManifest(root: string, manifestRelPath: string): Manifest {
  const manifestPath = safeRepoPath(root, manifestRelPath, "manifest path");
  const raw = readJsonFile(manifestPath);
  if (!isRecord(raw)) throw new Error("manifest must be a JSON object");
  if (raw.schema !== EXPECTED_SCHEMA) throw new Error(`manifest schema must be ${EXPECTED_SCHEMA}`);
  if (raw.scope !== EXPECTED_SCOPE) throw new Error(`manifest scope must be ${EXPECTED_SCOPE}`);
  if (!Array.isArray(raw.graphEndpointSubpaths)) {
    throw new Error("manifest graphEndpointSubpaths must be an array");
  }

  const graphEndpointSubpaths = raw.graphEndpointSubpaths.map((entry, index): GraphEndpointSubpathEntry => {
    if (!isRecord(entry)) throw new Error(`manifest entry ${index} must be an object`);
    const packageName = asString(entry.packageName, `manifest entry ${index}.packageName`);
    if (packageName !== "@wats/graph") {
      throw new Error(`manifest entry ${index}.packageName must be @wats/graph`);
    }
    const docs = asStringArray(entry.docs, `manifest entry ${index}.docs`);
    if (JSON.stringify(docs) !== JSON.stringify(DOC_PACKET)) {
      throw new Error(`manifest entry ${index}.docs must match the WATS-54 docs packet`);
    }
    return {
      packageName,
      specifier: asString(entry.specifier, `manifest entry ${index}.specifier`),
      exportKey: asString(entry.exportKey, `manifest entry ${index}.exportKey`),
      source: asString(entry.source, `manifest entry ${index}.source`),
      dist: asString(entry.dist, `manifest entry ${index}.dist`),
      fixture: asString(entry.fixture, `manifest entry ${index}.fixture`),
      fixtureChecks: asStringArray(entry.fixtureChecks, `manifest entry ${index}.fixtureChecks`),
      docs
    };
  });

  return {
    schema: EXPECTED_SCHEMA,
    scope: EXPECTED_SCOPE,
    graphEndpointSubpaths
  };
}

function assertUniqueSpecifiers(entries: readonly GraphEndpointSubpathEntry[]): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const { specifier } of entries) {
    if (seen.has(specifier)) failures.push(`duplicate manifest specifier ${specifier}`);
    seen.add(specifier);
  }
  return failures;
}

function loadPackageExports(root: string, packageName: string): JsonRecord {
  if (packageName !== "@wats/graph") throw new Error(`unsupported package ${packageName}`);
  const manifest = readJsonFile(join(root, "packages/graph/package.json"));
  if (!isRecord(manifest) || !isRecord(manifest.exports)) {
    throw new Error("packages/graph/package.json exports must be an object");
  }
  return manifest.exports;
}

function checkEntry(root: string, entry: GraphEndpointSubpathEntry): string[] {
  const failures: string[] = [];
  const packageExports = loadPackageExports(root, entry.packageName);
  const actualExport = packageExports[entry.exportKey];
  const expectedExport = { types: entry.dist.replace(/\.js$/u, ".d.ts"), import: entry.dist };
  if (JSON.stringify(actualExport) !== JSON.stringify(expectedExport)) {
    failures.push(
      `${entry.specifier}: package export ${entry.exportKey} expected ${JSON.stringify(expectedExport)} but found ${JSON.stringify(actualExport)}`
    );
  }

  const sourceRel = entry.source.replace(/^\.\//u, "packages/graph/");
  if (!existsSync(safeRepoPath(root, sourceRel, `${entry.specifier} source`))) {
    failures.push(`${entry.specifier}: source file missing at ${sourceRel}`);
  }

  const fixturePath = safeRepoPath(root, entry.fixture, `${entry.specifier} fixture`);
  const fixtureText = readFileSync(fixturePath, "utf8");
  for (const needle of entry.fixtureChecks) {
    if (!fixtureText.includes(needle)) {
      failures.push(`${entry.specifier}: fixture ${entry.fixture} missing ${needle}`);
    }
  }

  for (const doc of entry.docs) {
    const docText = readFileSync(safeRepoPath(root, doc, `${entry.specifier} doc`), "utf8");
    if (!docText.includes(entry.specifier)) {
      failures.push(`${entry.specifier}: doc ${doc} missing specifier`);
    }
  }

  return failures;
}

function run(): number {
  const root = repoRoot();
  const manifestRelPath = manifestPathFromArgs(Bun.argv.slice(2));
  const manifest = parseManifest(root, manifestRelPath);
  const failures = [
    ...assertUniqueSpecifiers(manifest.graphEndpointSubpaths),
    ...manifest.graphEndpointSubpaths.flatMap((entry) => checkEntry(root, entry))
  ];

  if (failures.length > 0) {
    console.error("public-api-consistency:fail");
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }

  const docChecks = manifest.graphEndpointSubpaths.reduce((count, entry) => count + entry.docs.length, 0);
  const fixtureChecks = manifest.graphEndpointSubpaths.reduce((count, entry) => count + entry.fixtureChecks.length, 0);
  console.log(
    `public-api-consistency:ok checked ${manifest.graphEndpointSubpaths.length} graph endpoint subpaths docs=${docChecks} fixtureChecks=${fixtureChecks}`
  );
  return 0;
}

try {
  process.exitCode = run();
} catch (error) {
  process.exitCode = 1;
  console.error("public-api-consistency:fail");
  console.error(error instanceof Error ? error.message : String(error));
}
