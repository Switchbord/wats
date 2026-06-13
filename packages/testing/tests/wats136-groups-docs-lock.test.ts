// WATS-136 RED — public docs lock for Groups filters/facade ergonomics.
//
// Keeps the Groups facade/filter docs in lockstep with the public surface and
// the current explicit Groups non-goals/limits from Meta's v25 API.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function repoRead(path: string): string {
  return readFileSync(join(import.meta.dir, "../../..", path), "utf8");
}

describe("WATS-136 Groups docs lock", () => {
  test("filters, facade, parity, and changelog document the group ergonomics", () => {
    const filters = repoRead("site/content/docs/reference/filters.mdx");
    const facade = repoRead("site/content/docs/reference/whatsapp-facade.mdx");
    const parity = repoRead("site/content/docs/parity.mdx");
    const changelog = repoRead("CHANGELOG.md");

    // WATS-136 ticket refs dropped from site MDX (filters/facade/parity): voice pass
    // stripped them and check-banned-phrases forbids re-adding. The co-located
    // filtersTyped.group / sendGroupMessage / facade-helpers assertions are the guard.
    // Changelog keeps WATS-136 (not voice-governed).
    expect(filters).toContain("filtersTyped.group");
    expect(filters).toContain("group.fromGroup(groupId)");
    expect(facade).toContain("sendGroupMessage");
    expect(facade).toContain("listen({ groupId");
    expect(parity).toContain("filters");
    expect(parity).toContain("facade helpers");
    expect(changelog).toContain("WATS-136");
    expect(changelog).toContain("filtersTyped.group");
    expect(changelog).toContain("sendGroupMessage");
    expect(changelog).toContain("requestId");
  });

  test("facade docs pin camelCase response shape and group hard limits/non-goals", () => {
    const facade = repoRead("site/content/docs/reference/whatsapp-facade.mdx");

    expect(facade).toContain("requestId");
    expect(facade).toContain("inviteLink");
    expect(facade).toContain("joinApprovalMode");
    expect(facade).toContain("only at the Graph wire boundary");
    expect(facade).toContain("description ≤2048");
    expect(facade).toContain("Photo upload is not implemented");
    expect(facade).toContain("no direct participant-add helper");
    expect(facade).toContain("no promote/demote helper");
  });
});
