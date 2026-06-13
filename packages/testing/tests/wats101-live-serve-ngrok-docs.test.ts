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
  test("getting started gives a short ngrok-style live testing path", () => {
    // The old getting-started.md mapped to guide.mdx, but guide.mdx is now a
    // landing stub that links onward; the ngrok-style live-testing path it used
    // to carry was relocated into the CLI onboarding guide it points at. Read
    // that guide so the test still guards the live-testing path's substance.
    const gettingStarted = read("site/content/docs/guides/cli-init.mdx");
    // Voice-pass reworded "Meta requires a public HTTPS webhook URL" →
    // "Meta needs a public HTTPS callback"; the public-HTTPS requirement survives.
    expect(gettingStarted).toMatch(/Meta (?:requires|needs) a public HTTPS (?:webhook URL|callback)/u);
    expect(gettingStarted).toContain("ngrok http 8787");
    expect(gettingStarted).toContain("wats serve --config wats.config.yaml --live --yes-live --env-file .env.local");
    expect(gettingStarted).toContain("wats onboarding --public-url https://<your-tunnel-host>");
    // Voice-pass replaced the "bunx --bun @wats/cli setup" install incantation
    // with the `wats setup` guided wizard; the setup-command path survives.
    expect(gettingStarted).toContain("wats setup");
    expect(gettingStarted).not.toMatch(/wats serve.*production-ready/iu);
  });

  test("CLI and service docs describe live serve without making production claims", () => {
    const cliReference = read("site/content/docs/reference/cli.mdx");
    const cliGuide = read("site/content/docs/guides/cli-init.mdx");
    const serviceReference = read("site/content/docs/reference/service.mdx");

    for (const text of [cliReference, cliGuide]) {
      expect(text).toContain("--env-file .env.local");
      expect(text).toContain("--live --yes-live");
      expect(text).toContain("ngrok http 8787");
      expect(text).toContain("secure HTTPS tunnel");
      // Voice-pass kept the explicit-env-file contract but phrases it two ways:
      // cli-init.mdx "does not read `.env.local` implicitly", cli.mdx "nothing
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
