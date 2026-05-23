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
    const packageMap = read("docs/architecture/package-map.md");
    const publicSurface = read("docs/architecture/public-api-surface.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [packageMap, publicSurface, changelog]) {
      expect(doc).toContain("WATS-68");
      expect(doc).toContain("messages endpoint module split");
      expect(doc).toContain("no payload behavior changes");
    }
  });
});
