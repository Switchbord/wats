// Docs-lock: Tranche 3 Calling reference page + scoped-clients density trim.
// Pins:
//   - the new calling reference page exists, carries DocMeta, is listed in the
//     route manifest and the reference index, and consolidates the lifecycle
//     callables, POST /{phoneNumberId}/calls, getCallPermissions +
//     GET /{phoneNumberId}/call_permissions, the userWaId/recipient XOR rule,
//     sendVoiceCall / buildWhatsAppCallDeepLink, ctaPayload / deeplinkPayload,
//     and the full operator-constraint / status vocabulary.
//   - scoped-clients.mdx no longer carries the public test-suite archaeology
//     sentence ("a dedicated test asserts the parity" / "the consumer fixture
//     asserts this equivalence") and now links to the calling reference page.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

const CALLING_PAGE = "site/content/docs/reference/calling.mdx";

describe("WATS docs Tranche 3 — Calling reference page", () => {
  test("the calling reference page exists and carries DocMeta", () => {
    expect(existsSync(join(repoRoot, CALLING_PAGE))).toBe(true);
    const page = read(CALLING_PAGE);
    expect(page).toMatch(/<DocMeta\b/u);
  });

  test("the route is registered in public-pages-manifest.json and the reference index", () => {
    const manifest = readJson<{ pages: string[] }>("site/public-pages-manifest.json");
    expect(manifest.pages).toContain("/docs/reference/calling");

    const index = read("site/content/docs/reference/index.mdx");
    expect(index).toContain("/docs/reference/calling");
    expect(index).toMatch(/Calling Reference|calling\.md/u);
  });

  test("lifecycle callables and POST /{phoneNumberId}/calls are documented", () => {
    const page = read(CALLING_PAGE);
    for (const term of [
      "initiateCall",
      "preAcceptCall",
      "acceptCall",
      "rejectCall",
      "terminateCall",
      "POST /{phoneNumberId}/calls",
      "connect",
      "pre_accept",
      "accept",
      "reject",
      "terminate"
    ]) {
      expect(page, `calling page must mention ${term}`).toContain(term);
    }
  });

  test("getCallPermissions, the permissions route, userWaId/recipient, and the XOR rule are documented", () => {
    const page = read(CALLING_PAGE);
    for (const term of [
      "getCallPermissions",
      "GET /{phoneNumberId}/call_permissions",
      "userWaId",
      "recipient",
      "XOR"
    ]) {
      expect(page, `calling page must mention ${term}`).toContain(term);
    }
    // The XOR rule must be stated in prose, not just as a table label.
    expect(page).toMatch(/exactly one/iu);
    expect(page).toMatch(/XOR/u);
  });

  test("sendVoiceCall, buildWhatsAppCallDeepLink, ctaPayload, and deeplinkPayload are documented", () => {
    const page = read(CALLING_PAGE);
    for (const term of [
      "sendVoiceCall",
      "buildWhatsAppCallDeepLink",
      "ctaPayload",
      "deeplinkPayload",
      "cta_payload",
      "deeplink_payload"
    ]) {
      expect(page, `calling page must mention ${term}`).toContain(term);
    }
  });

  test("operator constraints and status vocabulary are preserved", () => {
    const page = read(CALLING_PAGE);
    for (const term of [
      "shape-only",
      "no SIP server implementation",
      "App Review",
      "2,000 daily messaging limit",
      "USA, Canada, Egypt, Vietnam, Nigeria",
      "OPUS",
      "G.711",
      "PCMA",
      "PCMU",
      "Graph APIs + webhooks + WebRTC",
      "SIP + WebRTC",
      "SIP + SDES SRTP",
      "Tech Partner"
    ]) {
      expect(page, `calling page must mention ${term}`).toContain(term);
    }
    // The page must not claim WATS provisions calling access or ships a SIP server.
    expect(page).not.toContain("WATS can provision calling access");
    expect(page).not.toContain("WATS includes a SIP server");
  });
});

describe("WATS docs Tranche 3 — scoped-clients density trim", () => {
  test("scoped-clients.mdx no longer carries public test-suite archaeology sentences", () => {
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    expect(scoped).not.toContain("a dedicated test asserts the parity");
    expect(scoped).not.toContain("the consumer fixture asserts this equivalence");
  });

  test("scoped-clients.mdx links to the calling reference page", () => {
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    expect(scoped).toContain("/docs/reference/calling");
  });

  test("scoped-clients.mdx method catalog now includes sendMarketingTemplate", () => {
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    expect(scoped).toMatch(/sendMarketingTemplate/u);
    expect(scoped).toContain("marketing_messages");
  });
});
