import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as ts from "typescript";

/**
 * Rewrite extensionless relative ESM specifiers in an emitted dist file so
 * plain Node ESM (no custom loader, no bundler) can resolve them.
 *
 * `bun build --no-bundle` preserves source specifiers verbatim. Sources using
 * extensionless relative imports (`from "./sqlite"`) resolve under Bun but
 * fail under Node ESM, which requires explicit file extensions. This pass
 * rewrites each extensionless relative specifier to the concrete emitted
 * artifact by inspecting the dist tree: `./foo` -> `./foo.js` when `foo.js`
 * exists, or `./foo/index.js` when `foo/index.js` exists.
 *
 * Safety: the TypeScript AST identifies ONLY real import/export specifier
 * literals — `ImportDeclaration.moduleSpecifier`, `ExportDeclaration.module
 * Specifier`, `ImportType` argument, and dynamic `import("...")` call
 * arguments. Arbitrary strings, template spans, and comments that merely
 * contain `from "./literal"`-looking text are never touched. Only relative
 * specifiers (`./` or `../`) without an existing extension are rewritten;
 * bare specifiers and already-extended specifiers are preserved. Specifiers
 * with no matching emitted artifact are left untouched so a genuine resolution
 * error surfaces loudly instead of being silently masked.
 */
const EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/u;

function isStringLiteral(node: ts.Node): node is ts.StringLiteral {
  return node.kind === ts.SyntaxKind.StringLiteral;
}

export function resolveRelativeSpecifier(outFile: string, specifier: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (EXTENSION_PATTERN.test(specifier)) return null;
  const resolvedBase = resolve(dirname(outFile), specifier);
  const asFile = `${resolvedBase}.js`;
  const asIndex = join(resolvedBase, "index.js");
  if (existsSync(asFile)) return `${specifier}.js`;
  if (existsSync(asIndex)) return `${specifier}/index.js`;
  return null;
}

function collectSpecifierLiterals(source: ts.SourceFile): ts.StringLiteral[] {
  const literals: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      literals.push(node.moduleSpecifier);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && isStringLiteral(node.moduleSpecifier)) {
      literals.push(node.moduleSpecifier);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      isStringLiteral(node.arguments[0])
    ) {
      literals.push(node.arguments[0]);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && isStringLiteral(node.argument.literal)) {
      literals.push(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals;
}

/**
 * In-place: rewrite extensionless relative ESM specifiers in `outFile`.
 * Returns the number of specifiers rewritten (0 = no change). Idempotent: a
 * second pass finds only already-extended specifiers and rewrites nothing.
 */
export function normalizeEsmSpecifiers(outFile: string): number {
  const text = readFileSync(outFile, "utf8");
  const isDts = outFile.endsWith(".d.ts");
  const source = ts.createSourceFile(outFile, text, ts.ScriptTarget.Latest, true, isDts ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const literals = collectSpecifierLiterals(source);
  const edits: { readonly start: number; readonly end: number; readonly replacement: string }[] = [];
  for (const literal of literals) {
    const specifier = literal.text;
    const resolved = resolveRelativeSpecifier(outFile, specifier);
    if (resolved === null) continue;
    edits.push({ start: literal.getStart(source), end: literal.end, replacement: JSON.stringify(resolved) });
  }
  if (edits.length === 0) return 0;
  edits.sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  writeFileSync(outFile, result);
  return edits.length;
}
