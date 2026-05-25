# Privacy and Telemetry

- status: active
- applies-to: WATS CLI, service, SDK packages, docs examples, and tests
- lastReviewed: 2026-05-24

## Default stance

WATS sends no telemetry to any maintainer-owned endpoint by default.

The CLI does not phone home. Importing SDK packages does not start background network activity. Local tests, docs checks, package smoke tests, OpenAPI generation, and dry-run service commands are credential-free and do not contact WATS maintainers.

## Outbound traffic

Normal WATS runtime traffic is limited to endpoints the operator chooses:

- Meta Graph API requests to the configured Graph base URL, normally `https://graph.facebook.com`, using user-supplied credentials.
- Webhook traffic received from Meta or from the operator's local tunnel/service environment.
- Local development traffic between the operator, test fixtures, and the local WATS service when running dry-run examples.

Credential-free commands such as `wats init`, `wats doctor`, `wats openapi`, `wats webhook token`, `wats onboarding`, and `wats serve --dry-run` do not call Meta Graph APIs and do not contact maintainer infrastructure. `wats upgrade` is also credential-free, but it intentionally shells out to Bun's package manager and can contact the npm registry to update public `@wats/*` packages.

## Data handling

WATS is designed to keep raw secrets out of config files and command output:

- generated config files use env-secret references for access tokens, app secrets, webhook verify tokens, and service bearer tokens;
- `.env.local` is ignored by repository policy and is never read implicitly by default CLI checks;
- success summaries are count/status-oriented and redact profile names, config paths, env-secret names, and token values;
- error messages avoid stack traces and avoid echoing attacker-supplied token-like or path-like values.

WATS does not log webhook bodies by default. Applications built on top of WATS should treat webhook payloads, message text, media metadata, contact details, WABA IDs, phone-number IDs, access tokens, app secrets, webhook verify tokens, service bearer tokens, and Authorization headers as sensitive.

## Redaction expectations

Bug reports, logs, CI output, and screenshots should redact:

- bearer tokens and access tokens;
- app secrets and webhook verify tokens;
- service bearer tokens;
- WABA IDs, phone-number IDs, and account identifiers from real accounts;
- raw webhook bodies or customer/user message content;
- Authorization and X-Hub-Signature headers.

Use synthetic values in tests and public issues. If a report may contain secrets, follow `SECURITY.md` and report privately instead of opening a public issue.

## Future telemetry

Future telemetry, if ever added, will be opt-in and documented. Any future telemetry proposal must describe the data collected, retention period, opt-in mechanism, disable path, and redaction policy before implementation.
