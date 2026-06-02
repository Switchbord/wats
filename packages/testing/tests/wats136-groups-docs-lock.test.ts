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
    const filters = repoRead("docs/reference/filters.md");
    const facade = repoRead("docs/reference/whatsapp-facade.md");
    const parity = repoRead("docs/parity/pywa-parity-matrix.md");
    const changelog = repoRead("CHANGELOG.md");

    expect(filters).toContain("WATS-136");
    expect(filters).toContain("filtersTyped.group");
    expect(filters).toContain("group.fromGroup(groupId)");
    expect(facade).toContain("WATS-136");
    expect(facade).toContain("sendGroupMessage");
    expect(facade).toContain("listen({ groupId");
    expect(parity).toContain("WATS-136");
    expect(parity).toContain("filters");
    expect(parity).toContain("facade helpers");
    expect(changelog).toContain("WATS-136");
    expect(changelog).toContain("filtersTyped.group");
    expect(changelog).toContain("sendGroupMessage");
    expect(changelog).toContain("requestId");
  });

  test("facade docs pin camelCase response shape and group hard limits/non-goals", () => {
    const facade = repoRead("docs/reference/whatsapp-facade.md");

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
