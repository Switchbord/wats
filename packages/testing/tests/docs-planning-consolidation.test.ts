import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

interface PublicDocsManifest {
  pages: string[];
  exclude: string[];
}

const STALE_ISSUE_LEVEL_PUBLIC_PAGES = [
  "architecture/alpha-cli-runtime-operations-plan.md",
  "architecture/wats47-cli-operator-ux-design.md",
  "architecture/wats48-persistence-contract-design.md",
  "architecture/wats49-docker-deployment-design.md",
  "architecture/wats50-release-hygiene-policy.md",
  "architecture/wats57-graph-endpoint-module-split-plan.md",
  "architecture/wats58-graph-validation-utility-reuse-plan.md",
  "architecture/wats82-first-release-readiness.md",
  "architecture/cli-service-openapi-options.md",
  "guides/getting-started.md"
] as const;

const LOCAL_TEMP_SOURCE_CITATIONS = [
  /\/tmp\/wats-research\b/u,
  /\/root\/wats-research\b/u,
  /wats-research\/pywa/u
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
const docsRoot = join(repoRoot, "docs");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function manifest(): PublicDocsManifest {
  return JSON.parse(read("docs/public-docs-manifest.json")) as PublicDocsManifest;
}

function markdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const st = statSync(current);
    if (st.isDirectory()) {
      const rel = relative(root, current).replace(/\\/gu, "/");
      if (rel === ".vitepress/dist" || rel === "public") continue;
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
      continue;
    }
    if (st.isFile() && current.endsWith(".md")) {
      out.push(relative(root, current).replace(/\\/gu, "/"));
    }
  }
  return out.sort();
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replace(/\*\*/gu, ".*").replace(/\*/gu, "[^/]*")}$`, "u");
}

describe("docs planning surface consolidation", () => {
  test("public docs manifest inventories every markdown doc as public or explicitly excluded", () => {
    const publicManifest = manifest();
    const pages = new Set(publicManifest.pages);
    const excludePatterns = (publicManifest.exclude ?? []).map(globToRegExp);

    const missing = markdownFiles(docsRoot).filter(
      (page) => !pages.has(page) && !excludePatterns.some((pattern) => pattern.test(page))
    );

    expect(missing).toEqual([]);
  });

  test("issue-level planning and stale duplicate pages are not public docs pages", () => {
    const pages = manifest().pages;
    for (const stalePage of STALE_ISSUE_LEVEL_PUBLIC_PAGES) {
      expect(pages, `${stalePage} must be deleted, consolidated, or manifest-excluded`).not.toContain(stalePage);
    }
  });

  test("public docs do not cite local temp research paths", () => {
    const publicManifest = manifest();
    const offenders = publicManifest.pages.flatMap((page) => {
      const source = read(`docs/${page}`);
      return LOCAL_TEMP_SOURCE_CITATIONS.filter((pattern) => pattern.test(source)).map((pattern) => `${page}: ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });

  test("README roadmap is concise and delegates issue-level tracking to roadmap docs and Linear", () => {
    const readme = read("README.md");
    expect(readme).toContain("docs/architecture/roadmap-to-whatsapp-pywa-parity.md");
    expect(readme).toContain("Linear");
    expect(readme).not.toContain("10. deeper typed webhook normalization and pywa migration coverage");
  });
});
