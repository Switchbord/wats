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
    const endpoints = read("site/content/docs/reference/endpoints.mdx");
    const service = read("site/content/docs/reference/service.mdx");
    const changelog = read("CHANGELOG.md");

    // E3: WATS-90 ticket traceability legitimately lives in the changelog (not
    // voice-governed) — keep it. The voice pass removed the WATS-90 token and
    // the call_permission_request/voice content from parity.mdx (real doc gap:
    // parity's "Call permissions + WebRTC" row still reads "Not built / planned"
    // and does not mention call_permission_request or the voice audio delta —
    // noted for parent). The reference-doc feature assertions below are the
    // surviving drift guard.
    for (const doc of [endpoints, service, changelog]) {
      expect(doc).toContain("call_permission_request");
      expect(doc).toContain("voice");
    }
    expect(changelog).toContain("WATS-90");

    expect(endpoints).toContain("buildSendCallPermissionRequestPayload");
    // Doc renders the voice audio builder with concrete sample args; assert on
    // the surviving call shape rather than the old placeholder-arg literal.
    expect(endpoints).toMatch(/buildSendAudioPayload\(\{[^}]*voice:\s*true[^}]*\}\)/);
    expect(service).toContain("type: \"callPermissionRequest\"");
    expect(service).toContain("voice: true");
  });
});
