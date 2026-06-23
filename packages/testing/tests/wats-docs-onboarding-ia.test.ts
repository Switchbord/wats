// Docs-lock: onboarding IA + live-webhook split (Tranche 2).
// Pins the new-operator path: home exposes the real route set, the guide stub
// is demoted out of "Start here" nav, the guides nav order puts live-webhook
// before deploy pages with deploy-docker last, the live-webhook page carries
// the live-serve + public-HTTPS-callback + placeholder-env substance, and
// cli-init no longer carries the full live checklist block.

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

describe("WATS docs onboarding IA + live-webhook split", () => {
  test("docs home links the real onboarding path: quickstart, cli-init, live-webhook", () => {
    const home = read("site/content/docs/index.mdx");
    expect(home).toContain("/docs/quickstart");
    expect(home).toContain("/docs/guides/cli-init");
    expect(home).toContain("/docs/guides/live-webhook");
    // The stub guide is no longer the home's "end-to-end walkthrough" link.
    expect(home).not.toMatch(/\[Guide\]\(\/docs\/guide\)/u);
  });

  test("Start here nav no longer routes users to the guide stub", () => {
    const meta = readJson<{ pages: string[] }>("site/content/docs/meta.json");
    const pages = meta.pages;
    const startIdx = pages.indexOf("---Start here---");
    expect(startIdx, "Start here separator must exist").toBeGreaterThan(-1);
    // Collect pages until the next separator (or end).
    const startHere: string[] = [];
    for (let i = startIdx + 1; i < pages.length; i++) {
      const entry = pages[i]!;
      if (entry.startsWith("---") && entry.endsWith("---")) break;
      startHere.push(entry);
    }
    expect(startHere).not.toContain("guide");
  });

  test("guides nav order: live-webhook before deploy pages, deploy-docker last", () => {
    const meta = readJson<{ pages: string[] }>("site/content/docs/guides/meta.json");
    const pages = meta.pages;
    expect(pages).toContain("cli-init");
    expect(pages).toContain("live-webhook");
    const liveIdx = pages.indexOf("live-webhook");
    // live-webhook comes before every deploy page.
    for (const deploy of ["deploy-bun", "deploy-node", "deploy-cloudflare-workers", "deploy-docker"]) {
      expect(pages.indexOf(deploy), `${deploy} should come after live-webhook`).toBeGreaterThan(liveIdx);
    }
    // deploy-docker (planned) is last.
    expect(pages[pages.length - 1]).toBe("deploy-docker");
  });

  test("live-webhook page carries live-serve, public HTTPS callback, ngrok, and placeholder-only env", () => {
    const page = read("site/content/docs/guides/live-webhook.mdx");
    expect(page).toContain("wats serve --config wats.config.yaml --live --yes-live --env-file .env.local");
    // Public HTTPS callback truth (Meta requires/needs a public HTTPS callback).
    expect(page).toMatch(/Meta (?:requires|needs) a public HTTPS (?:webhook URL|callback)/u);
    // ngrok or equivalent HTTPS tunnel.
    expect(page).toContain("ngrok http 8787");
    expect(page).toContain("HTTPS tunnel");
    // Webhook onboarding checklist substance.
    expect(page).toContain("wats onboarding --public-url https://example.test");
    expect(page).toContain("WATS_VERIFY_TOKEN");
    expect(page).toContain("WATS_SERVICE_TOKEN");
    // Placeholder-only env examples: the four secret keys carry *** placeholders,
    // never real-looking token values.
    expect(page).toContain("WATS_ACCESS_TOKEN=***");
    expect(page).toContain("WATS_APP_SECRET=***");
    expect(page).not.toMatch(/\bEAA[A-Za-z0-9_-]{20,}\b/u);
  });

  test("cli-init no longer carries the full live checklist block", () => {
    const cli = read("site/content/docs/guides/cli-init.mdx");
    // The dedicated live-webhook guide owns the onboarding checklist heading.
    expect(cli).not.toContain("## Webhook onboarding checklist");
    // The full live serve command moved out; cli-init keeps dry-run serve only.
    expect(cli).not.toContain("wats serve --config wats.config.yaml --live --yes-live --env-file .env.local");
    expect(cli).not.toContain("ngrok http 8787");
    // cli-init still owns init/setup/validate/doctor/dry-run serve.
    expect(cli).toContain("wats init");
    expect(cli).toContain("wats setup");
    expect(cli).toContain("wats doctor");
    expect(cli).toContain("--dry-run");
    // It points readers at the live-webhook guide.
    expect(cli).toContain("/docs/guides/live-webhook");
  });
});
