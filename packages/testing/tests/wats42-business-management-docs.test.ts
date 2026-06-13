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
  test("@wats/graph exposes business-management subpath and fixture imports it", () => {
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
    expect(fixture).toContain('from "@wats/graph/endpoints/business-management"');
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
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    expect(scoped).toContain("getInfo({ fields? })");
    expect(scoped).toContain("listSubscribedApps()");
    expect(scoped).toContain("getSettings({ fields?, includeSipCredentials? })");
    expect(scoped).toContain("include_sip_credentials");
    expect(scoped).toContain("sensitive");
    // Voice pass reworded "credential-free MockTransport" → "Credential-free,
    // MockTransport-tested"; the fact (credential-free MockTransport coverage)
    // survives.
    expect(scoped).toContain("Credential-free, MockTransport-tested");

    const publicApi = read("site/content/docs/concepts/public-api-surface.mdx");
    // WATS-42A ticket ref removed from public docs by the voice pass; the
    // surviving guard is the documented business-management subpath + symbol.
    expect(publicApi).toContain("./endpoints/business-management");
    expect(publicApi).toContain("getCommerceSettings");

    // README was rewritten to a high-level overview and no longer enumerates
    // business-management symbols; the public-api-surface doc is now the
    // canonical home for the "read-only business/admin inventory" + getWabaInfo
    // claim (repointed from README.md). NOTE for parent: README no longer
    // mentions read-only business-management inventory specifically.
    expect(publicApi).toContain("read-only business/admin inventory");
    expect(publicApi).toContain("getWabaInfo");

    // guide.mdx was reduced to a stub during the docs migration; the
    // "Business/admin inventory (read-only)" + getBusinessProfile material now
    // lives in the scoped-clients reference (repointed from guide.mdx).
    expect(scoped).toContain("Business/admin inventory (read-only)");
    expect(scoped).toContain("getBusinessProfile");
  });

  test("parity matrix, roadmap, transition, and changelog remove stale current-facing contradictions", () => {
    const matrix = read("site/content/docs/parity.mdx");
    // WATS-42A ticket ref removed from public docs by the voice pass. The
    // business/admin read surfaces are now live-validated (no longer
    // "Credential-free MockTransport only"); the surviving guard is the
    // documented read API names in the matrix row.
    expect(matrix).toContain("Business/admin reads");
    expect(matrix).toContain("getWabaInfo");
    expect(matrix).toContain("listSubscribedApps");

    const roadmap = read("site/content/docs/meta/roadmap.mdx");
    // WATS-42A / "Complete" labels removed; the facts (read-only business/admin
    // inventory shipped, mutating admin endpoints deferred) survive.
    expect(roadmap).toContain("business/admin: read-only WABA and phone-number inventory");
    expect(roadmap).toContain("Mutating admin endpoints");

    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("read-only business-management inventory");
  });
});
