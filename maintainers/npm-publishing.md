# npm Scope Governance and Publishing Runbook

- status: maintainer-runbook
- applies-to: WATS-110
- publicDocs: excluded because maintainer runbooks live outside `site/content/docs`
- lastReviewed: 2026-06-21

## Purpose

WATS-110 records who may publish packages under the `@wats/*` npm scope, how
provenance is enforced on real releases, how publisher access is revoked, and
how to recover from a partial publish. This is reproducible operator guidance;
committing this file does not by itself mutate npm org membership, enforce 2FA,
configure OIDC trust, or attach a provenance attestation to any published
tarball. Those actions require human/npm-org steps listed below under
"Human-blocked actions".

This runbook is the repo-side half of WATS-110. The acceptance half —
org-level 2FA enforced on every publisher account and a verified Sigstore
provenance attestation on a real published tarball — cannot be completed from
the repository alone and must not be faked. See "Acceptance and human blockers".

## Scope ownership

The npm scope is `@wats`. Public packages published from this repository are
exactly the set enforced by `scripts/release-metadata.ts`
`PUBLISHABLE_PACKAGES`:

- `@wats/types`
- `@wats/crypto`
- `@wats/graph`
- `@wats/core`
- `@wats/http`
- `@wats/internal-utils` (published internal support, not stable application API)
- `@wats/config`
- `@wats/persistence`
- `@wats/service`
- `@wats/cli`

`@wats/testing` is workspace-only and must never be published
(`private: true`, no `files`, no `publishConfig`). The earlier temporary
`@switchbord/*` scope is retired; do not reintroduce it unless the user
explicitly requests a scope migration.

## Publisher roster and 2FA

Who can publish:

- Only npm accounts that are members of the `wats` npm org with the `developer`
  or `admin` role for the `@wats` scope may publish.
- The publisher roster is held out-of-band by the npm org owner (a human). The
  repository does not store npm usernames; record the active publisher set in
  the org's private operator channel, not in this public repo.
- Prefer the smallest viable publisher set. For the alpha line, target two
  publishers (primary + backup). Each must have 2FA enforced.

2FA requirement (human/org action):

- Enforce 2FA at the npm org level: org settings → "Require two-factor
  authentication for all members". This covers every member account, not just
  those who have published before.
- Each publisher account must also have 2FA enabled at the account level
  (account settings → "Two-Factor Authentication": `auth-and-writes`).
- Verify before any release: `npm org ls wats` and per-account 2FA status must
  confirm enforcement. If `npm org ls wats` returns `E403` for a token that can
  still publish owned scoped packages, fall back to `npm access get status
  @wats/cli` and `npm owner ls @wats/cli` to confirm publisher ownership — but
  2FA enforcement must still be verified org-side by a human before the first
  provenance publish.

These 2FA settings are org/account state, not repository state. Committing this
runbook does not enforce them.

## Revoking publisher access

When a publisher must be removed (rotation, offboarding, compromised token):

1. In the npm org UI, remove the account from the `wats` org, or downgrade from
   `developer`/`admin` to `read-only`/no role. This is a human action.
2. If a publisher token was compromised, revoke the token in the account's
   access-tokens page immediately, before or in parallel with org removal.
3. Deprecate or unpublish affected versions if a bad tarball was published
   (see "Deprecate and unpublish").
4. Rotate any GitHub Actions secret named in the publish environment (see
   "OIDC vs long-lived tokens"). With OIDC publishing configured, there is no
   long-lived `NPM_TOKEN` to rotate — removing org membership is sufficient to
   block future publishes.
5. Record the revocation event (date, reason, affected versions) in the private
   operator channel. Do not record npm usernames, emails, or token material in
   this repository.

## Provenance

npm provenance attaches a Sigstore-built, publicly verifiable supply-chain
attestation to each published tarball, binding the tarball to the exact GitHub
workflow run, commit, and build environment that produced it. WATS requires
provenance on every real `@wats/*` publish.

