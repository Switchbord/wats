import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS-95 docs and package surface lockstep", () => {
  test("Graph package root, subpath, and consumer fixture expose WATS-95 symbols", () => {
    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");
    for (const symbol of [
      "listBlockedUsers",
      "blockUsers",
      "unblockUsers",
      "getOfficialBusinessAccountStatus",
      "requestOfficialBusinessAccountReview",
      "submitDisplayNameForReview",
      "type BlockedUsersResponse",
      "type OfficialBusinessAccountStatusResponse"
    ]) {
      expect(fixture).toContain(symbol);
    }
    expect(fixture).toContain('from "@wats/graph/endpoints/business-management"');
    expect(fixture).toContain("wats95-business-management root exports are functions");
    expect(fixture).toContain("wats95-business-management round trips through scoped clients");

    const businessManagementSource = read("packages/graph/src/endpoints/businessManagement.ts");
    for (const wireTerm of [
      "/{phoneNumberId}/block_users",
      "/{phoneNumberId}/official_business_account",
      "block_users",
      "new_display_name",
      "business_website_url",
      "primary_country_of_operation"
    ]) {
      expect(businessManagementSource).toContain(wireTerm);
    }
  });

  test("public docs describe Block API, OBA/display-name review, webhook deltas, and non-goals", () => {
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    for (const term of [
      "listBlockedUsers",
      "blockUsers",
      "unblockUsers",
      "block_users",
      "getOfficialBusinessAccountStatus",
      "requestOfficialBusinessAccountReview",
      "submitDisplayNameForReview",
      "official_business_account",
      "new_display_name",
      "no automatic user-block decisions",
      "no live Meta calls"
    ]) {
      expect(scoped).toContain(term);
    }

    const webhookNormalizer = read("site/content/docs/reference/webhook-normalizer.mdx");
    for (const term of [
      "phone_number_quality_update",
      "THROUGHPUT_UPGRADE",
      "TIER_UNLIMITED",
      "account_alerts",
      "PROFILE_PICTURE_LOST",
      "phoneNumberQuality",
      "alert"
    ]) {
      expect(webhookNormalizer).toContain(term);
    }

    const parity = read("site/content/docs/parity.mdx");
    expect(parity).toContain("Block API");

    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    expect(migration).toContain("blockUsers");
    expect(migration).toContain("submitDisplayNameForReview");

    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("WATS-95");
    expect(changelog).toContain("THROUGHPUT_UPGRADE");
  });
});
