# Public Alpha Launch Checklist

- status: maintainer-runbook
- applies-to: WATS-117
- publicDocs: excluded from public docs site by `docs/public-docs-manifest.json` `maintainers/**`
- lastReviewed: 2026-05-24

## Purpose

WATS-117 records the launch-day checklist for a public alpha announce. This is a dry-run checklist until maintainers explicitly complete publish, release, and repository settings work.

## Release readiness gates

- [ ] docs site green: `bun run docs:check` and `bun run docs:build` pass on main.
- [ ] package gates green: `bun run check-publish` passes on a clean tree.
- [ ] npm publishes done with provenance for every public `@wats/*` package intended for the release.
- [ ] GitHub release notes drafted, reviewed, and matched to the tag.
- [ ] CI badges live in README and resolve to the current workflow.
- [ ] telemetry stance live: `docs/privacy.md` says no maintainer-owned telemetry by default.
- [ ] example bot working: `bun run examples:minimal-bot` passes.
- [ ] branch protection and repo settings reviewed against `docs/maintainers/repo-settings.md`.
- [ ] CodeQL and Dependabot are active or explicitly deferred with maintainer sign-off.

## When NOT to use WATS

Before announce, make sure public copy includes a clear "When NOT to use WATS" boundary:

- Do not use WATS as a production SLA guarantee; it is alpha software.
- Do not use WATS to bypass Meta policy, approval, opt-in, commerce, template, calling, or messaging limits.
- Do not use WATS if you need live Meta validation in default CI; live validation remains credential-gated.
- Do not use WATS as a hosted service. It is a toolkit and local/runtime package set.
- Do not infer delivered/read states from send success; use observed webhook/event-store evidence.

## First 48 hours response plan

- Assign one on-call maintainer for issue triage and one backup.
- Watch GitHub issues, discussions, npm install failures, and CI status for the first 48 hours.
- Label incoming reports as docs, install, CLI, Graph/API, service, security, or live-validation.
- Move credential-bearing reports to a private channel; never ask users to paste tokens, app secrets, WABA IDs, phone IDs, webhook bodies, or customer content publicly.
- For package publication incidents, pause new publish attempts, capture the package/version matrix, and document whether any package was partially published.

## Dry-run pass

Run and record a dry-run pass before announce:

```bash
git status --short --branch
bun install --frozen-lockfile
bun run typecheck
bun run build:packages
bun test
bun run examples:minimal-bot
bun run api:check
bun run docs:check
bun run docs:build
bun run check-publish
```

The dry-run pass must not create tags, GitHub releases, npm publishes, Docker images, live Meta calls, or credential validation side effects.

## On-call handoff

- Primary on-call: maintainer to assign before announce.
- Backup on-call: maintainer to assign before announce.
- Escalation path: security issues go through GitHub Security Advisories or another private maintainer channel; conduct issues follow `CODE_OF_CONDUCT.md`.

## Done criteria

- Checklist reviewed by maintainers.
- Announce draft reviewed.
- Release gates completed for the target version.
- First 48 hours coverage assigned.
