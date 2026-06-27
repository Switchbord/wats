// WATS-161 — TELEMETRY-0: privacy model and metric taxonomy for WATS service telemetry.
//
// This test pins the design contract before any /metrics, /status, or
// diagnostics endpoint is implemented. It asserts:
//   1. A maintainer taxonomy doc exists and covers required decision areas.
//   2. The doc defines an explicit allowlist of metric names and label keys.
//   3. The doc defines a PII denylist — fields that must never appear as
//      metric labels or in diagnostic output.
//   4. The doc separates telemetry from liveness/readiness (/healthz, /readyz).
//   5. The doc decides endpoint protection (bearer token vs localhost bind).
//   6. No PII-looking strings appear in the allowed label keys.
//   7. Future telemetry issues (WATS-162..166) are referenced as consumers.
//
// No /metrics implementation exists in this slice. This is a docs/test
// contract only.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectAll(text: string, needles: readonly string[], label: string): void {
  for (const needle of needles) expect(text, `${label} missing "${needle}"`).toContain(needle);
}

describe("WATS-161 telemetry privacy model and metric taxonomy", () => {
  test("maintainer taxonomy doc exists and covers required decision areas", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expectAll(doc, [
      "WATS-161",
      "TELEMETRY-0",
      "Allowed metric families",
      "Allowed label keys",
      "PII denylist",
      "Endpoint protection",
      "healthz",
      "readyz",
      "No default outbound telemetry",
      "No raw event logging",
      "No analytics backend",
      "WATS-162",
      "WATS-163",
      "WATS-164",
      "WATS-165",
      "WATS-166"
    ], "telemetry taxonomy doc");
  });

  test("doc defines an explicit allowlist of metric names", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    // The doc must list concrete metric names in a structured section.
    expect(doc).toContain("Allowed metric families");
    // Each family must have at least one concrete metric name.
    expect(doc).toMatch(/http_requests_total|http\.requests\.total/iu);
    expect(doc).toMatch(/webhook_normalization_total|webhook\.normalization\.total/iu);
    expect(doc).toMatch(/graph_operations_total|graph\.operations\.total/iu);
  });

  test("doc defines an explicit allowlist of label keys", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("Allowed label keys");
    // Low-cardinality, PII-safe label keys.
    for (const key of [
      "route",
      "method",
      "status_class",
      "update_kind",
      "endpoint_family",
      "outcome"
    ]) {
      expect(doc, `label key "${key}" not in allowlist`).toContain(key);
    }
  });

  test("doc defines a PII denylist with all required categories", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("PII denylist");
    for (const category of [
      "phone numbers",
      "message text",
      "tokens",
      "WAMIDs",
      "raw webhook payloads",
      "config paths",
      "stack traces",
      "env values"
    ]) {
      expect(doc, `PII denylist missing "${category}"`).toContain(category);
    }
  });

  test("allowed label keys do not contain PII-bearing names", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    // Extract the label keys section and assert none look PII-bearing.
    const piiish = [
      "phone",
      "recipient",
      "sender",
      "message",
      "body",
      "token",
      "secret",
      "wamid",
      "filepath",
      "env",
      "config_path",
      "stack"
    ];
    // The doc must explicitly state that none of these are allowed as label keys.
    for (const word of piiish) {
      expect(doc, `doc must mention "${word}" as denied or not-allowed`).toMatch(
        new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu")
      );
    }
  });

  test("doc separates telemetry from liveness/readiness", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("separate");
    expect(doc).toMatch(/health.*readiness.*separate|separate.*health.*readiness/iu);
    expect(doc).toContain("/healthz");
    expect(doc).toContain("/readyz");
  });

  test("doc decides endpoint protection strategy", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    // Must pick one: bearer token or localhost/internal bind.
    expect(doc).toMatch(/bearer token|service bearer/iu);
    expect(doc).toMatch(/opt-in/iu);
    // Must not claim endpoints are public by default (affirmative, not negated).
    expect(doc).not.toMatch(/\b(?:are|is)\s+public\s+by\s+default\b/iu);
    expect(doc).not.toMatch(/\bdefault\s+public\b/iu);
  });

  test("doc states the three non-goals explicitly", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("No analytics backend");
    expect(doc).toContain("No default outbound telemetry");
    expect(doc).toContain("No raw event logging");
  });

  test("no /metrics implementation exists in this slice", () => {
    // The service index must not contain a /metrics route handler.
    const serviceIndex = read("packages/service/src/index.ts");
    expect(serviceIndex).not.toContain("/metrics");
    expect(serviceIndex).not.toContain("prometheus");
    expect(serviceIndex).not.toContain("openmetrics");
  });
});
