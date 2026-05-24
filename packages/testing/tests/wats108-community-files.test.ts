import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

function isExpectedWorkspaceRootManifest(manifest: JsonRecord): boolean {
  return manifest.name === "wats" && manifest.private === true;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const candidateManifestPath = join(currentDir, "package.json");
    if (existsSync(candidateManifestPath)) {
      const candidateManifest = parseJsonFile(candidateManifestPath);
      if (isExpectedWorkspaceRootManifest(candidateManifest)) {
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

function readUtf8(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

// Minimal YAML parser sufficient for GitHub issue forms:
// - top-level scalar `key: value`
// - block sequences under a key:
//     body:
//       - type: ...
//         id: ...
//         attributes:
//           label: ...
//           options:
//             - "..."
// - scalar values: bare, "double", 'single', or `|` literal block
// - booleans (true/false), and arrays of scalar items
type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  raw: string;
  indent: number;
  content: string;
  lineNo: number;
}

function tokenize(source: string): Line[] {
  const out: Line[] = [];
  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    // Skip pure comment / empty lines
    const stripped = raw.replace(/\s+$/, "");
    const trimmed = stripped.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = stripped.length - trimmed.length;
    out.push({ raw: stripped, indent, content: trimmed, lineNo: i + 1 });
  }
  return out;
}

function parseScalar(raw: string): YamlValue {
  const v = raw.trim();
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  if (v.startsWith("\"") && v.endsWith("\"")) {
    return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, "\"");
  }
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

interface ParseState {
  lines: Line[];
  idx: number;
}

function peek(state: ParseState): Line | undefined {
  return state.lines[state.idx];
}

function parseBlock(state: ParseState, parentIndent: number): YamlValue {
  // Determine: is the next line a sequence item or a mapping?
  const first = peek(state);
  if (!first || first.indent <= parentIndent) {
    return null;
  }
  if (first.content.startsWith("- ")) {
    return parseSequence(state, first.indent);
  }
  return parseMapping(state, first.indent);
}

function parseMapping(state: ParseState, indent: number): YamlValue {
  const obj: { [key: string]: YamlValue } = {};
  while (true) {
    const cur = peek(state);
    if (!cur || cur.indent < indent) break;
    if (cur.indent > indent) {
      throw new Error(`Unexpected over-indent at line ${cur.lineNo}: ${cur.raw}`);
    }
    if (cur.content.startsWith("- ")) break;
    const colonIdx = findColon(cur.content);
    if (colonIdx < 0) {
      throw new Error(`Expected mapping at line ${cur.lineNo}: ${cur.raw}`);
    }
    const key = cur.content.slice(0, colonIdx).trim();
    const rest = cur.content.slice(colonIdx + 1).trim();
    state.idx++;
    if (rest === "") {
      // Nested value
      obj[key] = parseBlock(state, indent);
    } else if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      obj[key] = parseLiteralBlock(state, indent, rest);
    } else {
      obj[key] = parseScalar(rest);
    }
  }
  return obj;
}

function parseSequence(state: ParseState, indent: number): YamlValue {
  const arr: YamlValue[] = [];
  while (true) {
    const cur = peek(state);
    if (!cur || cur.indent < indent) break;
    if (cur.indent > indent) {
      throw new Error(`Unexpected over-indent at line ${cur.lineNo}: ${cur.raw}`);
    }
    if (!cur.content.startsWith("- ") && cur.content !== "-") break;
    const itemBody = cur.content === "-" ? "" : cur.content.slice(2);
    if (itemBody === "") {
      state.idx++;
      arr.push(parseBlock(state, indent));
      continue;
    }
    // Could be: `- value` scalar, or `- key: value` inline mapping start
    const colonIdx = findColon(itemBody);
    if (colonIdx < 0) {
      // scalar list item
      state.idx++;
      arr.push(parseScalar(itemBody));
      continue;
    }
    // mapping starting on the dash line: treat the dash-line's key/value
    // as the first entry of a mapping at indent + 2.
    const innerIndent = indent + 2;
    const key = itemBody.slice(0, colonIdx).trim();
    const rest = itemBody.slice(colonIdx + 1).trim();
    state.idx++;
    const obj: { [key: string]: YamlValue } = {};
    if (rest === "") {
      obj[key] = parseBlock(state, innerIndent);
    } else if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      obj[key] = parseLiteralBlock(state, innerIndent, rest);
    } else {
      obj[key] = parseScalar(rest);
    }
    // Continue mapping at innerIndent
    while (true) {
      const next = peek(state);
      if (!next || next.indent < innerIndent) break;
      if (next.content.startsWith("- ") && next.indent === innerIndent) break;
      if (next.indent !== innerIndent) {
        throw new Error(`Unexpected indent at line ${next.lineNo}: ${next.raw}`);
      }
      const ck = findColon(next.content);
      if (ck < 0) throw new Error(`Expected mapping continuation at line ${next.lineNo}`);
      const k = next.content.slice(0, ck).trim();
      const r = next.content.slice(ck + 1).trim();
      state.idx++;
      if (r === "") {
        obj[k] = parseBlock(state, innerIndent);
      } else if (r === "|" || r === ">" || r === "|-" || r === ">-") {
        obj[k] = parseLiteralBlock(state, innerIndent, r);
      } else {
        obj[k] = parseScalar(r);
      }
    }
    arr.push(obj);
  }
  return arr;
}

