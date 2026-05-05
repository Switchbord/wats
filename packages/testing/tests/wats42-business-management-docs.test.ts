// WATS-42A RED — docs/package-surface lockstep for read-only business/admin parity.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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


const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS-42A package exports and consumer fixture", () => {
  test("@switchbord/graph exposes business-management subpath and fixture imports it", () => {
    const packageJson = JSON.parse(read("packages/graph/package.json")) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };
    expect(packageJson.exports?.["./endpoints/business-management"]).toEqual({
      types: "./dist/endpoints/businessManagement.d.ts",
      import: "./dist/endpoints/businessManagement.js"
    });

    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");
    for (const symbol of [
      "getWabaInfo",
      "listSubscribedApps",
      "getPhoneNumberInfo",
      "getPhoneNumberSettings",
      "getBusinessProfile",
      "getCommerceSettings",
      "type WabaInfo",
      "type PhoneNumberSettingsResponse"
    ]) {
      expect(fixture).toContain(symbol);
    }
    expect(fixture).toContain('from "@switchbord/graph/endpoints/business-management"');
    expect(fixture).toContain("WABAClient");
    expect(fixture).toContain("PhoneNumberClient");
    expect(fixture).toContain("wats42-business-management round trips");
  });

  test("graph-consumer fixture covers WATS-42A public symbols", () => {
    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");
    expect(fixture).toContain("wats42-business-management root exports are functions");
    expect(fixture).toContain("wats42-business-management subpath exports are functions");
    expect(fixture).toContain("wats42-business-management round trips through scoped clients");
  });
});

describe("WATS-42A docs lockstep", () => {
  test("reference docs describe read-only admin inventory surfaces and sensitivity", () => {
    const scoped = read("docs/reference/scoped-clients.md");
    expect(scoped).toContain("getInfo({ fields? })");
    expect(scoped).toContain("listSubscribedApps()");
    expect(scoped).toContain("getSettings({ fields?, includeSipCredentials? })");
    expect(scoped).toContain("include_sip_credentials");
    expect(scoped).toContain("sensitive");
    expect(scoped).toContain("credential-free MockTransport");

    const publicApi = read("docs/architecture/public-api-surface.md");
    expect(publicApi).toContain("WATS-42A");
    expect(publicApi).toContain("./endpoints/business-management");
    expect(publicApi).toContain("getCommerceSettings");

    const readme = read("README.md");
    expect(readme).toContain("read-only business-management inventory");
    expect(readme).toContain("getWabaInfo");

    const gettingStarted = read("docs/getting-started.md");
    expect(gettingStarted).toContain("Business/admin inventory (read-only)");
    expect(gettingStarted).toContain("getBusinessProfile");
  });

  test("parity matrix, roadmap, handoff, and changelog remove stale current-facing contradictions", () => {
    const matrix = read("docs/parity/pywa-parity-matrix.md");
    expect(matrix).toContain("WATS-42A");
    expect(matrix).toContain("getWabaInfo");
    expect(matrix).toContain("getPhoneNumberSettings");
    expect(matrix).toContain("Credential-free MockTransport only");

    const roadmap = read("docs/architecture/roadmap-to-whatsapp-pywa-parity.md");
    expect(roadmap).toContain("WATS-42A");
    expect(roadmap).toContain("Complete");
    expect(roadmap).toContain("Mutating admin endpoints remain credential-gated/deferred");

    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("read-only business-management inventory");
  });
});
