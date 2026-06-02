import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

type PublicDocsManifest = { pages?: unknown; exclude?: unknown };

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; private?: boolean };
      if (manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function absolute(path: string): string {
  return join(repoRoot, path);
}

function read(path: string): string {
  return readFileSync(absolute(path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function walkFiles(startPath: string): string[] {
  if (!existsSync(absolute(startPath))) return [];
  const entries = readdirSync(absolute(startPath), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = `${startPath}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkFiles(relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort();
}

function expectAll(text: string, needles: readonly string[], label: string): void {
  for (const needle of needles) {
    expect(text, `${label} should contain ${needle}`).toContain(needle);
  }
}

const rawSecretPatterns = [
  /\bEAA[A-Za-z0-9_-]{20,}\b/u,
  /Authorization\s*[:=]\s*["']?Bearer\s+(?!<|\$\{|process\.env)[A-Za-z0-9_.-]{12,}["']?/iu,
  /(?:access[_-]?token|bearer[_-]?token|service[_-]?token|verify[_-]?token|app[_-]?secret)\s*[:=]\s*["']?(?!\*{3}|<|>|\$\{|process\.env|env:|$)[A-Za-z0-9_./+=-]{12,}["']?/iu,
  /\b(?:whatsapp_business_account_id|phone_number_id)_[A-Za-z0-9_-]+\b/iu,
  /\b(?:WABA|PHONE|WHATSAPP|BUSINESS)[_-]?(?:ID|ACCOUNT)[_-]?[:=]\s*["']?[1-9][0-9]{10,}["']?/iu
] as const;

function expectNoRawSecrets(path: string): void {
  const text = read(path);
  for (const pattern of rawSecretPatterns) {
    expect(text, `${path} should not contain raw-looking secrets matching ${pattern}`).not.toMatch(pattern);
  }
}

function expectNoMisleadingLocalhostCurl(path: string): void {
  const text = read(path);
  expect(text, `${path} should not ask users to verify Meta webhooks against plain localhost`).not.toMatch(
    /curl\s+[^\n]*(?:localhost|127\.0\.0\.1)[^\n]*(?:webhook|groups?)/iu
  );
  expect(text, `${path} should mention public HTTPS tunnel caveat for Meta webhook verification`).toMatch(/public HTTPS .*tunnel|ngrok|equivalent HTTPS tunnel/iu);
}

describe("WATS-138 public Groups documentation", () => {
  test("reference and quickstart pages are public and linked from the reference index", () => {
    const manifest = readJson<PublicDocsManifest>("docs/public-docs-manifest.json");
    expect(Array.isArray(manifest.pages)).toBe(true);
    expect(manifest.pages).toContain("reference/groups.md");
    expect(manifest.pages).toContain("guides/groups-quickstart.md");

    expect(existsSync(absolute("docs/reference/groups.md"))).toBe(true);
    expect(existsSync(absolute("docs/guides/groups-quickstart.md"))).toBe(true);

    const referenceIndex = read("docs/reference/index.md");
    expect(referenceIndex).toContain("reference/groups.md");
    expect(referenceIndex).toContain("Groups");
  });

  test("groups reference locks endpoint contracts, limits, and async/error semantics", () => {
    const doc = read("docs/reference/groups.md");

    expectAll(doc, [
      "@wats/graph/endpoints/groups",
      "PhoneNumberClient.createGroup",
      "PhoneNumberClient.listGroups",
      "GroupClient",
      "enableGroupRoutes",
      "POST /{phoneNumberId}/groups",
      "GET /{phoneNumberId}/groups",
      "GET /{groupId}",
      "POST /{groupId}",
      "DELETE /{groupId}",
      "GET /{groupId}/invite_link",
      "POST /{groupId}/invite_link",
      "DELETE /{groupId}/participants",
      "GET /{groupId}/join_requests",
      "POST /{groupId}/join_requests",
      "DELETE /{groupId}/join_requests"
    ], "groups reference endpoint table");

    expectAll(doc, [
      "business phone-number id",
      "not the WABA id",
      "max 8 participants",
      "subject <=128",
      "description <=2048",
      "photo JPEG <=5MB",
      "square",
      ">=192px",
      "No direct participant add",
      "no admin promote/demote",
      "invite-link only",
      "reset invalidates the previous invite link",
      "suspended",
      "request_id",
      "group_lifecycle_update",
      "group_participants_update",
      "group_settings_update",
      "group_status_update"
    ], "groups reference limits and gotchas");

    expect(doc).toMatch(/validation.*GraphRequestValidationError|GraphRequestValidationError.*validation/isu);
    expect(doc).toMatch(/Meta errors.*graph_request_failed|graph_request_failed.*Meta errors/isu);
    expect(doc).toMatch(/camelCase.*snake_case|snake_case.*camelCase/isu);
  });

  test("groups quickstart documents the offline-to-live path without credential leakage", () => {
    const guide = read("docs/guides/groups-quickstart.md");

    expectAll(guide, [
      "createGroup",
      "group_lifecycle_update",
      "getInviteLink",
      "sendText",
      "approveJoinRequests",
      "sendGroupMessage",
      "MockTransport",
      "synthetic group webhook",
      "enableGroupRoutes",
      "WATS_ACCESS_TOKEN",
      "WATS_APP_SECRET",
      "WATS_VERIFY_TOKEN"
    ], "groups quickstart");

    expect(guide).toMatch(/create.*invite link.*approve.*message/isu);
    expect(guide).toMatch(/placeholder-only|placeholder values|placeholders/iu);
    expectNoMisleadingLocalhostCurl("docs/guides/groups-quickstart.md");
    expectNoRawSecrets("docs/guides/groups-quickstart.md");
  });

  test("parity and migration docs mark Groups as a beyond-pywa addition with live status separate", () => {
    const parity = read("docs/parity/pywa-parity-matrix.md");
    const migration = read("docs/migration/pywa-to-wats.md");

    expect(parity).toMatch(/Groups API[\s\S]*no pywa equivalent[\s\S]*beyond-pywa/iu);
    expect(parity).toMatch(/credential-free[\s\S]*(implemented|SDK\/webhook\/service)[\s\S]*live (?:pending|validation)/iu);
    expect(parity).toContain("WATS-138");
    expect(parity).toContain("WATS-139");

    expect(migration).toContain("@wats/graph/endpoints/groups");
    expect(migration).toContain("@wats/types/groups");
    expect(migration).toContain("PhoneNumberClient.createGroup");
    expect(migration).toContain("WhatsApp.sendGroupMessage");
    expect(migration).toMatch(/WATS addition, no pywa equivalent/iu);
  });
});

describe("WATS-138 Groups runnable example", () => {
  test("groups example is workspace-wired, offline, and documented from the examples index", () => {
    expect(existsSync(absolute("examples/groups/package.json"))).toBe(true);
    expect(existsSync(absolute("examples/groups/src/index.ts"))).toBe(true);
    expect(existsSync(absolute("examples/groups/README.md"))).toBe(true);

    const rootManifest = readJson<{ scripts?: Record<string, string>; workspaces?: string[] }>("package.json");
    expect(rootManifest.workspaces).toContain("examples/groups");
    expect(rootManifest.scripts?.["examples:groups"]).toBe("bun run --cwd examples/groups demo");

    const examplesReadme = read("examples/README.md");
    expect(examplesReadme).toContain("examples/groups/");
    expect(examplesReadme).toContain("bun run examples:groups");
  });

  test("groups example uses public package imports, MockTransport, and synthetic group webhook data", () => {
    const code = read("examples/groups/src/index.ts");

    expect(code).toContain("@wats/graph");
    expect(code).toContain("@wats/graph/testing");
    expect(code).toContain("@wats/core");
    expect(code).toContain("createMockTransport");
    expect(code).toContain("group_lifecycle_update");
    expect(code).toContain("group_participants_update");
    expect(code).toContain("recipient_type");
    expect(code).toContain("GROUP_ID_FROM_WEBHOOK");
    expect(code).not.toMatch(/from\s+["'][.]{1,2}\/.*packages\/[^"']*\/src[^"']*["']/u);
    expect(code).not.toMatch(/packages\/[^\s"']+\/src/u);

    const importSpecifiers = Array.from(code.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/gu)).map(
      (match) => match[1] ?? ""
    );
    for (const specifier of importSpecifiers) {
      if (specifier.includes("wats") || specifier.includes("packages/")) {
        expect(specifier, "example must use public WATS package specifiers").toMatch(
          /^@wats\/[a-z0-9-]+(?:\/testing|\/endpoints\/[a-z0-9-]+)?$/u
        );
      }
    }
  });

  test("groups example docs and code avoid raw credentials and misleading localhost webhook curl", () => {
    const filesToScan = walkFiles("examples/groups").filter((path) => statSync(absolute(path)).isFile());
    expect(filesToScan).toContain("examples/groups/README.md");
    for (const path of filesToScan) {
      if ([".ts", ".md", ".json"].includes(extname(path))) expectNoRawSecrets(path);
    }
    expectNoMisleadingLocalhostCurl("examples/groups/README.md");
  });
});
