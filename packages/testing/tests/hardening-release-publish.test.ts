import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const workflow = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8");

describe("manual release publishing prerequisites", () => {
  test("pins a trusted-publishing capable Node runtime and npm CLI", () => {
    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("npm install --global npm@11.9.0");
  });

  test("publishes prereleases with an explicit dist-tag", () => {
    expect(workflow).toContain('--tag "$RELEASE_DIST_TAG"');
    expect(workflow).toContain("RELEASE_DIST_TAG: latest");
  });

  test("does not interpolate operator version input into executable shell text", () => {
    const lines = workflow.split("\n");
    const uses = lines.filter((line) => line.includes("${{ inputs.version }}"));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line.trim()).toMatch(/^(?:RELEASE_VERSION:|url:)/u);
    }
    expect(workflow).toContain('"$RELEASE_VERSION"');
  });

  test("CLI explicitly declares its durable-store runtime dependency", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "packages/cli/package.json"), "utf8"));
    expect(manifest.dependencies["@wats/persistence"]).toBe(manifest.dependencies["@wats/service"]);
  });
});
