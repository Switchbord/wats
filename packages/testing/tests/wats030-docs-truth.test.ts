// WATS 0.3.0 public docs truth contract.

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

describe("WATS 0.3.3 public docs truth contract", () => {
  test("README announces the 0.3.3 alpha compatibility release without stale publication wording", () => {
    const readme = read("README.md");
    expect(readme).toContain("Current release: `0.3.3-alpha-compatibility`");
    expect(readme).toContain("alpha compatibility and community-governance patch release");
    expect(readme).toContain("bunx --bun @wats/cli setup");
    expect(readme).toContain("bunx --bun @wats/cli --help");
    expect(readme).not.toContain("bunx --bun wats setup");
    expect(readme).not.toContain("bunx --bun wats --help");
    expect(readme).toContain("`wats setup` writes a safe `wats.config.yaml`");
    expect(readme).toContain("live serve mode, env-file secret resolution, Docker image publication, persistence/outbox, and live Meta validation are not included");

    expect(readme).not.toContain("After the alpha packages are published");
  });

  test("changelog has a top 0.3.3 section and keeps release side-effect boundaries honest", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog.startsWith("# Changelog\n\n## [0.3.3]")).toBe(true);
    expect(changelog).toContain("### WATS-108 — community governance files");
    expect(changelog).toContain("canonical `@wats/*` package scope");
    expect(changelog).toContain("### WATS-98 — Marketing Messages API compatibility surfaces");
    expect(changelog).toContain("Release metadata is aligned for 0.3.3");
    expect(changelog).toContain("No live Meta calls, token validation against Meta, credential collection");
    expect(changelog).toContain("No live Meta validation campaign execution");
    expect(changelog).not.toContain("No GitHub release/tag creation until the public repository is pushed and reviewed");
  });

  test("migration guide no longer lists implemented operator tooling as a gap", () => {
    const migration = read("docs/migration/pywa-to-wats.md");
    expect(migration).not.toContain("full Meta Graph OpenAPI generation, CLI `serve`, CLI `init`, and deeper `doctor` diagnostics");
    expect(migration).toContain("full Meta Graph OpenAPI generation and live/production operator modes beyond the current credential-free `wats init`, `wats doctor`, and dry-run `wats serve` tooling");
  });

  test("community examples point users at current CLI tooling while preserving live/deploy non-goals", () => {
    const guide = read("docs/guides/community-examples.md");
    expect(guide).toContain("Current WATS now implements safe local `wats init` config/env placeholder generation, real offline `wats doctor` diagnostics, and dry-run `wats serve`");
    expect(guide).toContain("credential-gated live serve mode, live Meta validation, Dockerfiles, Compose files, release automation, image publication, and a full community gallery remain outside this scaffold");
    expect(guide).not.toContain("This WATS-52A scaffold predates WATS-69/WATS-70/WATS-71.");
  });

  test("CLI docs explain hidden setup secret prompts before users paste credentials", () => {
    const cliReference = read("docs/reference/cli.md");
    const cliGuide = read("docs/guides/cli-init.md");
    expect(cliReference).toContain("access-token and app-secret prompts state `Input hidden` before reading");
    expect(cliReference).toContain("optional secret-token prompts state they can be left blank to generate local values");
    expect(cliGuide).toContain("Secret prompts display an `Input hidden` hint before reading so pasted tokens and app secrets intentionally do not echo.");
  });

  test("CLI guide lists implemented onboarding command and keeps first-run examples executable", () => {
    const cliGuide = read("docs/guides/cli-init.md");
    expect(cliGuide).toContain("wats onboarding --public-url <https URL>");
    expect(cliGuide).toContain("wats onboarding --public-url https://example.test/wats");
    expect(cliGuide).toContain("wats onboarding --public-url https://example.test --webhook-path /webhooks/whatsapp");
    expect(cliGuide).not.toContain("wats init --yes");
  });

  test("release policy documents why private @wats/testing does not follow the public package version line", () => {
    const releasePolicy = read("docs/architecture/release-policy.md");
    const testingReadme = read("packages/testing/README.md");
    expect(releasePolicy).toContain("`@wats/testing` is private and intentionally follows its own workspace-only version line");
    expect(releasePolicy).toContain("packages/testing/tests/wats030-release-contract.test.ts");
    expect(testingReadme).toContain("@wats/testing version policy");
    expect(testingReadme).toContain("private workspace package");
  });

  test("privacy stance is linked from README and SECURITY and forbids default maintainer telemetry", () => {
    const privacy = read("docs/privacy.md");
    const readme = read("README.md");
    const security = read("SECURITY.md");
    expect(privacy).toContain("WATS sends no telemetry to any maintainer-owned endpoint by default");
    expect(privacy).toContain("Future telemetry, if ever added, will be opt-in and documented");
    expect(privacy).toContain("The CLI does not phone home");
    expect(readme).toContain("docs/privacy.md");
    expect(security).toContain("docs/privacy.md");
  });
});
