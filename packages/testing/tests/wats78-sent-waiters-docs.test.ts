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

describe("WATS-78 sent-result waiter docs lockstep", () => {
  test("facade and listener docs describe waitable sent results and boundaries", () => {
    const facade = read("docs/reference/whatsapp-facade.md");
    const listeners = read("docs/reference/listeners.md");

    for (const term of [
      "WATS-78",
      "WhatsAppWaitableSentResult",
      "waitForReply",
      "waitUntilDelivered",
      "waitUntilRead",
      "waitUntilFailed",
      "observed webhook",
      "No delivered/read inference"
    ]) {
      expect(facade).toContain(term);
    }

    expect(listeners).toContain("WATS-78");
    expect(listeners).toContain("sent-result waiters");
    expect(listeners).toContain("timeoutMs");
    expect(listeners).toContain("AbortSignal");
  });

  test("parity, migration, changelog, and consumer fixture expose WATS-78", () => {
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const migration = read("docs/migration/pywa-to-wats.md");
    const changelog = read("CHANGELOG.md");
    const fixture = read("packages/testing/fixtures/core-consumer/verify-imports.ts");

    for (const doc of [parity, migration, changelog, fixture]) {
      expect(doc).toContain("WATS-78");
      expect(doc).toContain("waitForReply");
      expect(doc).toContain("waitUntilRead");
    }

    expect(parity).toContain("sent-result waiters");
    expect(migration).toContain("Implemented, credential-free");
    expect(fixture).toContain("WhatsAppWaitableSentResult");
  });
});
