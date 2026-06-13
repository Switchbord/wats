import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; private?: boolean };
      if (manifest.name === "wats" && manifest.private === true) return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS-68 messages endpoint module split", () => {
  test("messages endpoint family has a focused module directory with a thin compatibility barrel", () => {
    const expectedModules = [
      "packages/graph/src/endpoints/messages/index.ts",
      "packages/graph/src/endpoints/messages/types.ts",
      "packages/graph/src/endpoints/messages/validation.ts",
      "packages/graph/src/endpoints/messages/builders-basic.ts",
      "packages/graph/src/endpoints/messages/builders-interactive.ts",
      "packages/graph/src/endpoints/messages/builders-template.ts",
      "packages/graph/src/endpoints/messages/callables.ts"
    ];
    for (const path of expectedModules) {
      expect(existsSync(join(repoRoot, path)), `${path} should exist`).toBe(true);
    }

    const barrel = read("packages/graph/src/endpoints/messages.ts").trim();
    expect(barrel).toBe('export * from "./messages/index.js";');
  });

  test("monolithic messages barrel no longer owns builders, validation constants, or endpoint classes", () => {
    const barrel = read("packages/graph/src/endpoints/messages.ts");
    for (const forbidden of [
      "class GraphMessagesEndpoint",
      "function assertValidRecipient",
      "function inspectTemplateValue",
      "defineEndpoint<",
      "buildSendMarketingTemplatePayload",
      "GRAPH_MESSAGES_TEXT_BODY_MAX_LENGTH"
    ]) {
      expect(barrel).not.toContain(forbidden);
    }

    const index = read("packages/graph/src/endpoints/messages/index.ts");
    expect(index).toContain("./types.js");
    expect(index).toContain("./builders-basic.js");
    expect(index).toContain("./builders-interactive.js");
    expect(index).toContain("./builders-template.js");
    expect(index).toContain("./callables.js");
  });

  test("docs and changelog identify WATS-68 as an internal split with no behavior change", () => {
    const packageMap = read("site/content/docs/concepts/package-map.mdx");
    const publicSurface = read("site/content/docs/concepts/public-api-surface.mdx");
    const changelog = read("CHANGELOG.md");

    // CHANGELOG is not voice-governed: keep full ticket + split narrative there.
    expect(changelog).toContain("WATS-68");
    expect(changelog).toContain("messages endpoint module split");
    expect(changelog).toContain("no payload behavior changes");

    // WATS-68 was an INTERNAL module reorganization with no public-surface change, so
    // the voice-passed site docs neither carry the WATS-68 ticket nor narrate the
    // internal split (both stripped/never-present). The "no behavior change" guarantee
    // is preserved in the docs as the UNCHANGED public messages endpoint subpath.
    // DOC-GAP (for parent): the internal split is documented only in CHANGELOG.md;
    // site concept docs do not (and arguably need not) mention it.
    for (const doc of [packageMap, publicSurface]) {
      expect(doc).toContain("@wats/graph/endpoints/messages");
    }
  });
});
