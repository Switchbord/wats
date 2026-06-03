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
    const normalizer = read("docs/reference/webhook-normalizer.md");
    const filters = read("docs/reference/filters.md");

    for (const term of [
      "WATS-79",
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
      "WATS-79",
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
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const migration = read("docs/migration/pywa-to-wats.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [parity, migration, changelog]) {
      expect(doc).toContain("WATS-79");
      expect(doc).toContain("user_preferences");
      expect(doc).toContain("system");
      expect(doc).toContain("chat_opened");
    }

    expect(parity).toContain("user preferences, system phone/identity events, and chat_opened");
    expect(migration).toContain("Implemented, credential-free");
    expect(migration).toContain("filtersTyped.userPreferences");
  });
});
