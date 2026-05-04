# WATS-82 First-release readiness

- status: readiness-gate
- applies-to: WATS-82
- lastReviewed: 2026-05-04

## Purpose

WATS-82 is the GitHub push and first-release readiness gate for `switchbord/wats`. It verifies that the repository is close to public visibility while preserving the hard boundary that publication must use a sanitized tree and valid GitHub credentials.

This gate records current blockers and the safe publication path. It does not create the GitHub repository, push code, publish packages, create tags/releases, or run live Meta calls.

## Current verification snapshot

- GitHub CLI is installed but unauthenticated in this environment.
- GH auth currently unavailable, so repository creation and push are blocked.
- There is no configured remote for the working repository.
- `switchbord/wats` must not be claimed as pushed or available until `gh` authentication and a successful push are verified.
- `bun run check-publish` is now the local release-readiness gate; it includes `bun run release:dry-run`, `bun run build:packages`, `bun run pack:smoke`, typecheck, and policy tests.
- The release dry-run remains credential-free and performs no package publication or GitHub release operations.

## Publication blockers

Do not push current history public as-is. In docs-lock wording: do not push current history public as-is.

The adversarial pre-publication review found no high-confidence raw secret or token leaks, but it did find public-readiness blockers:

- tracked internal handoff documents in historical commits;
- tracked private planning artifacts in historical commits;
- private issue metadata and operational context in handoff/planning material;
- untracked private planning files in the current worktree that must not be committed; in docs-lock wording: untracked private planning files must not be committed;
- prior private working branches and issue-number history that can confuse public readers.

Deleting these files in a normal commit is insufficient for public GitHub visibility because the material remains in history. The safe routes are:

1. create a fresh sanitized public import from an allowlisted tree; or
2. rewrite/filter history before pushing.

In short: use a history rewrite or fresh import before public push.

The preferred route for first public visibility is a fresh sanitized public import.

## Sanitized tree requirements

The sanitized tree for `switchbord/wats` must include:

- source packages under `packages/` except private maintainer-only artifacts;
- public examples and docs that are in `docs/public-docs-manifest.json`;
- `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md`;
- `.github/workflows/ci.yml` and `.github/workflows/release-dry-run.yml`;
- package manifests and lockfile needed for `bun install --frozen-lockfile`;
- release scripts used by `bun run check-publish`.

It must exclude:

- internal handoff files (`docs/handoff*.md`);
- private planning artifacts;
- private issue snapshots, private comments, private issue packets, or team workflow metadata;
- local generated artifacts such as `node_modules`, `docs/.vitepress/dist`, `docs/api`, tarballs, and package `dist` outputs unless the release process intentionally builds them;
- `.env`, `.env.*`, raw secrets, live WABA/phone ids, app secrets, service bearer values, or live webhook payloads.

## Required commands before public push

Run from the sanitized tree:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run docs:check
bun run docs:build
bun run check-publish
bun run release:dry-run
```

Also run an adversarial privacy/security scan over the exact sanitized tree and history that will be pushed.

## GitHub publication gate

Before creating or pushing `switchbord/wats`:

1. Authenticate GitHub CLI with an account authorized for the `switchbord` org.
2. Verify `gh auth status` and `gh repo view switchbord/wats` behavior.
3. If the repo does not exist, create it only from the sanitized import path.
4. Push only after the sanitized tree passes the commands above.
5. Verify the remote URL, default branch, latest pushed commit, and CI run.
6. Add a Linear comment with the exact pushed commit and CI result.

If authentication is absent, stop at a local readiness artifact and do not imply that a GitHub repository was created or pushed.

## Non-goals

- no GitHub repository creation in this slice;
- no repository push;
- no package publication;
- no GitHub release;
- no tag creation;
- no branch-protection mutation;
- no credentialed CI;
- no live Meta calls.
