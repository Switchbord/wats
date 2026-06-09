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
    const scoped = read("docs/reference/scoped-clients.md");
    const endpoints = read("docs/reference/endpoints.md");
    const surface = read("docs/architecture/public-api-surface.md");
    const packageMap = read("docs/architecture/package-map.md");

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
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const migration = read("docs/migration/pywa-to-wats.md");
    const changelog = read("CHANGELOG.md");
    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");

    for (const doc of [parity, migration, changelog, fixture]) {
      expect(doc).toContain("WATS-74");
      expect(doc).toContain("updateBusinessProfile");
      expect(doc).toContain("updateCommerceSettings");
    }

    expect(migration).toContain("profile/commerce updates");
    expect(parity).toContain("profile/commerce mutation first tranche");
  });
});
