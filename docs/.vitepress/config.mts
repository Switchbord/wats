import { defineConfig } from "vitepress";
import manifest from "../public-docs-manifest.json" with { type: "json" };

const pages = manifest.pages as string[];
const publicPageSet = new Set(pages);
const allCandidatePages = [
  "guides/getting-started.md",
  "api/index.md",
  "guides/cli-init.md",
  "guides/filters-recipes.md",
  "guides/handlers-overview.md",
  "guides/webhook-with-bun.md",
  "reference/handlers.md",
  "reference/internal-utils.md",
  "architecture/cli-service-openapi-options.md",
  "architecture/package-map.md",
  "architecture/wats57-graph-endpoint-module-split-plan.md",
  "architecture/wats58-graph-validation-utility-reuse-plan.md",
  "architecture/decisions/ADR-001-api-shape.md",
  "architecture/decisions/ADR-002-foundations-pivot.md",
  "architecture/decisions/ADR-003-transport-and-crypto-abstractions.md",
  "architecture/decisions/ADR-004-typed-updates-and-handler-model.md",
  "architecture/decisions/ADR-005-endpoint-registry-and-error-taxonomy.md",
  "architecture/decisions/ADR-006-testing-and-consumer-fixture-strategy.md",
  "architecture/decisions/ADR-007-alpha-cli-runtime-operator-layer.md",
  "handoff.md",
  "handoff-reviewer-2026-05-02.md",
  "handoff-context-compression-2026-04-28.md",
  "handoff-context-compression-2026-04-30.md",
  "handoff-context-compression-2026-05-01.md"
];
const nonPublicPages = allCandidatePages.filter((page) => !publicPageSet.has(page));

function link(path: string): string {
  const withoutMd = path.replace(/\.md$/u, "");
  return withoutMd === "index" ? "/" : `/${withoutMd}`;
}

function item(text: string, page: string) {
  return { text, link: link(page) };
}

export default defineConfig({
  title: "WATS",
  description: "Bun-first TypeScript WhatsApp Cloud API framework inspired by pywa.",
  cleanUrls: true,
  ignoreDeadLinks: false,
  srcExclude: [
    ...nonPublicPages,
    "handoff-context-compression-*.md",
    "handoff-reviewer-*.md"
  ],
  themeConfig: {
    nav: manifest.nav,
    search: { provider: "local" },
    sidebar: [
      {
        text: "Start",
        items: [
          item("Overview", "index.md"),
          item("Getting Started", "getting-started.md"),
          item("Migration from pywa", "migration/pywa-to-wats.md"),
          item("Parity Matrix", "parity/pywa-parity-matrix.md"),
          item("Live Testing Campaign", "parity/live-testing-campaign.md")
        ]
      },
      {
        text: "Reference",
        items: pages
          .filter((page) => page.startsWith("reference/"))
          .map((page) => item(page.replace(/^reference\//u, "").replace(/\.md$/u, ""), page))
      },
      {
        text: "API",
        items: [item("Package API", "api/index.md"), item("OpenAPI UI", "reference/openapi-ui.md")]
      },
      {
        text: "Guides",
        items: pages
          .filter((page) => page.startsWith("guides/"))
          .map((page) => item(page.replace(/^guides\//u, "").replace(/\.md$/u, ""), page))
      },
      {
        text: "Architecture",
        items: pages
          .filter((page) => page.startsWith("architecture/"))
          .map((page) => item(page.replace(/^architecture\//u, "").replace(/\.md$/u, ""), page))
      }
    ],
    socialLinks: []
  }
});
