// WATS-166 — TELEMETRY-E: docs guardrails for telemetry operator surface.
//
// Ensures the telemetry guide and service reference avoid false claims,
// PII examples, live-backend promises, and unsafe token placeholders.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const repoRoot = new URL("../../../", import.meta.url);
const guidePath = new URL("site/content/docs/guides/telemetry.mdx", repoRoot);
const serviceRef = new URL("site/content/docs/reference/service.mdx", repoRoot);
const privacyRef = new URL("site/content/docs/meta/privacy.mdx", repoRoot);
const guidesMeta = new URL("site/content/docs/guides/meta.json", repoRoot);

function readText(url: URL): string {
  return readFileSync(url, "utf8");
}

describe("WATS-166 telemetry docs guardrails", () => {
  const guide = readText(guidePath);
  const service = readText(serviceRef);
  const privacy = readText(privacyRef);
  const meta = JSON.parse(readText(guidesMeta)) as { pages: string[] };

  test("telemetry guide is wired into the guides navigation", () => {
    expect(meta.pages).toContain("telemetry");
  });

  test("telemetry docs make the opt-in / no-default-telemetry claim", () => {
    expect(guide.toLowerCase()).toContain("no default outbound telemetry");
    expect(guide.toLowerCase()).toContain("opt-in");
    expect(privacy.toLowerCase()).toContain("no default outbound telemetry is sent");
    expect(privacy.toLowerCase()).toContain("always registered");
    expect(guide.toLowerCase()).toContain("always registered");
  });

  test("telemetry docs do not claim endpoints are disabled or unregistered by default", () => {
    const forbidden = [/not registered unless/i, /enabled in config/i, /disabled by default/i];
    for (const re of forbidden) {
      expect(re.test(guide)).toBe(false);
      expect(re.test(privacy)).toBe(false);
    }
  });

  test("telemetry docs document the three protected endpoints", () => {
    for (const endpoint of ["/metrics", "/status", "/debug/diagnostics"]) {
      expect(guide).toContain(endpoint);
      expect(service).toContain(endpoint);
    }
  });

  test("telemetry docs do not claim outbound telemetry to WATS maintainers or vendors", () => {
    const forbidden = [
      /telemetry\s+(is\s+)?(sent|sends?)\s+(to\s+)?(WATS|maintainer|vendor|backend)/i,
      /(WATS|maintainer|vendor)\s+.*\btelemetry\b.*\b(sent|sends?|collects?)/i,
      /sends?\s+telemetry\s+(to\s+)?(WATS|maintainer|vendor|backend)/i,
    ];
    for (const re of forbidden) {
      expect(re.test(guide)).toBe(false);
      expect(re.test(privacy)).toBe(false);
    }
  });

  test("telemetry docs do not expose PII examples", () => {
    // Phone-number-like placeholders in other pages are acceptable only if
    // they are clearly synthetic (1555...). The telemetry guide must not
    // contain any.
    const phoneLike = /\b1\d{10,}\b/;
    expect(phoneLike.test(guide)).toBe(false);
    const wamidLike = /wamid\./i;
    expect(wamidLike.test(guide)).toBe(false);
  });

  test("telemetry docs use token placeholders, never real tokens", () => {
    // Any bearer token reference must be a placeholder or env var.
    const matches = guide.match(/bearer_token:\s*"([^"]+)"/g) ?? [];
    for (const line of matches) {
      expect(line).toMatch(/\$\{/); // placeholder expansion only
    }
    const authLines = guide.match(/Authorization:\s*Bearer[^\n]*/g) ?? [];
    for (const line of authLines) {
      expect(line).toMatch(/\$\{|\.\.\.|\.\.\.N/); // env var or ellipsis placeholder
    }
  });

  test("telemetry guide includes Prometheus scrape and OTel adapter examples", () => {
    expect(guide).toContain("scrape_configs");
    expect(guide).toContain("@opentelemetry/api");
    expect(guide).toContain("TelemetrySink");
    expect(guide).toContain("OTEL_ATTR");
  });

  test("telemetry guide links to related references", () => {
    expect(guide).toContain("/docs/reference/service");
    expect(guide).toContain("/docs/meta/privacy");
    expect(privacy).toContain("/docs/guides/telemetry");
  });

  test("telemetry guide includes the threat model checklist", () => {
    expect(guide).toContain("Operator checklist");
    expect(guide).toContain("What not to do");
    expect(guide).toContain("404");
  });
});
