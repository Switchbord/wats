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

describe("WATS-98 Marketing Messages docs and package surface lockstep", () => {
  test("Graph package root/subpath and consumer fixture expose WATS-98 Marketing Messages symbols", () => {
    const graphSource = [
      read("packages/graph/src/endpoints/messages.ts"),
      read("packages/graph/src/endpoints/messages/index.ts"),
      read("packages/graph/src/endpoints/messages/types.ts"),
      read("packages/graph/src/endpoints/messages/builders-template.ts"),
      read("packages/graph/src/endpoints/messages/callables.ts")
    ].join("\n");
    for (const term of [
      "sendMarketingTemplate",
      "buildSendMarketingTemplatePayload",
      "/{phoneNumberId}/marketing_messages",
      "product_policy",
      "message_activity_sharing",
      "recipient"
    ]) {
      expect(graphSource).toContain(term);
    }

    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");
    for (const term of [
      "sendMarketingTemplate",
      "buildSendMarketingTemplatePayload",
      "type GraphMessagesSendMarketingTemplateInput",
      "type GraphMessagesMarketingTemplateResponse",
      "wats98-marketing-messages root exports are functions",
      "wats98-marketing-messages round trips through scoped clients"
    ]) {
      expect(fixture).toContain(term);
    }
    expect(fixture).toContain('from "@wats/graph/endpoints/messages"');
  });

  test("types/core surfaces expose Marketing Messages status and onboarding helpers", () => {
    const statuses = read("packages/types/src/statuses.ts");
    for (const term of [
      "marketing_lite",
      "PMP",
      "message_status",
      "held_for_quality_assessment",
      "paused"
    ]) {
      expect(statuses).toContain(term);
    }

    const webhookTypes = read("packages/types/src/webhook.ts");
    for (const term of [
      "marketingMessages",
      "MM_LITE_TERMS_SIGNED",
      "ownerBusinessId",
      "marketing_messages_onboarding_status",
      "marketing_messages_lite_api_status"
    ]) {
      expect(webhookTypes).toContain(term);
    }
  });

  test("public docs describe WATS-98 route, fields, statuses, and non-goals", () => {
    const endpoints = read("docs/reference/endpoints.md");
    for (const term of [
      "WATS-98",
      "sendMarketingTemplate",
      "/marketing_messages",
      "marketing_messages",
      "product_policy",
      "message_activity_sharing",
      "recipient",
      "BSUID",
      "message_status",
      "held_for_quality_assessment",
      "paused",
      "no live Meta calls"
    ]) {
      expect(endpoints).toContain(term);
    }

    const webhookNormalizer = read("docs/reference/webhook-normalizer.md");
    for (const term of [
      "WATS-98",
      "marketing_lite",
      "pricing.category",
      "conversation.origin.type",
      "MM_LITE_TERMS_SIGNED",
      "marketingMessages"
    ]) {
      expect(webhookNormalizer).toContain(term);
    }

    const parity = read("docs/parity/pywa-parity-matrix.md");
    expect(parity).toContain("WATS-98");
    expect(parity).toContain("Marketing Messages API");

    const migration = read("docs/migration/pywa-to-wats.md");
    expect(migration).toContain("sendMarketingTemplate");
    expect(migration).toContain("marketing_lite");

    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("WATS-98");
    expect(changelog).toContain("/marketing_messages");
  });
});
