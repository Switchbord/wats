// WATS-49 RED — Docker/deployment scaffold design docs lock.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not find repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectAll(text: string, snippets: readonly string[]): void {
  for (const snippet of snippets) {
    expect(text).toContain(snippet);
  }
}

describe("WATS-49 Docker/deployment scaffold design docs", () => {
  test("design doc records Docker/deployment contract and safety boundaries", () => {
    const design = read("docs/architecture/wats49-docker-deployment-design.md");

    expectAll(design, [
      "status: design",
      "applies-to: WATS-49",
      "ADR-007",
      "Linear remains the source of truth",
      "no second repository",
      "design/docs/test-planner only",
      "`wats serve`",
      "implemented serve contract",
      "no root Dockerfile",
      "no compose.yaml",
      "/healthz",
      "/readyz",
      "/openapi.json",
      "non-root runtime",
      "explicit port",
      "SIGTERM",
      "graceful shutdown",
      "no secrets baked into images",
      "no live Meta calls",
      "no image publication",
      "no registry credentials",
      "no release automation"
    ]);
  });

  test("Docker deployment guide is public scaffold without claiming runnable artifact", () => {
    const guide = read("docs/guides/deploy-docker.md");

    expectAll(guide, [
      "status: design/scaffold",
      "applies-to: WATS-49",
      "Current implementation status",
      "`wats serve` is not implemented yet",
      "no supported root Dockerfile",
      "no supported Compose file",
      "future Dockerfile shape",
      "future compose.yaml shape",
      "env-secret references",
      "do not commit `.env`",
      "healthcheck",
      "/healthz",
      "/readyz",
      "non-root",
      "no live Meta calls during build"
    ]);

    expect(guide).not.toContain("production-ready image");
    expect(guide).not.toContain("published image");
    expect(guide).not.toContain("docker pull");
    expect(guide).not.toContain("EAA");
  });

  test("service, CLI, and public surface keep implementation boundary explicit", () => {
    const service = read("docs/reference/service.md");
    const cli = read("docs/reference/cli.md");
    const publicSurface = read("docs/architecture/public-api-surface.md");

    expectAll(service, [
      "WATS-49",
      "no supported Dockerfile/Compose/container image yet",
      "current @wats/service has no process wrapper/Docker integration",
      "no image publication",
      "no registry credentials"
    ]);

    expectAll(cli, [
      "WATS-49",
      "Docker packaging must target implemented `wats serve`",
      "current CLI does not start a server process"
    ]);

    expectAll(publicSurface, [
      "no supported Dockerfile, Compose file, container image, or container-registry publication yet",
      "WATS-49"
    ]);
  });

  test("alpha plan and release policy classify WATS-49 correctly", () => {
    const plan = read("docs/architecture/alpha-cli-runtime-operations-plan.md");
    const releasePolicy = read("docs/architecture/release-policy.md");

    expectAll(plan, [
      "docs/architecture/wats49-docker-deployment-design.md",
      "docs/guides/deploy-docker.md",
      "WATS-49 docs-lock coverage",
      "container/deploy smoke checks that do not require credentials",
      "no image publication, registry credentials, or release automation",
      "design/docs/test-planner only",
      "must not precede the real `wats serve` process contract"
    ]);

    expectAll(releasePolicy, [
      "WATS-49 Docker/deployment design scaffold",
      "design/docs/test-planner only",
      "patch-class",
      "Implemented Dockerfile",
      "compose.yaml",
      "container health checks",
      "published image",
      "container-registry credentials",
      "minor changes on `0.x`"
    ]);
  });

  test("public manifest, reference index, roadmap, and changelog include WATS-49 artifacts", () => {
    const manifest = read("docs/public-docs-manifest.json");
    const referenceIndex = read("docs/reference/index.md");
    const roadmap = read("docs/architecture/roadmap-to-whatsapp-pywa-parity.md");
    const changelog = read("CHANGELOG.md");

    expectAll(manifest, [
      "guides/deploy-docker.md",
      "architecture/wats49-docker-deployment-design.md"
    ]);

    expectAll(referenceIndex, [
      "guides/deploy-docker.md",
      "WATS-49"
    ]);

    expectAll(roadmap, [
      "WATS-49",
      "Docker/deployment design scaffold",
      "no runtime Docker artifact/image publication in the design slice"
    ]);

    expectAll(changelog, [
      "WATS-49 — Docker/deployment design scaffold",
      "no root Dockerfile/Compose",
      "no live Meta calls",
      "no second repository"
    ]);
  });

  test("WATS-49 design slice does not add supported container artifacts", () => {
    expect(existsSync(join(repoRoot, "Dockerfile"))).toBe(false);
    expect(existsSync(join(repoRoot, "docker-compose.yml"))).toBe(false);
    expect(existsSync(join(repoRoot, "compose.yaml"))).toBe(false);
  });
});
