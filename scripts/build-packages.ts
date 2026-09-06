import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as ts from "typescript";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Rewrite extensionless relative ESM specifiers in an emitted dist file so
 * plain Node ESM (no custom loader, no bundler) can resolve them.
 *
 * `bun build --no-bundle` preserves source specifiers verbatim. Sources that
 * use extensionless relative imports (`from "./sqlite"`) work under Bun (which
 * transparently resolves `./sqlite` to `./sqlite.js`) but fail under Node ESM,
 * which requires explicit file extensions on relative specifiers. This
 * deterministic build-time pass rewrites each extensionless relative
 * specifier to the concrete emitted artifact by inspecting the dist tree:
 * `./foo` -> `./foo.js` when `foo.js` exists, or `./foo/index.js` when
 * `foo/index.js` exists.
 *
 * Safety: the TypeScript AST identifies ONLY real import/export specifier
 * literals — `ImportDeclaration.moduleSpecifier`, `ExportDeclaration.module
 * Specifier`, `ImportType` argument, and dynamic `import("...")` call
 * arguments. Arbitrary strings, template spans, and comments that merely
 * contain `from "./literal"`-looking text are never touched. Only relative
 * specifiers (`./` or `../`) without an existing extension are rewritten;
 * bare specifiers (`@wats/...`, `bun:sqlite`, `node:...`, `pg`) and
 * already-extended specifiers are preserved — keeping runtime deps, lazy
 * `bun:sqlite`/`pg` dynamic imports (deferred until the factory), shebangs,
 * and browser portability intact.
 */
const EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/u;

function isStringLiteral(node: ts.Node): node is ts.StringLiteral {
  return node.kind === ts.SyntaxKind.StringLiteral;
}

function resolveRelativeSpecifier(outFile: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (EXTENSION_PATTERN.test(specifier)) return null;
  const resolvedBase = resolve(dirname(outFile), specifier);
  const asFile = `${resolvedBase}.js`;
  const asIndex = join(resolvedBase, "index.js");
  if (existsSync(asFile)) return `${specifier}.js`;
  if (existsSync(asIndex)) return `${specifier}/index.js`;
  // No emitted artifact matches — leave the specifier untouched so a genuine
  // resolution error surfaces loudly instead of being silently masked.
  return null;
}