Repo-side provenance readiness (this runbook + `.npmrc.example` +
`.github/workflows/release.yml`):

- `.github/workflows/release.yml` is a manual-dispatch workflow that publishes
  every `PUBLISHABLE_PACKAGES` tarball with `npm publish --provenance --access
  public`, in dependency order, from a clean `dist` build.
- The workflow requires `permissions: id-token: write` (for the Sigstore OIDC
  token) and `contents: read`. It runs in a protected GitHub environment named
  `npm-publish` that maintainers must create (human action) with required
  reviewers and optional deployment-branch restrictions.
- `.npmrc.example` documents `provenance=true` and `auth-type=web` for human
  publishers, and the OIDC (no static token) stance for CI.

Human/org actions required before the first provenance publish:

1. Configure npm OIDC publishing trust between the `wats` npm org and the
   `Switchbord/wats` GitHub repository. In the npm org settings, add a
   "GitHub Actions" deployment integration that trusts
   `Switchbord/wats` and the `npm-publish` environment. This is an npm-org-side
   configuration that cannot be performed from the repo.
2. Create the `npm-publish` GitHub environment (repo settings → Environments)
   with required reviewers (at least one maintainer) and, if desired, branch
   restriction to `main`. This is a GitHub-side human action.
3. With OIDC trust configured, the publish job uses a short-lived installation
   token; do not store a long-lived `NPM_TOKEN` secret in the environment. If a
   long-lived token is unavoidable as a fallback, store it as
   `NPM_TOKEN` (0600 secret) and document its rotation; prefer OIDC.

Do not enable `--provenance` from a workflow that lacks `id-token: write` or
that runs outside the trusted environment — npm will reject the publish.

### Verifying provenance

After a real publish, verify the attestation for every package and version:

```bash
# Per package: confirm the provenance field is present on the registry.
npm view @wats/core@<version> --json | jq '.dist.attestations'

# Or inspect the provenance attestation via Sigstore:
npm audit signatures @wats/core@<version>
```

A provenance publish is verified only when `dist.attestations` (or the Sigstore
attestation bundle) resolves to the expected GitHub workflow run and commit.
Record the verified attestation references (package, version, workflow run URL,
commit SHA) in the release notes. Do not claim provenance is verified until this
check has actually passed against a real published tarball.

## Human publish steps (no CI)

For an out-of-band human publish (e.g. emergency patch when CI is unavailable):

1. From a clean tree on the release tag:
   ```bash
   git status --short --branch      # must be clean
   git checkout v0.3.x
   bun install --frozen-lockfile
   bun run check-publish            # typecheck, build, pack smoke, dry-runs
   ```
2. Authenticate with a 2FA-enabled publisher account using web auth (no static
   token in `.npmrc`):
   ```bash
   npm login --auth-type=web
   npm whoami                       # confirm identity
   ```
3. Build and publish in dependency order, with provenance, from the package
   directories (see `.npmrc.example` for the per-package publish flags):
   ```bash
   bun run build:packages
   for pkg in types crypto graph core http internal-utils config persistence service cli; do
     (cd "packages/$pkg" && npm publish --provenance --access public)
   done
   ```
