import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS-87 persistence outbox docs", () => {
  test("reference docs describe the outbox worker contract without raw payload storage or exactly-once claims", () => {
    const persistence = read("site/content/docs/reference/persistence.mdx");
    const service = read("site/content/docs/reference/service.mdx");
    const publicApi = read("site/content/docs/concepts/public-api-surface.mdx");
    const changelog = read("CHANGELOG.md");

    for (const term of [
      "enqueueOutboxItem",
      "claimOutboxItems",
      "markOutboxItemFailed",
      "markOutboxItemSucceeded",
      "runOutboxWorkerOnce",
      "payloadHash"
    ]) {
      expect(persistence).toContain(term);
      expect(changelog).toContain(term);
    }
    // Voice pass title-cased the outbox intro ("At-least-once …"); changelog keeps lowercase.
    expect(persistence.toLowerCase()).toContain("at-least-once");
    expect(changelog).toContain("at-least-once");

    expect(persistence).toContain("stores only payload hashes");
    // Reworded: "does not store raw webhook bodies"/"does not store message text" became
    // "no raw webhook bodies, message text, … or contacts". Fact (no raw bodies/text) survives.
    expect(persistence).toMatch(/no raw webhook bodies, message text/iu);
    expect(persistence).toContain("leaseId");
    expect(persistence).toContain("002_outbox_lease_id");
    expect(persistence).toContain("originally shipped checksum");
    expect(changelog).toContain("002_outbox_lease_id");
    expect(changelog).toContain("preserving the original `001_initial` checksum");
    // Reworded in persistence.mdx to "stale worker cannot complete a newer reclaimed lease";
    // changelog retains the original sentence. Both assert the lease-fencing guarantee.
    expect(persistence).toContain("stale worker cannot complete a newer reclaimed lease");
    expect(changelog).toContain("Stale workers cannot mark a newer reclaimed lease as succeeded or failed");
    expect(persistence).toContain("migration_lock_failed");
    expect(publicApi).toContain("outbox record APIs");
    expect(publicApi).toContain("runOutboxWorkerOnce");

    for (const term of [
      "persistence?: PersistenceStore",
      "invalid_persistence",
      "enqueueOutboxItem",
      "claimOutboxItems",
      "leaseId",
      "markOutboxItemFailed",
      "markOutboxItemSucceeded",
      // Reworded from "outbox-capable `PersistenceStore`" to "outbox-capable shape".
      "outbox-capable"
    ]) {
      expect(service).toContain(term);
    }

    const rawClaimWindow = persistence.slice(persistence.indexOf("## Outbox"));
    expect(rawClaimWindow).not.toContain("exactly-once");
    expect(rawClaimWindow).not.toContain("stores raw");
  });
});
