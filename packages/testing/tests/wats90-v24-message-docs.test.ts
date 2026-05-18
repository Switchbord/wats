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

describe("WATS-90 v24 message builder docs", () => {
  test("reference docs describe call permission request and voice audio builders", () => {
    const endpoints = read("docs/reference/endpoints.md");
    const service = read("docs/reference/service.md");
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const changelog = read("CHANGELOG.md");

    for (const doc of [endpoints, service, parity, changelog]) {
      expect(doc).toContain("call_permission_request");
      expect(doc).toContain("voice");
      expect(doc).toContain("WATS-90");
    }

    expect(endpoints).toContain("buildSendCallPermissionRequestPayload");
    expect(endpoints).toContain("buildSendAudioPayload({ to, mediaId, voice: true })");
    expect(service).toContain("type: \"callPermissionRequest\"");
    expect(service).toContain("voice: true");
  });
});
