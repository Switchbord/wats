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

describe("WATS 0.3.29 public docs truth contract", () => {
  test("README announces the alpha release and credential-safe install path without stale publication wording", () => {
    const readme = read("README.md");
    expect(readme).toContain("Alpha");
    expect(readme).toContain("bunx --bun @wats/cli setup");
    expect(readme).not.toContain("bunx --bun wats setup");
    expect(readme).not.toContain("bunx --bun wats --help");
    expect(readme).toContain("writes wats.config.yaml");
    expect(readme).toContain("Live serving requires");
    expect(readme).toContain("--live --yes-live --env-file .env.local");
    expect(readme).toContain("WATS never reads secrets");
    expect(readme).not.toContain("After the alpha packages are published");
  });

  test("changelog has a top 0.3.29 section and keeps release side-effect boundaries honest", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog.startsWith("# Changelog\n\n## [0.3.29]")).toBe(true);
    expect(changelog).toContain("### WATS-108 — community governance files");
    expect(changelog).toContain("canonical `@wats/*` package scope");
    expect(changelog).toContain("### WATS-98 — Marketing Messages API compatibility surfaces");
    expect(changelog).toContain("Release metadata is aligned for 0.3.29");
    expect(changelog).toContain("credential-gated live `wats serve`");
    expect(changelog).toContain("### WATS-126 — CLI version and package upgrades");
    expect(changelog).toContain("Adds `wats --version`");
    expect(changelog).toContain("No automatic live Meta validation campaign execution, token validation against Meta, credential collection");
    expect(changelog).not.toContain("No GitHub release/tag creation until the public repository is pushed and reviewed");
  });

  test("migration guide no longer lists implemented operator tooling as a gap", () => {
    const migration = read("site/content/docs/migration/pywa.mdx");
    expect(migration).not.toContain("full Meta Graph OpenAPI generation, CLI `serve`, CLI `init`, and deeper `doctor` diagnostics");
    expect(migration).toContain("full Meta Graph OpenAPI generation and production operator modes beyond the current credential-free `wats init`, `wats doctor`, dry-run `wats serve`, and credential-gated local live `wats serve` tooling");
  });

  test("community examples point users at current CLI tooling while preserving live/deploy non-goals", () => {
    const guide = read("site/content/docs/guides/community-examples.mdx");
    expect(guide).toContain("offline");
    expect(guide).toContain("MockTransport");
    expect(guide).toContain("Dockerfiles, Compose files, release automation, image publication, production");
    expect(guide).toContain("hosting, and a full community gallery remain outside this set");
    // voice pass removed ticket archaeology from public docs
    expect(guide).not.toContain("WATS-52A");
    expect(guide).not.toContain("WATS-69");
  });

  test("CLI docs explain hidden setup secret prompts before users paste credentials", () => {
    const cliReference = read("site/content/docs/reference/cli.mdx");
    const cliGuide = read("site/content/docs/guides/cli-init.mdx");
    expect(cliReference).toContain("prompts state `Input hidden` before reading");
    expect(cliReference).toContain("Raw tokens never land in YAML");
    expect(cliReference).toContain("wats upgrade");
    expect(cliGuide).toContain("Secret prompts display an `Input hidden` hint");
    expect(cliGuide).toContain("wats --version");
    expect(cliGuide).toContain("wats upgrade --dry-run");
  });

  test("CLI guide lists implemented onboarding command and keeps first-run examples executable", () => {
    const cliGuide = read("site/content/docs/guides/cli-init.mdx");
    expect(cliGuide).toContain("wats onboarding --public-url <https URL>");
    expect(cliGuide).toContain("wats onboarding --public-url <https URL> --webhook-path /webhooks/whatsapp");
    const commandBlocks = Array.from(cliGuide.matchAll(/```bash\n([\s\S]*?)```/gu)).map((match) => match[1] ?? "").join("\n");
    expect(commandBlocks).not.toContain("wats init --yes");
  });

  test("release policy documents why private @wats/testing does not follow the public package version line", () => {
    const releasePolicy = read("site/content/docs/meta/release-policy.mdx");
    const testingReadme = read("packages/testing/README.md");
    expect(releasePolicy).toContain("`@wats/testing` is workspace-only and intentionally outside the public package version-alignment contract");
    // ticket-traceability of the enforcing test lives in the package README, not the voice-governed site doc
    expect(testingReadme).toContain("packages/testing/tests/wats030-release-contract.test.ts");
    expect(testingReadme).toContain("@wats/testing version policy");
    expect(testingReadme).toContain("private workspace package");
  });

  test("privacy stance is linked from README and SECURITY and forbids default maintainer telemetry", () => {
    const privacy = read("site/content/docs/meta/privacy.mdx");
    const readme = read("README.md");
    const security = read("SECURITY.md");
    expect(privacy).toContain("No analytics, no telemetry, no maintainer-owned endpoint");
    expect(privacy).toContain("Future telemetry, if ever added, will be opt-in and documented");
    expect(privacy).toContain("The CLI does not phone home");
    expect(readme).toContain("wats.sh/docs/meta/privacy");
    expect(security).toContain("wats.sh/docs/meta/privacy");
  });

  test("public API stability policy classifies stable experimental and internal surfaces", () => {
    const stability = read("site/content/docs/meta/api-stability.mdx");
    const manifest = read("site/public-pages-manifest.json");
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
    expect(manifest).toContain("/docs/meta/api-stability");
    expect(graphCalling).toContain("@experimental Calling endpoint helpers");
    expect(graphFlows).toContain("@experimental Flow DSL and data-channel helpers");
    expect(graphWabaEndpoints).toContain("@experimental Flow DSL and data-channel helpers");
  });
});
