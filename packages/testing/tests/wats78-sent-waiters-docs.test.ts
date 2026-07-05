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
    const facade = read("site/content/docs/reference/whatsapp-facade.mdx");
    const listeners = read("site/content/docs/reference/listeners.mdx");

    // E3: voice pass removed the WATS-78 ticket token from these site docs
    // (CI banned-phrases forbids re-adding it). The surviving API-name terms
    // below are the real drift guard.
    for (const term of [
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

    expect(listeners).toMatch(/sent-result waiters/i);
    expect(listeners).toContain("timeoutMs");
    expect(listeners).toContain("AbortSignal");
  });

  test("parity, migration, changelog, and consumer fixture expose sent-result waiters", () => {
    const parity = read("site/content/docs/parity.mdx");
    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    const changelog = read("CHANGELOG.md");
    const fixture = read("packages/testing/fixtures/core-consumer/verify-imports.ts");

    // E3: WATS-78 ticket traceability legitimately lives in the changelog and
    // the consumer fixture (not voice-governed) — keep those assertions.
    for (const doc of [changelog, fixture]) {
      expect(doc).toContain("WATS-78");
    }

    // The voice pass dropped WATS-78 from parity + migration site docs; the
    // surviving feature/API-name assertions below preserve the drift guard.
    for (const doc of [parity, migration, changelog, fixture]) {
      expect(doc).toContain("waitForReply");
      expect(doc).toContain("waitUntilRead");
    }

    expect(parity).toMatch(/sent-result waiters/i);
    expect(migration).toContain("observed webhook updates");
    expect(fixture).toContain("WhatsAppWaitableSentResult");
  });
});
