# Repository Settings Hygiene

- status: maintainer-runbook
- applies-to: WATS-109
- publicDocs: excluded from public docs site by `docs/public-docs-manifest.json` `maintainers/**`
- lastReviewed: 2026-05-24

## Purpose

WATS-109 records the GitHub repository settings expected before a public-alpha announce. This document is reproducible operator guidance; settings applied by maintainers outside this PR may change GitHub server-side configuration, but this repo change does not mutate branch protection or secrets by itself.

## Branch protection target

Target branch: `main` on `Switchbord/wats`.

Required settings:

- Require pull requests before merging.
- Require at least one approving review before merge.
- Require conversation resolution before merge.
- Require status checks to pass before merge.
- Required status check: `Bun tests and release hygiene`.
- No force pushes on `main`.
- No branch deletion for `main`.
- Signed commits are optional for this alpha line, but maintainers should document if the org later makes them mandatory.

## Required CI policy

The `Bun tests and release hygiene` check is the canonical required check. It runs the repository workflow at `.github/workflows/ci.yml`, which covers install, package build, tests, the minimal bot example smoke, typecheck, docs checks/build, and publishability guard.

The individual commands that this required check represents include:

- `bun test`
- `bun run examples:minimal-bot`
- `bun run typecheck`
- `bun run docs:check`
- `bun run docs:build`
- `bun run check-publish`

`api:check` is covered through release and docs/test gates. If GitHub later supports splitting these into separately named checks, keep this page updated with the exact check names from the branch protection UI.

## Dependabot

`.github/dependabot.yml` enables weekly Dependabot scans for:

- `npm`
- `github-actions`

Dependabot PRs should keep the same credential-free safety boundary as normal PRs: no live Meta credentials, no npm publish, no tag, and no GitHub Release side effects.

## CodeQL

`.github/workflows/codeql.yml` enables CodeQL for JavaScript/TypeScript on pull requests, pushes to `main`, and a weekly schedule. The workflow uses low-privilege permissions:

- `contents: read`
- `security-events: write`

It must not require repository secrets such as npm tokens, Linear keys, WhatsApp credentials, or Meta credentials.

## Branch protection snapshot

After maintainers apply or verify the server-side settings, capture a branch protection snapshot with:

```bash
gh api repos/Switchbord/wats/branches/main/protection
```

Also capture repository-level settings with:

```bash
gh api repos/Switchbord/wats
```

Do not commit token-bearing API output. If a field contains private URLs, installation IDs, or future secret-looking values, redact them before sharing. The snapshot should prove the policy, not archive credentials.

## Pre-announce checklist

- [ ] `main` requires pull requests before merging.
- [ ] `main` requires at least one approving review.
- [ ] `Bun tests and release hygiene` is required before merge.
- [ ] Force pushes are disabled on `main`.
- [ ] Dependabot is enabled for `npm` and `github-actions`.
- [ ] CodeQL JavaScript/TypeScript analysis is enabled on PRs and weekly schedule.
- [ ] CI badge in `README.md` points to `.github/workflows/ci.yml`.
- [ ] Branch protection snapshot is reviewed by maintainers before announce.
