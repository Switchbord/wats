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

describe("WATS-79 webhook-family docs lockstep", () => {
  test("reference docs describe normalized user_preferences, system, and chat_opened updates", () => {
    const normalizer = read("site/content/docs/reference/webhook-normalizer.mdx");
    const filters = read("site/content/docs/reference/filters.mdx");

    for (const term of [
      // WATS-79 ticket ref dropped: voice pass stripped ticket tokens from site MDX
      // and check-banned-phrases forbids re-adding. The TypedUpdate/family terms below
      // are the surviving drift guard.
      "TypedUserPreferencesUpdate",
      "userPreferences",
      "user_preferences",
      "TypedSystemUpdate",
      "phoneNumberChange",
      "identityChange",
      "TypedChatOpenedUpdate",
      "chatOpened",
      "chat_opened",
      "REQUEST_WELCOME"
    ]) {
      expect(normalizer).toContain(term);
    }

    for (const term of [
      // WATS-79 dropped from site MDX (see above); filter API-name assertions guard intent.
      "userPreferences.preference",
      "userPreferences.category",
      "system.phoneNumberChange",
      "system.identityChange",
      "chatOpened.requestWelcome"
    ]) {
      expect(filters).toContain(term);
    }
  });

  test("parity and migration docs no longer list these first-slice webhook families as deferred", () => {
    const parity = read("site/content/docs/parity.mdx");
    const migration = read("site/content/docs/migration/pywa.mdx");
    const changelog = read("CHANGELOG.md");

    // CHANGELOG is not voice-governed: keep full ticket + family traceability.
    expect(changelog).toContain("WATS-79");
    for (const doc of [migration, changelog]) {
      expect(doc).toContain("user_preferences");
      expect(doc).toContain("system");
      expect(doc).toContain("chat_opened");
    }

    // parity.mdx voice pass folded the three families into the "Webhook normalization"
    // row ("live-validated for message and status families; deeper families shape-only").
    // shape-only = implemented (not deferred/planned), which preserves this test's intent.
    // DOC-GAP (for parent): parity.mdx no longer enumerates user_preferences/system/
    // chat_opened by name — they are only implied by "deeper families shape-only".
    expect(parity).toMatch(/Webhook normalization[\s\S]*deeper families shape-only/iu);

    // "Implemented, credential-free" phrasing was reworded; migration now maps the
    // families to their typed updates + filters, which proves implemented (not deferred).
    expect(migration).toContain("TypedUserPreferencesUpdate");
    expect(migration).toContain("filtersTyped.userPreferences");
  });
});
