import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoRoot(): string {
  return join(import.meta.dir, "..", "..", "..");
}

function read(path: string): string {
  return readFileSync(join(repoRoot(), path), "utf8");
}

describe("WATS-74 business mutation docs lockstep", () => {
  test("reference and architecture docs name the profile/commerce mutation tranche", () => {
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    const endpoints = read("site/content/docs/reference/endpoints.mdx");
    const surface = read("site/content/docs/concepts/public-api-surface.mdx");
    const packageMap = read("site/content/docs/concepts/package-map.mdx");

    for (const doc of [scoped, endpoints, surface, packageMap]) {
      expect(doc).toContain("updateBusinessProfile");
      expect(doc).toContain("updateCommerceSettings");
      expect(doc).toContain("@wats/graph/endpoints/business-management");
    }

    expect(scoped).toContain("profile_picture_handle");
    expect(scoped).toContain("is_cart_enabled");
    expect(scoped).toContain("is_catalog_visible");
  });

  test("parity, migration, changelog, and consumer fixture expose WATS-74", () => {
    const parity = read("site/content/docs/parity.mdx");
    const migration = read("site/content/docs/migration/pywa.mdx");
    const changelog = read("CHANGELOG.md");
    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");

    for (const doc of [parity, migration, changelog, fixture]) {
      expect(doc).toContain("updateBusinessProfile");
      expect(doc).toContain("updateCommerceSettings");
    }

    // Ticket traceability stays in the changelog + consumer fixture (not voice-governed).
    expect(changelog).toContain("WATS-74");
    expect(fixture).toContain("WATS-74");

    expect(migration).toContain("profile/commerce updates");
    expect(parity).toContain("Business/admin mutations");
  });
});
