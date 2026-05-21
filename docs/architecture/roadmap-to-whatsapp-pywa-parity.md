# Roadmap to WhatsApp / pywa Parity

- status: active
- applies-to: post-foundations roadmap
- lastReviewed: 2026-05-01

## Purpose

This document summarizes the roadmap shape. Linear is the source of truth for issue-level tracking; this file exists only to keep the repo oriented around the same milestone structure.

## Current state

`0.2.0-foundations-complete` ships the substrate:

- Graph client, transport seam, endpoint registry, pagination, scoped clients
- pywa-seeded Graph error registry
- webhook challenge/signature verification
- runtime-neutral WebhookAdapter plus Bun/Node/Fetch wrappers
- typed webhook normalizer
- typed filters, router, listeners, and `WhatsApp` facade
- consumer fixtures and docs lockstep checks

Endpoint breadth remains early but now includes text send, arbitrary-recipient text starts, WABA phone-number listing, WATS-37 media runtime (single-POST upload, metadata resolution, binary download, delete, encrypted decrypt, and upload sessions), WATS-39 templates, WATS-40 flows, WATS-41 calling request shapes, WATS-42A read-only business/admin inventory, and WATS-95 Block API/OBA/display-name request-shape helpers plus business-alert webhook values. Broader mutating admin APIs and live checks remain credential-gated.

## Milestone structure

### M0 — publishable repository hygiene

Goal: make the repository ready for public release engineering.

- dist builds and package exports
- CI for tests, type checks, docs checks, and package smoke tests
- release policy and changelog discipline
- WATS-50 release hygiene policy and reusable maintainer skill for PR/release closure; issue-level release automation follow-ups live in Linear, not repo-local deferred ledgers
- package publish allowlist / private package guard
- wats GitHub repo bootstrap plan

### M1 — config, CLI, and standalone service

Goal: make WATS adoptable without writing framework glue.

- `@wats/config` with YAML/JSON config loading and env-secret references
- `@wats/cli` with `init`, `config validate`, `doctor`, `serve`, and `openapi`
- WATS-47 CLI operator UX design for `init`, `doctor`, and `serve`, keeping no live Meta calls by default while implementation proceeds in later CLI slices
- WATS-48 persistence contract design for durable runtime state, SQLite/Postgres adapter path, migrations, and idempotency. No runtime adapter implementation in the design slice.
- WATS-49 Docker/deployment design scaffold for future `wats serve` packaging; no runtime Docker artifact/image publication in the design slice.
- `@wats/service` with webhook ingestion, text send, health/readiness, auth, and OpenAPI 3.1
- docs for package-manager installation and standalone operation

### M2 — media runtime

Goal: complete media runtime parity.

Done in WATS-37:
- single-POST upload with multipart body builder
- metadata resolution
- binary download/fetch from resolved URLs through injected transport
- delete
- encrypted media decrypt
- resumable upload sessions
- media docs, examples, tests, and MockTransport consumer fixtures

Remaining:
- credential-gated live checks

### M3 — message composer breadth

Goal: cover WhatsApp send-message types beyond text.

Implemented in WATS-38:
- image, video, audio, document, sticker outbound composers for existing media ids/http(s) links
- location, contacts, reaction/remove-reaction
- interactive buttons, lists, CTA URL, catalog, product, product-list, and location request
- approved template send payloads
- mark-as-read and typing indicators
- strict body validation and typed response surfaces with MockTransport coverage

Remaining after WATS-39:
- credentialed live Meta validation for media/message/template paths
- high-level template-library/bulk-authentication helpers if needed
- live Flow validation/hosting/encrypted data-exchange work after WATS-40

### M4 — templates

Goal: support template operations and pywa-compatible ergonomics.

Implemented in WATS-39:
- list/create/get/update/delete message-template endpoint callables and `WABAClient` methods
- category/language/status/parameter-format type aliases and response shapes
- HEADER/BODY/FOOTER/BUTTONS component builders with bounded runtime validation
- parameter count validation for positional and named template sends
- template status/quality/category/components webhook helper fields and `filtersTyped.template` built-ins

Remaining:
- credentialed live Meta validation for template mutations
- high-level library-template, comparison, migration, unpause, and bulk authentication helpers if needed by consumers

