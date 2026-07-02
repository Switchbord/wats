// WATS-161 — TELEMETRY-0: privacy model and metric taxonomy for WATS service telemetry.
//
// This test pins the design contract before any /metrics, /status, or
// diagnostics endpoint is implemented. It asserts:
//   1. A maintainer taxonomy doc exists and covers required decision areas.
//   2. The doc defines an explicit allowlist of metric names (snake_case only).
//   3. The doc defines an explicit allowlist of label keys.
//   4. Every metric row's labels appear in the allowed-label-keys table.
//   5. The doc defines a PII denylist with all required categories.
//   6. The doc defines route templating and enum-clamping rules.
//   7. The doc separates telemetry from liveness/readiness.
//   8. The doc decides endpoint protection strategy (bearer, opt-in, 404).
//   9. No /metrics implementation exists anywhere in the service package.
//
// No /metrics implementation exists in this slice. This is a docs/test
// contract only.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/** Extract a section between two ## headings. */
function extractSection(doc: string, heading: string): string {
  const start = doc.indexOf(`## ${heading}`);
  expect(start, `section "${heading}" not found`).toBeGreaterThanOrEqual(0);
  const nextHeading = doc.indexOf("\n## ", start + 1);
  const end = nextHeading === -1 ? doc.length : nextHeading;
  return doc.slice(start, end);
}

