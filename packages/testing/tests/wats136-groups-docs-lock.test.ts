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
    const docs = [
      repoRead("docs/reference/filters.md"),
      repoRead("docs/reference/whatsapp-facade.md"),
      repoRead("docs/parity/pywa-parity-matrix.md"),
      repoRead("CHANGELOG.md")
    ];

    for (const doc of docs) {
      expect(doc).toContain("WATS-136");
      expect(doc).toContain("filtersTyped.group");
      expect(doc).toContain("group.fromGroup(groupId)");
      expect(doc).toContain("sendGroupMessage");
      expect(doc).toContain("listen({ groupId");
    }
  });

  test("facade docs pin camelCase response shape and group hard limits/non-goals", () => {
    const facade = repoRead("docs/reference/whatsapp-facade.md");

    expect(facade).toContain("requestId");
    expect(facade).toContain("inviteLink");
    expect(facade).toContain("joinApprovalMode");
    expect(facade).toContain("only at the Graph wire boundary");
    expect(facade).toContain("description ≤2048");
    expect(facade).toContain("photo upload is not implemented");
    expect(facade).toContain("no direct participant-add helper");
    expect(facade).toContain("no promote/demote helper");
  });
});
