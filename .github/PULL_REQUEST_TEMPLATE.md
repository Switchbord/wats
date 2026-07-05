<!-- Thank you for contributing to WATS. Please complete every section below. -->

## Summary

<!-- One paragraph: what does this PR change, and why? -->

## Issue tracking

<!-- Link the GitHub issue or discussion this PR closes or contributes to.
     External contributors: reference a GitHub issue (open one if none exists yet).
     Maintainers may additionally cross-link the Linear issue (WATS-nn) during triage. -->

Closes #<GitHub issue> (or WATS-nn for maintainers)

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] Feature (non-breaking change which adds capability or surface area)
- [ ] Breaking change (fix or feature that would cause existing behavior to change)
- [ ] Docs / examples / parity matrix update only
- [ ] Internal refactor / chore (no public behavior change)

## How was this tested?

<!-- Required. List the commands you ran and their results. Prefer credential-free reproductions.
     If this changes behavior, you must include passing `bun test` output for the relevant lock/RED test. -->

- [ ] `bun install --frozen-lockfile`
- [ ] `bun test packages/testing/tests/<relevant-test>.test.ts`
- [ ] `bun test packages/testing/tests/`
- [ ] `bun run api:check`
- [ ] `git diff --check`

## Docs in lockstep

Behavior-bearing changes must update docs in the same PR. Check what applies:

- [ ] `site/content/docs/reference/*` — public contract and error semantics
- [ ] `site/content/docs/guides/*` — usage guide / runnable example
- [ ] `site/content/docs/parity.mdx` — parity status
- [ ] `site/content/docs/migration/pywa.mdx` — import / migration mapping
- [ ] `CHANGELOG.md` — release entry for the next patch/minor line

## Non-goals (verified)

<!-- Required for behavior changes. Explicitly list non-goals: what this PR does NOT do.
     The default pre-public-alpha posture is: no live Meta calls, no real credentials,
     no npm publish, no GitHub release, no git tag. -->

- [ ] no live Meta calls
- [ ] no real credentials, tokens, secrets, or WABA IDs in code, tests, fixtures, or CI
- [ ] no npm publish, no GitHub release, no git tag created by this PR

## Battery outcome (for behavior-bearing PRs)

<!-- For features that expose a public function/method, URL/path/header construction,
     a secret/signature compare, a resource cap, an error taxonomy, a body-accepting transport,
     or any exported consumer module: paste the adversarial battery outcome checklist
     (which sections applied + one-line evidence per section). Docs-only PRs may write N/A. -->

## Scope ledger

<!-- Required. Bullet what is in scope and what is intentionally deferred to other issues.
     Deferred items must reference issue IDs (GitHub issue # or WATS-NN for maintainers);
     do not introduce deferred ledgers in this repo. -->

- Included:
- Not included (tracked separately):
