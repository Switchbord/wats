// WATS-183 — banned-phrase markdown gate policy test.
//
// Asserts the markdown archaeology gate (site/scripts/check-banned-phrases-markdown.ts)
// flags planted leaks and passes on the clean tree.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanMarkdownContent } from "../../../site/scripts/check-banned-phrases-markdown.ts";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

describe("WATS-183: banned-phrase markdown gate", () => {
  test("flags a planted ticket-ID leak", () => {
    const findings = scanMarkdownContent(
      "See WATS-999 for the background on this feature.",
      "fake/leak.md",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.match === "WATS-999")).toBe(true);
  });

  test("flags a planted T-nn phase label", () => {
    const findings = scanMarkdownContent(
      "This was done in T18 and rolled out in T19.",
      "fake/phase.md",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.match === "T18")).toBe(true);
  });

  test("flags a planted F-n phase label", () => {
    const findings = scanMarkdownContent(
      "The F-4 contract covers MockTransport testability.",
      "fake/phase.md",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.match === "F-4")).toBe(true);
  });

  test("flags 'adversarial remediation' jargon", () => {
    const findings = scanMarkdownContent(
      "This section went through adversarial remediation before merge.",
      "fake/jargon.md",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.match.includes("adversarial"))).toBe(true);
  });

  test("does not flag clean prose", () => {
    const findings = scanMarkdownContent(
      "Every Graph failure maps to a typed error class. Catch by instanceof, not by parsing prose.",
      "fake/clean.md",
    );
    expect(findings).toEqual([]);
  });

  test("strips code blocks so code examples don't false-positive", () => {
    const content = [
      "Some intro text here.",
      "",
      "```ts",
      "// WATS-999 is an example ticket id inside a code block",
      "const x = 'T18';",
      "```",
      "",
      "More clean prose.",
    ].join("\n");
    const findings = scanMarkdownContent(content, "fake/codeblock.md");
    expect(findings).toEqual([]);
  });

  test("passes on the clean tree (full script exit 0)", async () => {
    const proc = Bun.spawn(
      ["bun", "site/scripts/check-banned-phrases-markdown.ts"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});