### M5 — flows

Goal: support WhatsApp Flows as first-class operations.

Implemented in WATS-40:
- list/get/create/update metadata/update JSON/publish/delete/deprecate/assets endpoint callables
- matching `WABAClient` methods for WABA-scoped Flow operations
- bounded `buildFlowJson` / `validateFlowJson` helpers
- data-exchange response builders for screen, close-flow, and error responses
- MockTransport-backed tests and external graph-consumer fixture coverage

Remaining:
- credentialed live Meta validation for Flow mutations
- production Flow hosting/deployment and service/OpenAPI integration
- encrypted data-exchange request decrypt/response encrypt handling
- metrics/migration helpers if needed by consumers

### M6 — calling

Goal: support WhatsApp calling endpoints and webhook variants.

Implemented in WATS-41:
- initiate/pre-accept/accept/reject/terminate request-shape callables and `PhoneNumberClient` methods
- call status/connect/terminate webhook variants
- typed filters and handlers for synthetic credential-free payloads

Remaining:
- credential-gated live tests
- deeper WebRTC/media session orchestration if needed

### M7 — business management / admin

Goal: cover WABA and phone-number operations needed for real operations teams.

WATS-42A — Complete for the bounded read-only, credential-free first slice:
- `getWabaInfo`, `listSubscribedApps`, enhanced `listPhoneNumbers({ fields?, limit?, after?, before? })`
- `getPhoneNumberInfo`, `getPhoneNumberSettings`, `getBusinessProfile`, `getCommerceSettings`
- matching `WABAClient` / `PhoneNumberClient` methods and public `@wats/graph/endpoints/business-management` subpath
- MockTransport-only validation; `getPhoneNumberSettings({ includeSipCredentials: true })` may return sensitive SIP credential material

WATS-95 — Complete for bounded credential-free compatibility deltas:
- Block API helpers `listBlockedUsers`, `blockUsers`, `unblockUsers` over Graph `block_users`
- OBA/display-name helpers `getOfficialBusinessAccountStatus`, `requestOfficialBusinessAccountReview`, `submitDisplayNameForReview`
- typed business webhook values for `phone_number_quality_update` (`THROUGHPUT_UPGRADE`, `TIER_UNLIMITED`) and `account_alerts` (`PROFILE_PICTURE_LOST`)
- no live Meta calls, no automatic user-block decisions, and no policy/appeal automation

Remaining:
- Mutating admin endpoints remain credential-gated/deferred: WABA CRUD, phone-number registration/configuration beyond the bounded WATS-95 request-shape helpers, profile/settings/commerce updates, subscribed-app mutations, webhook callback override, and public-key mutation
- analytics/quality/rate-limit surfaces beyond WATS-95 typed alert payloads
- catalog/product inventory CRUD beyond read-only commerce settings

### M8 — pywa migration and parity hardening

Goal: make pywa users productive and confident.

WATS-44 delivers the first credential-free migration/parity audit:

- pywa-to-WATS migration guide with concrete mappings
- live credentialed validation campaign runbook
- endpoint/type/filter parity matrix maintained per capability
- recipe docs for common bot, support, notification, and ops workflows

Credentialed validation campaign phases are deliberately ordered as read-only discovery, controlled side-effecting tests, cleanup/destructive-only tests, and separately authorized admin mutations. The campaign remains halted until credentials and explicit user authorization are available.

## Linear issue template

Use this structure when creating Linear roadmap issues:

```md
## Scope
Included:
- ...

Not included:
- ...

## Public API
- package(s): ...
- expected exports: ...
- package-manager / service / CLI impact: ...

## Docs
- reference: ...
- guide/example: ...
- parity matrix: ...
- changelog: ...

## Tests
- unit: ...
- adversarial: ...
- external consumer fixture: ...
- credential-gated live check: yes/no

## References
- Meta docs: ...
- pywa source/docs: ...

## Release classification
patch | minor | major | post-1.0
```

## Credential rule

Any milestone step that hits live Meta endpoints, sends messages, mutates WABA assets, or verifies live webhook secrets requires explicit user authorization and a documented secrets plan before execution.