function collectSpecifierLiterals(source: ts.SourceFile): ts.StringLiteral[] {
  const literals: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    // import ... from "specifier";
    if (ts.isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      literals.push(node.moduleSpecifier);
    }
    // export ... from "specifier";
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && isStringLiteral(node.moduleSpecifier)) {
      literals.push(node.moduleSpecifier);
    }
    // import("specifier") — dynamic; bare specifiers (bun:sqlite/pg) skip via resolveRelativeSpecifier
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      isStringLiteral(node.arguments[0])
    ) {
      literals.push(node.arguments[0]);
    }
    // import("./specifier").Foo type — argument is a LiteralTypeNode wrapping a StringLiteral
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && isStringLiteral(node.argument.literal)) {
      literals.push(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals;
}

function normalizeEsmSpecifiers(outFile: string): void {
  const text = readFileSync(outFile, "utf8");
  const isDts = outFile.endsWith(".d.ts");
  const source = ts.createSourceFile(outFile, text, ts.ScriptTarget.Latest, true, isDts ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const literals = collectSpecifierLiterals(source);
  const edits: { readonly start: number; readonly end: number; readonly replacement: string }[] = [];
  for (const literal of literals) {
    const specifier = literal.text;
    const resolved = resolveRelativeSpecifier(outFile, specifier);
    if (resolved === null) continue;
    // Use getStart (not pos) to land on the opening quote — pos includes leading
    // trivia. end lands just past the closing quote, so the slice spans the
    // full quoted literal including both quotes.
    edits.push({ start: literal.getStart(source), end: literal.end, replacement: JSON.stringify(resolved) });
  }
  if (edits.length === 0) return;
  // Apply edits right-to-left so offsets remain valid.
  edits.sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  writeFileSync(outFile, result);
}

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

type PackageName = (typeof PUBLISHABLE_PACKAGES)[number];

function collectTypeScriptSources(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptSources(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

const packageEntrypoints: Record<PackageName, readonly string[]> = {
  types: ["index", "config", "webhook", "entities", "messages/index", "statuses", "contacts", "errors"],
  crypto: ["index", "provider", "errors", "adapters/node/index", "adapters/webcrypto/index"],
  graph: [
    "index",
    "client",
    "errors",
    "endpoints/messages",
    "endpoints/media",
    "endpoints/templates",
    "endpoints/flows",
    "endpoints/calling",
    "endpoints/businessManagement",
    "endpoints/groups",
    "transport",
    "createMockTransport"
  ],
  core: [
    "index",
    "updateParser",
    "router",
    "filters/index",
    "filtersTyped/index",
    "webhookNormalizer",
    "typedRouter",
    "whatsappFacade",
    "listener"
  ],
  http: [
    "index",
    "webhookServer",
    "signature",
    "adapters/webhookAdapter",
    "adapters/fetchAdapter",
    "adapters/bunAdapter",
    "adapters/nodeAdapter"
  ],
  "internal-utils": ["index", "isRecord"],
  config: ["index"],
  persistence: ["index", "sqlite", "postgres"],
  service: ["index"],
  cli: ["index", "bin"]
};

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(repoRoot, ".bun-cache") }
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function collectDistJsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDistJsFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts"))) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function buildPackage(pkg: PackageName): void {
  const packageDir = join(repoRoot, "packages", pkg);
  const distDir = join(packageDir, "dist");
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  // Build every source file without bundling so package-internal relative imports remain transparent.
  for (const source of collectTypeScriptSources(join(packageDir, "src"))) {
    const relativeSource = relative(join(packageDir, "src"), source).replace(/\.ts$/u, "");
    const outFile = join(distDir, `${relativeSource}.js`);
    mkdirSync(dirname(outFile), { recursive: true });
    run("bun", ["build", source, "--target", "bun", "--format", "esm", "--no-bundle", "--outfile", outFile], repoRoot);
    const sourceText = readFileSync(source, "utf8");
    if (sourceText.startsWith("#!")) {
      const shebang = sourceText.slice(0, sourceText.indexOf("\n"));
      const builtText = readFileSync(outFile, "utf8");
      if (!builtText.startsWith("#!")) {
        writeFileSync(outFile, `${shebang}\n${builtText}`);
      }
    }
  }

  // Normalize extensionless relative specifiers in emitted .js files. This
  // runs AFTER all dist .js files exist so resolution targets are reliable
  // (e.g. index.js importing ./sqlite resolves to sqlite.js which was built
  // in the same loop). See normalizeEsmSpecifiers for details.
  for (const outFile of collectDistJsFiles(distDir)) {
    if (outFile.endsWith(".js")) normalizeEsmSpecifiers(outFile);
  }

  const tempDir = mkdtempSync(join(repoRoot, ".tmp-wats83-tsconfig-"));
  const tempConfigPath = join(tempDir, `${pkg}.json`);
  const srcDir = join(packageDir, "src");
  const tempConfig = {
    compilerOptions: {
      declaration: true,
      emitDeclarationOnly: true,
      module: "ESNext",
      target: "ES2022",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      ignoreDeprecations: "6.0",
      baseUrl: repoRoot,
      paths: {
        "@wats/*": ["./packages/*/src/index.ts"],
        "@wats/graph/*": ["./packages/graph/src/*"],
        "@wats/core/*": ["./packages/core/src/*"],
        "@wats/http/*": ["./packages/http/src/*"],
        "@wats/crypto/*": ["./packages/crypto/src/*"],
        "@wats/types/*": ["./packages/types/src/*"],
        "@wats/config/*": ["./packages/config/src/*"],
        "@wats/persistence/*": ["./packages/persistence/src/*"],
        "@wats/service/*": ["./packages/service/src/*"],
        "@wats/cli/*": ["./packages/cli/src/*"]
      },
      rootDir: repoRoot,
      outDir: join(distDir, "__types")
    },
    include: [join(srcDir, "**/*.ts")],
    exclude: [join(srcDir, "**/*.d.ts")]
  };
  try {
    writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));
    run("bunx", ["tsc", "-p", tempConfigPath], repoRoot);
    const declarationRoot = join(distDir, "__types", "packages", pkg, "src");
    if (existsSync(declarationRoot)) {
      cpSync(declarationRoot, distDir, { recursive: true });
    }
    rmSync(join(distDir, "__types"), { recursive: true, force: true });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  // Normalize extensionless relative specifiers in emitted .d.ts declaration
  // files too, so type-only consumers importing via external specifiers under
  // NodeNext module resolution resolve the .d.ts graph. Runs after the
  // declaration copy so all .d.ts targets exist.
  for (const outFile of collectDistJsFiles(distDir)) {
    if (outFile.endsWith(".d.ts")) normalizeEsmSpecifiers(outFile);
  }
}

for (const pkg of PUBLISHABLE_PACKAGES) {
  buildPackage(pkg);
}

console.log(`built publishable package artifacts for ${PUBLISHABLE_PACKAGES.length} packages`);
