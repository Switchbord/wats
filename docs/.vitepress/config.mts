import { defineConfig } from "vitepress";
import manifest from "../public-docs-manifest.json" with { type: "json" };

const pages = manifest.pages as string[];

function link(path: string): string {
  const withoutMd = path.replace(/\.md$/u, "");
  return withoutMd === "index" ? "/" : `/${withoutMd}`;
}

function item(text: string, page: string) {
  return { text, link: link(page) };
}

export default defineConfig({
  title: "WATS",
  description: "Bun-first TypeScript WhatsApp Cloud API toolkit inspired by pywa.",
  cleanUrls: true,
  ignoreDeadLinks: false,
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
        items: pages.filter((page) => page.startsWith("reference/")).map((page) => item(page.replace(/^reference\//u, "").replace(/\.md$/u, ""), page))
      },
      { text: "API", items: [item("Package API", "api/index.md"), item("OpenAPI UI", "reference/openapi-ui.md")] },
      {
        text: "Guides",
        items: pages.filter((page) => page.startsWith("guides/")).map((page) => item(page.replace(/^guides\//u, "").replace(/\.md$/u, ""), page))
      },
      {
        text: "Architecture",
        items: pages.filter((page) => page.startsWith("architecture/")).map((page) => item(page.replace(/^architecture\//u, "").replace(/\.md$/u, ""), page))
      }
    ],
    socialLinks: []
  }
});
