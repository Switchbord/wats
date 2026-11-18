import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseDistTag } from "../../../scripts/release-dist-tag.js";

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
    expect(workflow).toContain('bun run scripts/release-dist-tag.ts >> "$GITHUB_ENV"');
    expect(workflow).not.toContain("RELEASE_DIST_TAG: latest");
    expect(releaseDistTag("0.5.0-beta")).toBe("beta");
    expect(releaseDistTag("0.5.0-beta.0")).toBe("beta");
    expect(releaseDistTag("0.5.0-alpha.1")).toBe("alpha");
    expect(releaseDistTag("0.5.0-rc.1")).toBe("rc");
    expect(releaseDistTag("0.5.0")).toBe("latest");
    expect(() => releaseDistTag("0.5.0-beta\nRELEASE_DIST_TAG=latest")).toThrow();
    expect(() => releaseDistTag("0.5.0-unknown")).toThrow();
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