/** Collect all .ts files under a directory recursively. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) results.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts")) results.push(full);
  }
  return results;
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

  test("doc defines an explicit allowlist of metric names in Prometheus snake_case", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("Allowed metric families");
    // Concrete metric names — snake_case only, no dotted OTel convention.
    expect(doc).toContain("http_requests_total");
    expect(doc).toContain("webhook_normalization_total");
    expect(doc).toContain("graph_operations_total");
    expect(doc).toContain("http_request_duration_seconds");
    expect(doc).toContain("outbox_depth");
  });

  test("doc defines an explicit allowlist of label keys", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("Allowed label keys");
    for (const key of [
      "route",
      "method",
      "status_class",
      "update_kind",
      "endpoint_family",
      "outcome",
      "adapter",
      "state"
    ]) {
      expect(doc, `label key "${key}" not in allowlist`).toContain(key);
    }
  });

  test("every label named in a metric row appears in the allowed-label-keys table", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    // Extract allowed label keys from the table.
    const labelSection = extractSection(doc, "Allowed label keys");
    // Extract metric labels from the metric families table.
    const metricSection = extractSection(doc, "Allowed metric families");
    // Collect all label key names mentioned in the allowed-label-keys table.
    // They appear as `| `key` |` in the first column.
    const allowedKeys = Array.from(
      labelSection.matchAll(/\|\s*`([a-z_]+)`\s*\|/gu),
      (m) => m[1]
    );
    expect(allowedKeys.length).toBeGreaterThan(0);
    // Collect all labels referenced in metric rows: "Labels: `a`, `b`, `c`."
    // Each label is individually backtick-quoted.
    const metricLabels = Array.from(
      metricSection.matchAll(/Labels:\s*(.*?)\.\s*\|/gu),
      (m) => Array.from(m[1].matchAll(/`([a-z_]+)`/gu), (x) => x[1])
    ).flat();
    expect(metricLabels.length).toBeGreaterThan(0);
    // Every metric label must be in the allowed set.
    for (const label of metricLabels) {
      expect(allowedKeys, `metric label "${label}" not in allowed label keys`).toContain(label);
    }
  });

  test("doc defines a PII denylist with all required categories", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("PII denylist");
    for (const category of [
      "phone numbers",
      "message text",
      "media content",
      "tokens",
      "WAMIDs",
      "raw webhook payloads",
      "config paths",
      "stack traces",
      "env values",
      "IP addresses",
      "location data",
      "profile and contact names"
    ]) {
      expect(doc, `PII denylist missing "${category}"`).toContain(category);
    }
  });

  test("allowed label keys do not contain PII-bearing substrings", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    // Extract only the Allowed label keys section, not the whole doc.
    const labelSection = extractSection(doc, "Allowed label keys");
    const piiishSubstrings = [
      "phone",
      "recipient",
      "sender",
      "message",
      "body",
      "token",
      "secret",
      "wamid",
      "filepath",
      "config_path",
      "stack"
    ];
    // Extract the key-name column from the table (first column after header).
    const tableRows = labelSection.match(/^\|\s*`([a-z_]+)`\s*\|/gmu);
    expect(tableRows, "no label key rows found in table").not.toBeNull();
    for (const row of tableRows!) {
      const key = row.match(/`([a-z_]+)`/u)![1];
      for (const sub of piiishSubstrings) {
        expect(
          key,
          `label key "${key}" contains denied substring "${sub}"`
        ).not.toContain(sub);
      }
    }
  });

  test("doc defines route templating and enum-clamping rules", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("Route templating rule");
    expect(doc).toContain(":param");
    expect(doc).toContain(":groupId");
    expect(doc).toContain("unmatched");
    expect(doc).toContain("Enum-clamping rule");
    expect(doc).toMatch(/enum.*unknown|unknown.*enum/iu);
    expect(doc).toContain("MUST NOT be used as label values verbatim");
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
    expect(doc).toMatch(/bearer token|service bearer/iu);
    expect(doc).toMatch(/opt-in/iu);
    // Must not claim endpoints are public by default (affirmative, not negated).
    expect(doc).not.toMatch(/\b(?:are|is)\s+public\s+by\s+default\b/iu);
    expect(doc).not.toMatch(/\bdefault\s+public\b/iu);
    // Disabled telemetry must fall through to 404.
    expect(doc).toMatch(/fall.*through|fallthrough|catch-all 404/iu);
    // 404 body must be byte-identical to catch-all.
    expect(doc).toMatch(/byte-identical|identical.*404/iu);
  });

  test("doc states the three non-goals explicitly", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    expect(doc).toContain("No analytics backend");
    expect(doc).toContain("No default outbound telemetry");
    expect(doc).toContain("No raw event logging");
  });

  test("outbox state label values match the real OutboxStatus type in @wats/persistence", () => {
    // Pin the doc's `state` label values to the actual source-of-truth type so
    // the contract cannot silently drift from the persistence layer. The prior
    // draft fabricated `claimed`/`sent`; the real type is the only authority.
    const persistenceSource = read("packages/persistence/src/index.ts");
    const typeMatch = persistenceSource.match(/export type OutboxStatus\s*=\s*([^;]+);/u);
    expect(typeMatch, "OutboxStatus type not found in @wats/persistence source").not.toBeNull();
    const realStates = Array.from(typeMatch![1].matchAll(/"([a-z_]+)"/gu), (m) => m[1]).sort();
    expect(realStates.length).toBeGreaterThan(0);

    const doc = read("maintainers/telemetry-taxonomy.md");
    const labelSection = extractSection(doc, "Allowed label keys");
    const stateRow = labelSection.match(/^\|\s*`state`\s*\|([^|]+)\|/mu);
    expect(stateRow, "`state` label row not found in allowed label keys table").not.toBeNull();
    const docStates = Array.from(stateRow![1].matchAll(/`([a-z_]+)`/gu), (m) => m[1]).sort();

    expect(
      docStates,
      `doc state values ${JSON.stringify(docStates)} must equal real OutboxStatus ${JSON.stringify(realStates)}`
    ).toEqual(realStates);
  });

  test("update_kind label values match the real TypedUpdateKind type in @wats/core", () => {
    // Pin the doc's `update_kind` label values to the actual webhook normalizer
    // type so the contract cannot silently drift. The prior draft fabricated
    // `template` (not a real kind) and `group_lifecycle_update` (a Meta webhook
    // field name, not the normalized kind value — the real kind is
    // `groupLifecycle`); TypedUpdateKind is the only authority.
    const coreSource = read("packages/core/src/webhookNormalizer.ts");
    const typeMatch = coreSource.match(/export type TypedUpdateKind\s*=\s*([\s\S]+?);/u);
    expect(typeMatch, "TypedUpdateKind type not found in @wats/core source").not.toBeNull();
    const realKinds = Array.from(typeMatch![1].matchAll(/"([a-zA-Z]+)"/gu), (m) => m[1]).sort();
    expect(realKinds.length).toBeGreaterThan(0);

    const doc = read("maintainers/telemetry-taxonomy.md");
    const labelSection = extractSection(doc, "Allowed label keys");
    const kindRow = labelSection.match(/^\|\s*`update_kind`\s*\|([^|]+)\|/mu);
    expect(kindRow, "`update_kind` label row not found in allowed label keys table").not.toBeNull();
    const docKinds = Array.from(kindRow![1].matchAll(/`([a-zA-Z]+)`/gu), (m) => m[1]).sort();

    expect(
      docKinds,
      `doc update_kind values ${JSON.stringify(docKinds)} must equal real TypedUpdateKind ${JSON.stringify(realKinds)}`
    ).toEqual(realKinds);
  });

  test("bearer-token guidance is well-formed prose, not a garbled/redacted fragment", () => {
    const doc = read("maintainers/telemetry-taxonomy.md");
    const protection = extractSection(doc, "Endpoint protection");
    // No stray triple-asterisk redaction artifacts.
    expect(protection).not.toContain("***");
    // The bearer bullet must be a complete sentence (ends with a period before
    // the next list item), and the Authorization header code span must be
    // balanced (even number of backticks on the bullet line).
    const bearerLine = protection.split("\n").find((l) => l.includes("Bearer token"));
    expect(bearerLine, "bearer-token bullet not found").toBeDefined();
    const backticks = (bearerLine!.match(/`/gu) ?? []).length;
    expect(backticks % 2, `unbalanced code span in bearer line: ${bearerLine}`).toBe(0);
    expect(bearerLine).toMatch(/Authorization: Bearer/u);
    expect(bearerLine!.trimEnd().endsWith(".")).toBe(true);
  });

  test("no /metrics implementation exists anywhere in the service package", () => {
    const serviceDir = join(repoRoot, "packages", "service", "src");
    const tsFiles = collectTsFiles(serviceDir);
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const file of tsFiles) {
      const content = readFileSync(file, "utf8");
      expect(
        content,
        `${file} contains "/metrics" — implementation must not exist in this slice`
      ).not.toMatch(/\/metrics/iu);
      expect(
        content,
        `${file} contains "prometheus" — implementation must not exist in this slice`
      ).not.toMatch(/prometheus/iu);
      expect(
        content,
        `${file} contains "openmetrics" — implementation must not exist in this slice`
      ).not.toMatch(/openmetrics/iu);
    }
  });
});
