import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);
  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string; private?: boolean };
      if (manifest.name === "wats" && manifest.private === true) return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate WATS workspace root from ${startDir}`);
    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("WATS-101 live serve and HTTPS tunnel onboarding docs", () => {
  test("live webhook guide gives a short ngrok-style live testing path", () => {
    // The live-testing path moved from cli-init.mdx into the dedicated
    // live-webhook guide during the onboarding IA split. Guard the substance
    // there; cli-init keeps the setup wizard and dry-run serve.
    const liveWebhook = read("site/content/docs/guides/live-webhook.mdx");
    const cliGuide = read("site/content/docs/guides/cli-init.mdx");
    // Voice-pass reworded "Meta requires a public HTTPS webhook URL" →
    // "Meta needs a public HTTPS callback"; the public-HTTPS requirement survives.
    expect(liveWebhook).toMatch(/Meta (?:requires|needs) a public HTTPS (?:webhook URL|callback)/u);
    expect(liveWebhook).toContain("ngrok http 8787");
    expect(liveWebhook).toContain("wats serve --config wats.config.yaml --live --yes-live --env-file .env.local");
    expect(liveWebhook).toContain("wats onboarding --public-url https://example.test");
    // The setup-command path survives in the CLI onboarding guide.
    expect(cliGuide).toContain("wats setup");
    expect(liveWebhook).not.toMatch(/wats serve.*production-ready/iu);
  });

  test("CLI reference and live webhook guide describe live serve without making production claims", () => {
    const cliReference = read("site/content/docs/reference/cli.mdx");
    const liveWebhook = read("site/content/docs/guides/live-webhook.mdx");
    const serviceReference = read("site/content/docs/reference/service.mdx");

    for (const text of [cliReference, liveWebhook]) {
      expect(text).toContain("--env-file .env.local");
      expect(text).toContain("--live --yes-live");
      expect(text).toContain("ngrok http 8787");
      expect(text).toContain("secure HTTPS tunnel");
      // Voice-pass kept the explicit-env-file contract but phrases it two ways:
      // live-webhook.mdx "does not read `.env.local` implicitly", cli.mdx "nothing
      // is read implicitly". Match the surviving "...read ... implicitly" intent.
      expect(text).toMatch(/(?:does not read[^.]*\.env\.local|nothing is read)[^.]*implicitly/u);
    }

    // Voice-pass dropped the "still" qualifier: now "`@wats/service` does not
    // read environment variables". Fact (service never reads env) survives.
    expect(serviceReference).toContain("`@wats/service` does not read environment variables");
    expect(serviceReference).toContain("The CLI live wrapper resolves env-secret refs");
    expect(serviceReference).not.toContain("credential-gated live `wats serve` execution and env-file secret resolution");
  });

  test("changelog records WATS-101 live testing serve support and boundaries", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog).toContain("WATS-101");
    expect(changelog).toContain("credential-gated live `wats serve`");
    expect(changelog).toContain("--live --yes-live --env-file .env.local");
    expect(changelog).toContain("ngrok or equivalent HTTPS tunnel");
    expect(changelog).toContain("No Docker image publication, background outbox worker, or production-hosting guarantee is included");
  });
});
