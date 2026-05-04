import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }
  return parsed;
}

function includesWorkspacePackagesGlob(workspaces: unknown): boolean {
  if (Array.isArray(workspaces)) {
    return workspaces.includes("packages/*");
  }
  if (isJsonRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.includes("packages/*");
  }
  return false;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (includesWorkspacePackagesGlob(manifest.workspaces)) {
        return currentDir;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate workspace root from ${startDir}`);
    }
    currentDir = parentDir;
  }
}

function walkTypeScriptFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const currentDir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) {
        continue;
      }
      const entryPath = join(currentDir, entry);
      const entryStat = statSync(entryPath);
      if (entryStat.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entryStat.isFile() && (entry.endsWith(".ts") || entry.endsWith(".tsx"))) {
        results.push(entryPath);
      }
    }
  }
  return results;
}

// Matches ES static imports that reference a "node:*" specifier, covering
// both `import "..."` and `import X from "..."` forms, for quoted specifiers
// with single or double quotes. Multi-line scan.
const NODE_STATIC_IMPORT_REGEXP =
  /^\s*import\s+(?:[^'";]+\s+from\s+)?['"]node:[^'"]+['"]/m;

// Matches top-level `export ... from "node:*"` re-exports.
const NODE_STATIC_EXPORT_REGEXP =
  /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]node:[^'"]+['"]/m;

// Static `node:*` specifier used in an import/export form (covers both
// the import and re-export cases; primary guard applied to every file).
function hasStaticNodeReference(source: string): boolean {
  return (
    NODE_STATIC_IMPORT_REGEXP.test(source) ||
    NODE_STATIC_EXPORT_REGEXP.test(source)
  );
}

// F-3 policy: `@wats/http` joins `@wats/crypto` as an edge-portable
// package. `@wats/http/src/` MUST contain zero static `node:*` imports
// anywhere (it consumes crypto exclusively through the @wats/crypto
// seam). `@wats/crypto/src/` remains edge-portable with ONE opt-out
// path: `packages/crypto/src/adapters/node/`, which may reach node:*
// only via dynamic `await import(...)` inside a function body — never
// via a top-level static import.
const EDGE_PORTABLE_PACKAGES = ["@wats/crypto", "@wats/http"] as const;

function isUnderCryptoNodeAdapter(filePath: string, repoRoot: string): boolean {
  const rel = filePath.slice(repoRoot.length + 1);
  return rel.startsWith("packages/crypto/src/adapters/node/");
}

describe("F-0 workspace policy", () => {
  test("edge-portable package src trees contain no static node:* imports (F-2 tightened)", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const scanned: string[] = [];
    const violations: string[] = [];
    const adapterOptOutFiles: string[] = [];

    for (const packageName of EDGE_PORTABLE_PACKAGES) {
      const packageDir = join(
        repoRoot,
        "packages",
        packageName.replace(/^@wats\//, "")
      );
      const srcDir = join(packageDir, "src");
      const files = walkTypeScriptFiles(srcDir);

      for (const filePath of files) {
        scanned.push(filePath);
        const source = readFileSync(filePath, "utf8");
        const touchesNode = hasStaticNodeReference(source);
        if (touchesNode && isUnderCryptoNodeAdapter(filePath, repoRoot)) {
          // Even the opt-out path is not allowed to static-import
          // node:* at module scope. F-2's adapter uses a dynamic
          // `await import(specifier)` inside the factory function
          // body precisely to avoid this. Record that we saw the
          // file so the assertion below can pin that the opt-out
          // zone exists but contains no static imports.
          adapterOptOutFiles.push(filePath);
          violations.push(filePath);
          continue;
        }
        if (touchesNode) {
          violations.push(filePath);
        }
      }
    }

    expect(
      violations,
      `edge-portable src files must not statically import/export node:*; offenders:\n${violations.join("\n")}`
    ).toEqual([]);

    // F-2 meaningful PASS: after F-2 populates packages/crypto/src,
    // the scanner MUST have crossed at least one source file. This
    // converts the F-0 structural check into a behavioral one.
    expect(
      scanned.length,
      `workspace-policy scanner must see at least one source file under ${EDGE_PORTABLE_PACKAGES.join(", ")}; saw none`
    ).toBeGreaterThanOrEqual(1);

    // The scanner MUST have visited the node adapter file (the one
    // location the workspace allows `node:crypto` — and only via a
    // dynamic import).
    const expectedAdapterFile = join(
      repoRoot,
      "packages/crypto/src/adapters/node/index.ts"
    );
    expect(
      scanned.includes(expectedAdapterFile),
      `expected scanner to visit ${expectedAdapterFile}; scanned=${scanned.join(", ")}`
    ).toBe(true);

    // Sanity: the adversarial detector finds the marker line we
    // installed in the adapter, proving the regex works and the
    // adapter really did opt for the dynamic-import pattern.
    const adapterSource = readFileSync(expectedAdapterFile, "utf8");
    expect(
      /await\s+import\s*\(/.test(adapterSource),
      "node adapter must use `await import(...)` (dynamic) rather than a static import"
    ).toBe(true);
    expect(
      hasStaticNodeReference(adapterSource),
      `node adapter must not contain a top-level static node:* import; source=\n${adapterSource}`
    ).toBe(false);
  });

  test("@wats/internal-utils package manifest exists as published internal support", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const manifestPath = join(repoRoot, "packages/internal-utils/package.json");

    expect(existsSync(manifestPath)).toBe(true);

    const manifest = parseJsonFile(manifestPath);
    expect(manifest.name).toBe("@wats/internal-utils");
    expect(manifest.private).toBe(false);
    expect(manifest.type).toBe("module");
    expect(typeof manifest.version).toBe("string");
    expect((manifest.version as string).length).toBeGreaterThan(0);

    const exportsField = manifest.exports;
    expect(isJsonRecord(exportsField)).toBe(true);
    expect((exportsField as JsonRecord)["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
  });

  test("scripts/audit-tdd.ts exists and is a TypeScript file", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const scriptPath = join(repoRoot, "scripts/audit-tdd.ts");

    expect(existsSync(scriptPath)).toBe(true);

    const scriptStat = statSync(scriptPath);
    expect(scriptStat.isFile()).toBe(true);

    // Smoke check: file should begin with a shebang, comment, or import —
    // i.e., not be an empty placeholder.
    const source = readFileSync(scriptPath, "utf8");
    expect(source.trim().length).toBeGreaterThan(0);
  });
});
