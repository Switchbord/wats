# WATS-50 Release Hygiene Policy

- status: design
- applies-to: WATS-50
- lastReviewed: 2026-05-01
- owner: Linear roadmap; Linear remains the source of truth for issue-level tracking

## Purpose

WATS-50 defines release hygiene for the alpha line: release classification, semver rules, PR gates, changelog discipline, public docs manifest rules, credential-free verification, and a reusable maintainer skill. It is design/docs/test-planner/skill only.

This slice does not implement version-bump automation, package publication, GitHub release creation, tag creation, Docker image publication, branch-protection mutation, public repo creation, credentialed CI, or live Meta calls.

## Scope ledger

Included:

- release classification for every merged alpha PR
- patch-class and minor changes on `0.x`
- changelog and public docs manifest requirements
- PR hygiene and release-gate checklist
- changesets or equivalent policy target
- alpha train exception policy
- credential and publication gates
- reusable maintainer workflow documented outside the public repository

Not included:

- no package publication
- no GitHub release
- no tag creation
- no Docker image publication
- no branch-protection mutation
- no public repo creation
- no credentialed CI
- no live Meta calls
- no in-repo deferred ledgers

## Release classification

Every merged alpha PR must carry a release classification unless it is explicitly batched into a documented alpha train.

Patch-class changes:

- docs-only changes
- tests-only changes
- non-behavioral repo hygiene
- design/docs/test-planner/skill changes
- bug fixes that do not change public contracts

Minor changes on `0.x`:

- new public package export or subpath
- new CLI behavior or command behavior
- config schema additions or changes
- service route additions or changes
- persistence interfaces, adapters, or migration runners
- Docker/deploy artifacts that define supported runtime behavior
- public API behavior changes

Breaking alpha public-contract changes are still minor changes on `0.x`, but must be marked as breaking in changelog, release notes, reference docs, and migration docs where relevant.

## Alpha train exception

The default target after automation exists is at least patch-level release intent for every merged alpha PR. A documented alpha train may batch multiple PRs only when it records included issues/PRs and the highest semver bump.

Do not track alpha train backlog in repo-local deferred ledgers. Use Linear for issue-level follow-up.

## Changelog and public docs policy

Every user-visible PR needs a changelog entry or an explicit release-none justification.

Public docs rules:

- new public docs pages must be listed in `docs/public-docs-manifest.json`
- private handoff or maintainer-only files must not be added to the public manifest
- docs must not claim automation exists before it does
- docs must not claim `switchbord/wats` exists until GitHub creation/push is verified

## Automation target

WATS should use changesets or equivalent for release intent once automation is approved. Changesets or equivalent are not implemented by this slice.

Target future automation:

- fixed/linked alpha version group for publishable `@wats/*` packages
- internal support package policy for `@wats/internal-utils` and private package guard for `@wats/testing`
- changelog validation
- package smoke tests from built artifacts
- dry-run publication checks before any real registry publication

## Credential gates

Default CI remains credential-free.

Credentialed operations require explicit user authorization and protected release environments:

- npm publish
- GitHub release/tag creation
- Docker/GHCR image push
- branch protection/ruleset mutation
- public repository creation or push
- live Meta validation

No PR workflow should require npm, GitHub release, Docker registry, or Meta credentials.

## Release gate checklist

Before an actual release/tag/publication, run and record:

```sh
git status --short
bun install --frozen-lockfile
bun test
bun run typecheck
bun run docs:check
bun run docs:build
bun run check-publish
```

Also verify:

- changelog/release notes match the release classification
- public docs manifest includes every public docs page
- package export/private boundaries are correct
- no generated temp artifacts are committed
- Linear records remaining gaps
- no secrets or credential values are committed

## WATS-50 boundary

WATS-50 produces policy, docs, tests, and the reusable skill only. It does not create release tags, publish packages, add release workflows, mutate GitHub branch protection, push to `switchbord/wats`, or use credentials.
