# Contributing to WATS

Thanks for helping improve WATS. The project is an alpha-stage TypeScript toolkit for WhatsApp operations, and the contribution bar is intentionally high because the code touches webhooks, authorization headers, signatures, and user-controlled payloads.

Participation in WATS community spaces is governed by `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).

## Source of truth

Linear is the maintainers' internal planning tool and is not visible to outside contributors. Open or reference a GitHub issue (or Discussion) for the change you intend to make; maintainers cross-link it to Linear during triage. Do not add repo-local deferred ledgers for backlog tracking; repository docs may summarize current roadmap shape only.

Before starting substantial work:

1. Link the change to a GitHub issue or maintainer-approved scope.
2. Write a short scope ledger: included, not included, credential requirements, docs to update, and tests to run.
3. Keep docs move with code: reference docs, guides, parity matrix, and changelog updates belong in the same change as implementation.

## Development setup

WATS uses Bun and TypeScript workspaces.

```bash
bun install --frozen-lockfile
bun run build:packages
bun test
bun run typecheck
bun run check-publish
```

Run `bun run build:packages` once after install and again after switching branches: workspace tests import built `dist` artifacts, so a stale or missing build fails tests for reasons unrelated to your change.

Use targeted tests while developing, then run the relevant shared gates before opening or merging a PR.

## Testing and review expectations

Behavior changes should follow RED/GREEN discipline:

- write a failing behavioral test first;
- verify the failure is for the intended missing behavior;
- implement the smallest safe change;
- run targeted tests and neighboring regressions;
- update docs and changelog in the same branch.

Public package changes must include package-specifier consumer coverage. Import through `@wats/*` entrypoints rather than package-internal relative paths so export maps and downstream consumption are tested.

Security-sensitive changes need adversarial checks for malformed JavaScript callers, accessor-backed objects, URL/path/header injection, resource caps, body passthrough semantics, typed error taxonomy, and secret redaction.

## Credential and privacy rules

WATS is credential-free by default.

- Do not commit secrets, access tokens, app secrets, real WABA IDs, phone-number IDs, live webhook payloads, or raw customer/user data.
- Use `.env.example` and `examples/config/*` placeholders for documentation.
- Keep live Meta validation behind explicit maintainer authorization and environment gates.
- Do not paste credentials, customer data, or confidential operational notes into public docs.
- Redact token-like values and secret-bearing names in CLI output, test fixtures, issue comments, and review notes.

## Documentation rules

For public behavior changes, update all applicable files:

- `site/content/docs/reference/*` for public contracts and error behavior;
- `site/content/docs/guides/*` for runnable or intentionally offline examples;
- `site/content/docs/parity.mdx` for pywa/WhatsApp coverage;
- `site/content/docs/meta/release-policy.mdx` when release/publication behavior changes;
- `CHANGELOG.md` for user-facing changes.

Docs are authored in `site/content/docs` and published to wats.sh; doc changes land in the same PR as the code they describe. Keep the public docs focused on user-facing behavior, package contracts, and release boundaries.

## Pull request checklist

Before a PR is ready:

- [ ] Scope ledger and issue link are clear.
- [ ] Tests prove behavior through public entrypoints where applicable.
- [ ] `bun test` or relevant targeted tests pass.
- [ ] `bun run typecheck` passes for touched packages or the full workspace.
- [ ] No secrets, confidential operational snapshots, or generated build artifacts are committed.
- [ ] Changelog and parity/reference docs are updated.

## Publication boundaries

A GitHub-visible repository is not the same as an npm-ready release. Package publication remains gated on built artifacts, package smoke tests, release automation, and explicit maintainer approval.
