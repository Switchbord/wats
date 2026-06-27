# Telemetry Privacy Model and Metric Taxonomy

WATS-161 / TELEMETRY-0. Design contract for WATS service telemetry. No `/metrics`, `/status`, or diagnostics implementation exists in this slice. Future telemetry issues (WATS-162 through WATS-166) import and respect these decisions.

## Goal

Define the telemetry privacy boundary and metric taxonomy before adding endpoints. Every telemetry issue in the WATS-162..166 epic points at this document as its contract.

## Non-goals

- No analytics backend.
- No default outbound telemetry.
- No raw event logging.

## Separation from liveness and readiness

Telemetry is separate from liveness and readiness. `/healthz` and `/readyz` already exist and answer one question each: "is this process alive?" and "is this process ready to accept traffic?" They return a 200 with a minimal `{ ok, service }` JSON body with no per-request variability. Telemetry endpoints (`/metrics`, `/status`, `/debug/diagnostics`) answer a different question: "what is this service doing?" They are opt-in, protected, and return structured data. Do not merge telemetry into health/readiness or vice versa.

## Allowed metric families

The following metric families are the only ones WATS service telemetry may expose. Each family has a concrete metric name in Prometheus snake_case convention. Future implementations (WATS-162) must not invent metrics outside this list without amending this doc and its test.

| Family | Metric name | Type | Description |
|--------|-------------|------|-------------|
| HTTP requests | `http_requests_total` | counter | Inbound HTTP requests to the service. Labels: `route`, `method`, `status_class`. |
| HTTP latency | `http_request_duration_seconds` | histogram | Request duration in seconds. Labels: `route`, `status_class`. |
| Webhook normalization | `webhook_normalization_total` | counter | Webhook envelopes normalized by update kind and outcome. Labels: `update_kind`, `outcome`. |
| Graph operations | `graph_operations_total` | counter | Outbound Graph API calls by endpoint family and status class. Labels: `endpoint_family`, `status_class`, `outcome`. |
| Send outcomes | `send_outcomes_total` | counter | Message send attempts by outcome. Labels: `endpoint_family`, `outcome`. |
| Persistence operations | `persistence_operations_total` | counter | Persistence store operations by adapter and outcome. Labels: `adapter`, `outcome`. |
| Outbox depth | `outbox_depth` | gauge | Number of items in the persistence outbox. Labels: `adapter`, `state`. |

## Allowed label keys

The following low-cardinality, PII-safe label keys are the only ones permitted on WATS service metrics. Future implementations must not introduce labels outside this list without amending this doc and its test.

| Label key | Example values | Cardinality |
|-----------|----------------|-------------|
| `route` | `/webhook`, `/messages/:id`, `/groups/:groupId`, `/healthz` | bounded by route template inventory |
| `method` | `GET`, `POST` | fixed |
| `status_class` | `2xx`, `4xx`, `5xx` | fixed |
| `update_kind` | `message`, `status`, `template`, `group_lifecycle_update` | bounded by webhook update types |
| `endpoint_family` | `messages`, `media`, `templates`, `groups`, `flows` | bounded by Graph endpoint families |
| `outcome` | `success`, `error`, `skipped`, `deduped` | fixed |
| `adapter` | `sqlite`, `postgres` | fixed |
| `state` | `pending`, `claimed`, `sent`, `failed` | fixed |

### Route templating rule

The `route` label MUST be the matched route template with path parameters replaced by `:param` — for example `/groups/:groupId`, `/messages/:id`. Never use the raw `pathname` (e.g. `/groups/1234567890`) as a label value. Unknown or unmatched paths use the literal `unmatched`. This prevents unbounded cardinality and identifier leakage (group IDs, WAMIDs in paths).

### Enum-clamping rule for untrusted values

Label values derived from untrusted input (`update_kind`, `endpoint_family`) MUST be validated against a fixed enum documented in the table above. Any value outside the enum MUST be emitted as `unknown`. Raw strings from webhook payloads or request paths MUST NOT be used as label values verbatim.

The substring denylist (below) applies to label *key names* only. Label *values* such as `update_kind="message"` are not affected by the denylist; values are governed by this enum-clamping requirement.

## PII denylist

The following categories must never appear as metric labels, in diagnostic output, in `/status` payloads, or in `/debug/diagnostics` responses. This list is exhaustive for the categories; specific field names within each category are illustrative, not limiting.

- phone numbers — `to`, `from`, `display_phone_number`, `wa_id`, any E.164 or national-format number
- message text — `body`, `text`, `caption`, any message content
- media content — image, audio, video, document bytes, media URLs, media IDs
- tokens — `access_token`, `verify_token`, `app_secret`, `service_bearer_token`, `bearer`, any credential
- WAMIDs — `message.id`, `wamid.*`, any Meta message identifier
- raw webhook payloads — the original JSON body of a webhook event, any entry or change object
- config paths — filesystem paths to config files, `.env` files, profile directories
- stack traces — `Error.stack`, exception frames, source file paths
- env values — values of `process.env.*`, env-secret references, environment variable expansions
- IP addresses — caller/requester IP, `x-forwarded-for`, `remoteAddress`
- location data — latitude, longitude, any geolocation coordinates
- profile and contact names — display names, contact names, business profile names

The words `phone`, `recipient`, `sender`, `message`, `body`, `token`, `secret`, `wamid`, `filepath`, `env`, `config_path`, and `stack` are denied as label key names. A label key that contains any of these substrings is a violation.

## Endpoint protection

Telemetry endpoints are opt-in and protected. The default service configuration does not register telemetry routes; requests to `/metrics`, `/status`, `/debug/diagnostics` fall through to the existing catch-all 404 handler and return an indistinguishable `not_found` response. When enabled, endpoints require the existing service bearer token (the same `serviceBearerToken` from `WatsServiceSecrets`).

Existing service routes (`/messages`, `/groups/*`) return 401 on auth failure. Telemetry endpoints intentionally diverge: a missing or mismatched token returns 404 (not 401) to avoid leaking endpoint existence, because telemetry surface availability is more sensitive than the public message-sending routes. The 404 response body and headers MUST be byte-identical to the catch-all 404.

Options for future implementers:

1. Bearer token — `/metrics`, `/status`, and `/debug/diagnostics` require `Authorization: Bearer <token>`. Fail closed with 404 on missing or mismatched token.
2. Localhost/internal bind — for operators who want telemetry without a token: bind telemetry routes to a separate listener on `127.0.0.1` or a Unix socket. This is a deployment concern, not a WATS core concern.

WATS-162 (`/metrics`), WATS-163 (`/status`), WATS-164 (OTel hook seams), WATS-165 (`/debug/diagnostics`), and WATS-166 (docs) must implement against this document. If an implementation needs a new metric family, label key, or diagnostic field, amend this doc and its test first.

## No /metrics implementation in this slice

This document is a contract. No `/metrics` route, Prometheus text endpoint, OpenMetrics endpoint, or metrics registry exists in `@wats/service` as of this slice. The test asserts that no file under `packages/service/src/` contains `/metrics`, `prometheus`, or `openmetrics`. WATS-162 implements the endpoint.
