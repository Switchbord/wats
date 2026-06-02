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

describe("WATS 0.3.19 public docs truth contract", () => {
  test("README announces the 0.3.19 alpha compatibility release without stale publication wording", () => {
    const readme = read("README.md");
    expect(readme).toContain("Current release: `0.3.19-alpha-compatibility`");
    expect(readme).toContain("alpha compatibility and local-operator patch release");
    expect(readme).toContain("bunx --bun @wats/cli setup");
    expect(readme).toContain("bunx --bun @wats/cli --help");
    expect(readme).toContain("bunx --bun @wats/cli --version");
    expect(readme).toContain("bunx --bun @wats/cli upgrade --dry-run");
    expect(readme).not.toContain("bunx --bun wats setup");
    expect(readme).not.toContain("bunx --bun wats --help");
    expect(readme).toContain("`wats setup` writes a safe `wats.config.yaml`");
    expect(readme).toContain("Live serve requires explicit `--live --yes-live --env-file .env.local`");
    expect(readme).toContain("background outbox workers, production hosting, token validation against Meta, and multi-profile credential editing are not included");

    expect(readme).not.toContain("After the alpha packages are published");
  });

  test("changelog has a top 0.3.19 section and keeps release side-effect boundaries honest", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog.startsWith("# Changelog\n\n## [0.3.19]")).toBe(true);
    expect(changelog).toContain("### WATS-108 — community governance files");
    expect(changelog).toContain("canonical `@wats/*` package scope");
    expect(changelog).toContain("### WATS-98 — Marketing Messages API compatibility surfaces");
    expect(changelog).toContain("Release metadata is aligned for 0.3.19");
    expect(changelog).toContain("credential-gated live `wats serve`");
    expect(changelog).toContain("### WATS-126 — CLI version and package upgrades");
    expect(changelog).toContain("Adds `wats --version`");
    expect(changelog).toContain("No automatic live Meta validation campaign execution, token validation against Meta, credential collection");
    expect(changelog).not.toContain("No GitHub release/tag creation until the public repository is pushed and reviewed");
  });

  test("migration guide no longer lists implemented operator tooling as a gap", () => {
    const migration = read("docs/migration/pywa-to-wats.md");
    expect(migration).not.toContain("full Meta Graph OpenAPI generation, CLI `serve`, CLI `init`, and deeper `doctor` diagnostics");
    expect(migration).toContain("full Meta Graph OpenAPI generation and production operator modes beyond the current credential-free `wats init`, `wats doctor`, dry-run `wats serve`, and credential-gated local live `wats serve` tooling");
  });

  test("community examples point users at current CLI tooling while preserving live/deploy non-goals", () => {
    const guide = read("docs/guides/community-examples.md");
    expect(guide).toContain("Current WATS now implements safe local `wats init` config/env placeholder generation, real offline `wats doctor` diagnostics, dry-run `wats serve`");
    expect(guide).toContain("credential-gated local live `wats serve` for webhook/Graph smoke testing behind a secure HTTPS tunnel");
    expect(guide).toContain("Dockerfiles, Compose files, release automation, image publication, production hosting, and a full community gallery remain outside this scaffold");
    expect(guide).not.toContain("This WATS-52A scaffold predates WATS-69/WATS-70/WATS-71.");
  });

  test("CLI docs explain hidden setup secret prompts before users paste credentials", () => {
    const cliReference = read("docs/reference/cli.md");
    const cliGuide = read("docs/guides/cli-init.md");
    expect(cliReference).toContain("access-token and app-secret prompts state `Input hidden` before reading");
    expect(cliReference).toContain("optional secret-token prompts state they can be left blank to generate local values");
    expect(cliReference).toContain("### `wats upgrade [--dry-run]`");
    expect(cliReference).toContain("bun update --latest @wats/cli @wats/core @wats/graph @wats/http @wats/config @wats/service");
    expect(cliGuide).toContain("Secret prompts display an `Input hidden` hint before reading so pasted tokens and app secrets intentionally do not echo.");
    expect(cliGuide).toContain("wats --version");
    expect(cliGuide).toContain("wats upgrade --dry-run");
  });

  test("CLI guide lists implemented onboarding command and keeps first-run examples executable", () => {
    const cliGuide = read("docs/guides/cli-init.md");
    expect(cliGuide).toContain("wats onboarding --public-url <https URL>");
    expect(cliGuide).toContain("wats onboarding --public-url https://example.test/wats");
    expect(cliGuide).toContain("wats onboarding --public-url https://example.test --webhook-path /webhooks/whatsapp");
    const commandBlocks = Array.from(cliGuide.matchAll(/```bash\n([\s\S]*?)```/gu)).map((match) => match[1] ?? "").join("\n");
    expect(commandBlocks).not.toContain("wats init --yes");
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

  test("public API stability policy classifies stable experimental and internal surfaces", () => {
    const stability = read("docs/api-stability.md");
    const manifest = read("docs/public-docs-manifest.json");
    const graphCalling = read("packages/graph/src/endpoints/calling.ts");
    const graphFlows = read("packages/graph/src/endpoints/flows.ts");
    const graphWabaEndpoints = read("packages/graph/src/endpoints/wabaEndpoints.ts");
    expect(stability).toContain("Stable-for-0.x surfaces");
    expect(stability).toContain("Experimental surfaces");
    expect(stability).toContain("Internal and unsupported surfaces");
    expect(stability).toContain("@experimental");
    expect(stability).toContain("Flow DSL and data-channel helpers");
    expect(stability).toContain("Calling endpoint helpers");
    expect(stability).toContain("`@wats/internal-utils` is published internal support");
    expect(manifest).toContain("api-stability.md");
    expect(graphCalling).toContain("@experimental Calling endpoint helpers");
    expect(graphFlows).toContain("@experimental Flow DSL and data-channel helpers");
    expect(graphWabaEndpoints).toContain("@experimental Flow DSL and data-channel helpers");
  });
});