4. Verify every package is visible and provenance-attested (see "Verifying
   provenance") before creating the GitHub Release.
5. Log out / clear credentials; do not leave a token in a shared `.npmrc`.

`--provenance` requires `id-token: write` semantics; a human `npm publish
--provenance` from a local machine uses the web-authenticated session and does
not need a GitHub OIDC token, but the npm org must still have provenance
permitted for the scope.

## OIDC vs long-lived tokens

Preferred: OIDC publishing. The `release.yml` workflow uses
`id-token: write` and the npm org's GitHub Actions trust configuration to mint
a short-lived publish token. There is no `NPM_TOKEN` secret to leak or rotate.

Fallback (only if OIDC is unavailable): a long-lived automation token stored as
the `NPM_TOKEN` environment secret in the `npm-publish` environment, with 2FA
and a publish-only scope. Document rotation in the private operator channel.
Never commit `NPM_TOKEN` to the repo, never print it, and never log
`npm whoami` output that echoes the token.

## Partial-publish recovery

A partial publish occurs when some `@wats/*` packages publish at `<version>`
and others fail (network, auth, provenance rejection, OTP timeout). Because all
publishable packages share a version, a partial publish leaves the registry in
an inconsistent state.

Recovery procedure:

1. Stop. Do not retry the whole batch blindly.
2. Record the exact per-package publish state:
   ```bash
   for pkg in types crypto graph core http internal-utils config persistence service cli; do
     npm view "@wats/$pkg@<version>" version 2>/dev/null || echo "$pkg MISSING"
   done
   ```
3. For packages that did publish at `<version>`: keep them (they are
   provenance-attested and resolvable). Do not republish the same version — npm
   rejects republishing an existing version, and a forced unpublish+republish
   breaks anyone who already installed `<version>`.
4. For packages that failed: fix the root cause (auth, OTP, provenance
   permissions, network), then publish only the missing packages at the same
   `<version>` with `--provenance`.
5. If the root cause cannot be fixed at `<version>` (e.g. a build defect found
   mid-publish), do not unpublish the already-published packages. Instead bump
   to `<next-version>` (patch), publish the complete set at the new version, and
   `npm deprecate` the partial `<version>` packages with a pointer to
   `<next-version>` (see "Deprecate and unpublish").
6. Only proceed to the GitHub Release once every `@wats/*` package at the target
   version is published and provenance-verified.

## Deprecate and unpublish

Prefer deprecation over unpublish. Unpublish is only available within 72 hours
of publish and only if no other package depends on the version; it is
destructive and should be reserved for credential/secret leaks or
malicious-tarball incidents.

Deprecate a version (non-destructive, recommended for superseded/buggy releases):

```bash
npm deprecate @wats/core@<version> "Superseded by @wats/core@<next-version>; see CHANGELOG."
```

Unpublish (destructive, 72h window, last resort):

```bash
npm unpublish @wats/core@<version>   # single version
# Only the entire package can be unpublished beyond 72h, and only if <72h old
# and no dependents. Almost never correct for a published alpha line.
```

For a full-scope incident (compromised publisher, malicious tarball), revoke
the publisher (see "Revoking publisher access"), unpublish affected versions
within the 72h window if eligible, deprecate anything that cannot be
unpublished, and publish a fixed `<next-version>` with provenance. Record the
incident in the private operator channel and, if disclosure is appropriate, in
the public `CHANGELOG.md` and a GitHub Security Advisory.

## Acceptance and human blockers

Repo-side (done by this change):

- [x] Maintainer runbook documents publisher roster, 2FA, revocation,
      provenance, OIDC, partial-publish recovery, deprecate/unpublish.
- [x] `.npmrc.example` provides `provenance=true` and `auth-type=web` guidance
      for human publishers and the OIDC stance for CI.
- [x] `.github/workflows/release.yml` is a manual-dispatch, OIDC-enabled,
      provenance-publishing workflow gated behind the `npm-publish` protected
      environment.
- [x] `packages/testing/tests/wats110-npm-scope-governance.test.ts` asserts the
      above repo-side artifacts exist and that no credential-free workflow
      performs `npm publish`.

Human-blocked (cannot be completed or faked from the repo):

- [ ] npm org `wats` has 2FA enforced for all members (org settings).
- [ ] Every publisher account has account-level 2FA (`auth-and-writes`).
- [ ] npm org OIDC trust configured for `Switchbord/wats` + `npm-publish`
      environment.
- [ ] `npm-publish` GitHub environment created with required reviewers.
- [ ] A real `npm publish --provenance` has run and the resulting tarball's
      Sigstore attestation has been verified against the workflow run.
- [ ] Linear WATS-110 remains open until the human-blocked items are completed
      and provenance is verified on a real published version.

Do not check the human-blocked boxes from a repo commit. Do not mark WATS-110
Done in Linear from this slice alone.
