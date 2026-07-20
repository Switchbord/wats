// WATS-44 RED — pywa migration/parity audit and live-testing campaign docs lock.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectAll(content: string, snippets: readonly string[]) {
  for (const snippet of snippets) {
    expect(content).toContain(snippet);
  }
}

describe("WATS-44 pywa migration docs", () => {
  test("migration guide replaces scaffold with concrete pywa-to-WATS mapping", () => {
    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    expect(migration).not.toContain("TODO(A2)");
    // Voice-pass moved metadata into a JSX <DocMeta> tag and refreshed the
    // review date to the June 2026 live campaign. The DocMeta status
    // attribute carries the capability honesty tag (live-validated /
    // shape-only / planned) per the closed set in api-stability; this
    // migration guide makes no single capability claim, so status is
    // omitted and only lastReviewed survives.
    expect(migration).toContain('lastReviewed="2026-06-10"');

    expectAll(migration, [
      // "## Status labels" heading was reworded to inline prose introducing the
      // honesty taxonomy; the substance (a documented status taxonomy) survives.
      "Status tags below use the honesty taxonomy",
      "## Package and construction map",
      "## Client construction and auth",
      "## Message sending map",
      "## Media map",
      "## Templates map",
      "## Flows map",
      "## Calling map",
      "## Business and admin map",
      "## Webhook, handler, filter, and listener migration",
      "## Error handling migration",
      "## Import and subpath cheat sheet",
      "## Known gaps to plan around",
      // "## Credentialed validation campaign" heading was dropped; the campaign
      // content now lives in parity/live-campaign.mdx and is linked from here.
      "[campaign gates](/docs/parity/live-campaign)"
    ]);

    expectAll(migration, [
      "pywa `send_message` / `send_text`",
      "WATS `PhoneNumberClient.sendText`",
      "pywa `create_template` / `get_templates` / `delete_template`",
      "WATS `WABAClient.createMessageTemplate`",
      "pywa `create_flow` / `get_flows` / `publish_flow`",
      "WATS `WABAClient.createFlow`",
      "pywa `initiate_call` / `accept_call` / `terminate_call`",
      "WATS `PhoneNumberClient.initiateCall`",
      "pywa `get_business_profile` / `get_commerce_settings`",
      "WATS `PhoneNumberClient.getBusinessProfile`",
      "pywa decorators such as `@wa.on_message`",
      "WATS `TypedRouter.on(...)`",
      "pywa sent-update waiters",
      "WATS `wa.listen(...)`"
    ]);
  });

  test("live testing campaign runbook exists and keeps credentials gated", () => {
    const path = "site/content/docs/parity/live-campaign.mdx";
    expect(existsSync(join(repoRoot, path))).toBe(true);
    const campaign = read(path);

    expectAll(campaign, [
      // Voice pass moved the H1 into frontmatter title and headings were
      // reworded; substance (the campaign runbook + executed run) survives.
      "title: Live-testing campaign",
      "operator-authorized run against real Meta assets",
      'lastReviewed="2026-06-10"',
      "## Scope",
      "## Credential inventory",
      "## Phase order",
      "## Risk classification",
      "## Redaction rules",
      "## Cleanup and rollback",
      "## Abort criteria",
      "## Harness requirements",
      "## Execution log"
    ]);

    expectAll(campaign, [
      "WATS_LIVE_ENABLE=1",
      "WATS_ACCESS_TOKEN",
      "WATS_WABA_ID",
      "WATS_PHONE_NUMBER_ID",
      "WATS_APP_SECRET",
      "WATS_VERIFY_TOKEN",
      "WATS_TEST_RUN_ID",
      "WATS_ENABLE_TEMPLATE_MUTATIONS=1",
      "WATS_ENABLE_FLOW_MUTATIONS=1",
      "WATS_ENABLE_CALLING_LIVE=1",
      "WATS_ENABLE_ADMIN_MUTATIONS=1",
      "Read-only before side-effecting before destructive",
      "run manifest outside the repository",
      "SIP credentials",
      "media URLs",
      "x-hub-signature-256"
    ]);
  });

  test("parity and roadmap docs point to WATS-44 live-validation plan", () => {
    const matrix = read("site/content/docs/parity.mdx");
    // Voice pass moved review date into a JSX <DocMeta> attribute and linked
    // the campaign by its site route instead of the source path; the WATS-44
    // ticket label was stripped from public docs. The surviving guard is that
    // the matrix carries the live-validated taxonomy and links the campaign log.
    expect(matrix).toContain('lastReviewed="2026-06-21"');
    expect(matrix).toContain("live-validated");
    expect(matrix).toContain("/docs/parity/live-campaign");

    const roadmap = read("site/content/docs/meta/roadmap.mdx");
    // WATS-44 ticket ref removed by voice pass; the campaign-plan facts survive.
    expect(roadmap).toContain("credentialed validation");
    expect(roadmap).toContain("read-only discovery");
    expect(roadmap).toContain("side-effecting tests");
  });

  test("current docs remove known WATS-44 stale claims", () => {
    // The openapi reference page was deliberately not migrated (the playground +
    // service reference now cover OpenAPI); its stale-claim assertions retire with it.
    const service = read("site/content/docs/reference/service.mdx");
    expect(service).not.toContain("CLI `wats openapi` / `wats serve` execution");
    // Voice pass reworded "execution" → "wrappers"; the fact (CLI provides a
    // credential-gated live serve path) survives.
    expect(service).toContain("credential-gated live `wats serve` wrappers");

    const config = read("site/content/docs/reference/config.mdx");
    expect(config).toContain("Live testing profile");
    expect(config).toContain("env: WATS_ACCESS_TOKEN");
    expect(config).toContain("env: WATS_APP_SECRET");
  });
});
