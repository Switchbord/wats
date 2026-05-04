# ADR-001: API Shape and Repository Direction

- status: accepted
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- date: 2026-04-20

## Context

WATS needs a stable, explicit API direction early to keep package boundaries coherent and parity work predictable.

## Decision

1. Public API naming is camelCaseOnly.
2. Public operations are asyncOnly.
3. Delivery strategy follows aggressiveParity with pywa where feasible.
4. Repository structure remains monorepo under Bun workspaces.

## Status Rationale

The direction is marked locked to prevent drift while foundational modules are scaffolded.

## Consequences

- Simplifies user expectations for naming and async behavior.
- Reduces rework during parity tracking.
- Requires explicit ADR supersession for any deviation.

## Alternatives Considered

- Mixed naming styles: rejected for inconsistency cost.
- Sync/async dual APIs: rejected due to maintenance overhead.
- Polyrepo split: rejected to preserve shared release flow.

## Follow-up

TODO(A2): Add concrete API examples once module references are implemented.
