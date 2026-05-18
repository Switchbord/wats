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
    const migration = read("docs/migration/pywa-to-wats.md");
    expect(migration).not.toContain("TODO(A2)");
    expect(migration).toContain("status: active");
    expect(migration).toContain("lastReviewed: 2026-05-01");

    expectAll(migration, [
      "## Status labels",
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
      "## Credentialed validation campaign"
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
    const path = "docs/parity/live-testing-campaign.md";
    expect(existsSync(join(repoRoot, path))).toBe(true);
    const campaign = read(path);

    expectAll(campaign, [
      "# WATS credentialed live-testing campaign",
      "status: planned",
      "lastReviewed: 2026-05-01",
      "## Scope and non-goals",
      "## Credential inventory",
      "## Safe ordering",
      "## Endpoint risk classification",
      "## Redaction rules",
      "## Cleanup and rollback",
      "## Abort criteria",
      "## Docs and test locks"
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
      "read-only before side-effecting before destructive",
      "run manifest outside the repository",
      "SIP credentials",
      "media URLs",
      "x-hub-signature-256"
    ]);
  });

  test("parity and roadmap docs point to WATS-44 live-validation plan", () => {
    const matrix = read("docs/parity/pywa-parity-matrix.md");
    expect(matrix).toContain("lastReviewed: 2026-05-01");
    expect(matrix).toContain("pywa migration and parity audit (WATS-44)");
    expect(matrix).toContain("docs/parity/live-testing-campaign.md");
    expect(matrix).toContain("Live validation status");

    const roadmap = read("docs/architecture/roadmap-to-whatsapp-pywa-parity.md");
    expect(roadmap).toContain("WATS-44");
    expect(roadmap).toContain("credentialed validation campaign");
    expect(roadmap).toContain("read-only discovery");
    expect(roadmap).toContain("controlled side-effecting tests");
  });

  test("current docs remove known WATS-44 stale claims", () => {
    const openapi = read("docs/reference/openapi.md");
    expect(openapi).not.toContain("a CLI `wats openapi` implementation");
    expect(openapi).toContain("full Meta Graph API OpenAPI document");

    const service = read("docs/reference/service.md");
    expect(service).not.toContain("CLI `wats openapi` / `wats serve` execution");
    expect(service).toContain("credential-gated live `wats serve` execution");

    const config = read("docs/reference/config.md");
    expect(config).toContain("Live testing profile");
    expect(config).toContain("env: WATS_ACCESS_TOKEN");
    expect(config).toContain("env: WATS_APP_SECRET");
  });
});
