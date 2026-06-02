import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS-87 persistence outbox docs", () => {
  test("reference docs describe the outbox worker contract without raw payload storage or exactly-once claims", () => {
    const persistence = read("docs/reference/persistence.md");
    const service = read("docs/reference/service.md");
    const publicApi = read("docs/architecture/public-api-surface.md");
    const changelog = read("CHANGELOG.md");

    for (const term of [
      "enqueueOutboxItem",
      "claimOutboxItems",
      "markOutboxItemFailed",
      "markOutboxItemSucceeded",
      "runOutboxWorkerOnce",
      "at-least-once",
      "payloadHash"
    ]) {
      expect(persistence).toContain(term);
      expect(changelog).toContain(term);
    }

    expect(persistence).toContain("stores only payload hashes");
    expect(persistence).toContain("does not store raw webhook bodies");
    expect(persistence).toContain("does not store message text");
    expect(persistence).toContain("leaseId");
    expect(persistence).toContain("stale workers cannot mark a newer reclaimed lease as succeeded or failed");
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
      "outbox-capable `PersistenceStore`"
    ]) {
      expect(service).toContain(term);
    }

    const rawClaimWindow = persistence.slice(persistence.indexOf("## Outbox"));
    expect(rawClaimWindow).not.toContain("exactly-once");
    expect(rawClaimWindow).not.toContain("stores raw");
  });
});
