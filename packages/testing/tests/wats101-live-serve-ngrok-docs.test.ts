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
    const gettingStarted = read("docs/getting-started.md");
    expect(gettingStarted).toContain("Meta requires a public HTTPS webhook URL");
    expect(gettingStarted).toContain("ngrok http 8787");
    expect(gettingStarted).toContain("wats serve --config wats.config.yaml --live --yes-live --env-file .env.local");
    expect(gettingStarted).toContain("wats onboarding --public-url https://<your-tunnel-host>");
    expect(gettingStarted).toContain("bunx --bun @wats/cli setup");
    expect(gettingStarted).not.toMatch(/wats serve.*production-ready/iu);
  });

  test("CLI and service docs describe live serve without making production claims", () => {
    const cliReference = read("docs/reference/cli.md");
    const cliGuide = read("docs/guides/cli-init.md");
    const serviceReference = read("docs/reference/service.md");

    for (const text of [cliReference, cliGuide]) {
      expect(text).toContain("--env-file .env.local");
      expect(text).toContain("--live --yes-live");
      expect(text).toContain("ngrok http 8787");
      expect(text).toContain("secure HTTPS tunnel");
      expect(text).toContain("does not read `.env.local` implicitly");
    }

    expect(serviceReference).toContain("`@wats/service` still does not read environment variables");
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
