// WATS-110 — npm scope governance + provenance hardening.
//
// This test pins the repo-side half of WATS-110: the maintainer runbook, the
// `.npmrc.example` template, and the gated provenance-publish workflow. The
// human/org half (2FA enforced org-side, npm OIDC trust configured, real
// provenance attestation verified on a published tarball) is out of scope for
// the repository and must NOT be faked. See maintainers/npm-publishing.md
// "Acceptance and human blockers".

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "packages"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Could not locate repo root from ${startDir}`);
    current = parent;
  }
}

const repoRoot = findRepoRoot(import.meta.dir);

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function expectAll(text: string, needles: readonly string[], label: string): void {
  for (const needle of needles) expect(text, `${label} missing ${needle}`).toContain(needle);
}

function workflowFiles(): string[] {
  const dir = join(repoRoot, ".github", "workflows");
  return readdirSync(dir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
}

describe("WATS-110 npm scope governance and provenance hardening", () => {
  test("maintainer runbook covers scope governance, 2FA, revocation, provenance, OIDC, partial-publish recovery, deprecate/unpublish", () => {
    const doc = read("maintainers/npm-publishing.md");
    expectAll(doc, [
      "WATS-110",
      "@wats/*",
      "PUBLISHABLE_PACKAGES",
      "Require two-factor",
      "auth-and-writes",
      "Revoking publisher access",
      "npm publish --provenance --access public",
      "id-token: write",
      "npm-publish",
      "Sigstore",
      "Partial-publish recovery",
      "Deprecate and unpublish",
      "npm deprecate",
      "npm unpublish",
      "Verifying provenance",
      "dist.attestations",
      "Acceptance and human blockers",
      "Human-blocked"
    ], "npm publishing runbook");

    // The runbook must not claim org-level 2FA / OIDC trust / verified
    // provenance are already done — those are human-blocked.
    expect(doc).not.toMatch(/2FA has been enforced on the npm org|OIDC trust is configured|provenance attestation verified on/iu);
    // No credential-looking values.
    expect(doc).not.toMatch(/access[_-]?token\s*[:=]\s*['"][A-Za-z0-9_-]{12,}|app[_-]?secret\s*[:=]\s*['"][A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9_.-]{12,}/iu);
  });

  test(".npmrc.example documents provenance, web auth, OIDC, and forbids committed tokens", () => {
    const rc = read(".npmrc.example");
    expectAll(rc, [
      "provenance=true",
      "auth-type=web",
      "id-token: write",
      "OIDC",
      "NPM_TOKEN"
    ], ".npmrc.example");
    // The example must not contain a real token line. A commented fallback
    // referencing ${NPM_TOKEN} as an env expansion is allowed; a literal token
    // is not.
    expect(rc).not.toMatch(/_authToken\s*=\s*[A-Za-z0-9_-]{12,}/u);
    expect(rc).not.toMatch(/always-auth\s*=\s*true\s*\n\s*_authToken\s*=\s*\S/u);
  });

  test("release.yml is a manual-dispatch, OIDC-enabled provenance publish workflow gated behind the npm-publish environment", () => {
    const wf = read(".github/workflows/release.yml");
    expectAll(wf, [
      "name: Release (npm publish with provenance)",
      "workflow_dispatch:",
      "id-token: write",
      "contents: read",
      "environment:",
      "name: npm-publish",
      "npm publish --provenance --access public",
      "check-publish",
      "build:packages",
      "Verify manual dispatch runs from main",
      "GITHUB_REF_NAME",
      "dist.attestations"
    ], "release.yml");
    // Manual dispatch only — no automatic triggers.
    for (const forbidden of ["push:", "pull_request:", "schedule:", "workflow_call:"]) {
      expect(wf, `release.yml must not auto-trigger on ${forbidden}`).not.toContain(forbidden);
    }
    // Persist-credentials must be false on checkout, and trusted publishing
    // should not rely on a pre-publish npm whoami probe.
    expect(wf).toContain("persist-credentials: false");
    expect(wf).not.toContain("npm whoami");
  });

  test("credential-free workflows never perform npm publish", () => {
    // Only release.yml is permitted to publish. The dry-run and CI workflows
    // must remain credential-free.
    const credFree = ["ci.yml", "codeql.yml", "release-dry-run.yml"];
    for (const name of credFree) {
      const wf = read(`.github/workflows/${name}`);
      expect(wf, `${name} must not run npm publish`).not.toMatch(/npm\s+publish(\s|$)/u);
      expect(wf, `${name} must not run bun publish`).not.toMatch(/bun\s+publish(\s|$)/u);
    }
  });

  test("exactly one workflow file is permitted to publish, and it is release.yml", () => {
    const publishing = workflowFiles().filter((name) => {
      const wf = read(`.github/workflows/${name}`);
      return /npm\s+publish(\s|$)/u.test(wf) || /bun\s+publish(\s|$)/u.test(wf);
    });
    expect(publishing).toEqual(["release.yml"]);
  });

  test("maintainer npm-publishing doc is excluded from the public docs surface", () => {
    // Maintainer docs live at repo-root maintainers/, never under site/content/docs.
    expect(existsSync(join(repoRoot, "maintainers/npm-publishing.md"))).toBe(true);
    expect(existsSync(join(repoRoot, "site/content/docs/maintainers"))).toBe(false);
  });

  test("npm-publishing runbook does not claim human-blocked acceptance is complete", () => {
    const doc = read("maintainers/npm-publishing.md");
    // Org-level 2FA enforcement, npm OIDC trust configuration, and a verified
    // real-tarball provenance attestation are human/npm-org actions. The
    // runbook must not assert they are already done.
    expect(doc).not.toMatch(/2FA has been enforced on the npm org|OIDC trust is configured|provenance attestation verified on/iu);
    // The changelog convention for post-tag work (cf. WATS-141/124/123) is to
    // add the entry in the next release PR, not under the already-tagged
    // 0.3.26 heading. So this slice does not add a changelog entry; verify the
    // top heading stays the tagged release.
    const changelog = read("CHANGELOG.md");
    expect(changelog.startsWith("# Changelog\n\n## [0.3.26]")).toBe(true);
  });
});