function findColon(s: string): number {
  // Avoid colons inside quoted strings.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\"" && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === ":" && !inSingle && !inDouble) {
      // colon must be followed by space or end-of-line
      if (i === s.length - 1 || s[i + 1] === " ") return i;
    }
  }
  return -1;
}

function parseLiteralBlock(state: ParseState, parentIndent: number, _marker: string): YamlValue {
  // Collect raw lines until indent drops back to parentIndent or below.
  // We re-read raw lines including blanks/comments inside the block. Since
  // tokenize() filters comments/blanks, fall back to scanning the original
  // source not available here — accept simplification: join non-blank lines.
  const parts: string[] = [];
  while (true) {
    const cur = peek(state);
    if (!cur) break;
    if (cur.indent <= parentIndent) break;
    parts.push(cur.raw.slice(parentIndent + 2));
    state.idx++;
  }
  return parts.join("\n");
}

function parseYaml(source: string): YamlValue {
  const lines = tokenize(source);
  const state: ParseState = { lines, idx: 0 };
  if (lines.length === 0) return null;
  if (lines[0].content.startsWith("- ")) {
    return parseSequence(state, lines[0].indent);
  }
  return parseMapping(state, lines[0].indent);
}

describe("WATS-108 community files docs-lock", () => {
  const repoRoot = findRepoRoot(import.meta.dir);

  test("CODE_OF_CONDUCT.md exists and is Contributor Covenant 2.1", () => {
    const cocPath = join(repoRoot, "CODE_OF_CONDUCT.md");
    expect(existsSync(cocPath)).toBe(true);
    const content = readUtf8(cocPath);
    expect(content).toContain("Contributor Covenant");
    expect(content).toContain("2.1");
  });

  test(".github/PULL_REQUEST_TEMPLATE.md exists and has required prompts", () => {
    const prPath = join(repoRoot, ".github/PULL_REQUEST_TEMPLATE.md");
    expect(existsSync(prPath)).toBe(true);
    const content = readUtf8(prPath);
    expect(content).toContain("Issue tracking");
    expect(content).toContain("Linear");
    expect(content).toContain("GitHub issue");
    expect(content).toContain("non-goals");
    expect(content).toContain("no live Meta calls");
    expect(content).toContain("no real credentials");
    expect(content).not.toContain("Pre-public-alpha behavior changes without a Linear issue");
  });

  test(".github/ISSUE_TEMPLATE/bug_report.yml is a valid GitHub issue form", () => {
    const formPath = join(repoRoot, ".github/ISSUE_TEMPLATE/bug_report.yml");
    expect(existsSync(formPath)).toBe(true);
    const content = readUtf8(formPath);
    const parsed = parseYaml(content);
    expect(isJsonRecord(parsed)).toBe(true);
    const obj = parsed as JsonRecord;
    expect(typeof obj.name).toBe("string");
    expect(typeof obj.description).toBe("string");
    expect(Array.isArray(obj.body)).toBe(true);
    expect((obj.body as unknown[]).length).toBeGreaterThan(0);
    expect(content).toContain("@wats/*");
    expect(content).toContain("@wats/core");
    expect(content).toContain("@wats/graph");
    expect(content).not.toContain("@switchbord/");
    expect(content).toContain("redacted tokens, app secrets, phone numbers, WABA IDs, and account identifiers");
  });

  test(".github/ISSUE_TEMPLATE/feature_request.yml is a valid GitHub issue form", () => {
    const formPath = join(repoRoot, ".github/ISSUE_TEMPLATE/feature_request.yml");
    expect(existsSync(formPath)).toBe(true);
    const content = readUtf8(formPath);
    const parsed = parseYaml(content);
    expect(isJsonRecord(parsed)).toBe(true);
    const obj = parsed as JsonRecord;
    expect(typeof obj.name).toBe("string");
    expect(typeof obj.description).toBe("string");
    expect(Array.isArray(obj.body)).toBe(true);
    expect((obj.body as unknown[]).length).toBeGreaterThan(0);
    expect(content).toContain("@wats/core");
    expect(content).toContain("@wats/graph");
    expect(content).not.toContain("@switchbord/");
    expect(content).toContain("Please do not include tokens, app secrets, phone numbers, WABA IDs, or account identifiers");
  });

  test(".github/ISSUE_TEMPLATE/config.yml disables blank issues", () => {
    const cfgPath = join(repoRoot, ".github/ISSUE_TEMPLATE/config.yml");
    expect(existsSync(cfgPath)).toBe(true);
    const parsed = parseYaml(readUtf8(cfgPath));
    expect(isJsonRecord(parsed)).toBe(true);
    const obj = parsed as JsonRecord;
    expect(obj.blank_issues_enabled).toBe(false);
  });
});
