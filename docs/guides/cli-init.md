# CLI Onboarding Guide

- status: experimental
- applies-to: WATS-33, WATS-47, and WATS-69; WATS-104 setup wizard
- lastReviewed: 2026-05-16

## Purpose

The WATS CLI is the package-manager entry point for safe local onboarding and inspection. WATS-33 ships credential-safe help surfaces, local verify-token generation, offline config validation, and OpenAPI export. WATS-69 implements the safe `wats init` bootstrap for config/env placeholder generation. WATS-104 implements the safe single-profile `wats setup` wizard for writing local credential files. WATS-70 implements real offline `wats doctor` diagnostics. WATS-71 implements a dry-run `wats serve` process wrapper for local service smoke checks without live credentials.

## Current commands

```bash
wats --help
wats init --help
wats setup --help
wats setup ./my-bot --profile test
wats config validate <path>
wats config validate --config <path>
wats doctor --config <path>
wats doctor --config <path> --profile <name> --check-env
wats doctor --config <path> --format json
wats doctor --help
wats openapi --config <path>
wats openapi --config <path> --profile <name>
wats openapi --config <path> --server-url https://service.example
wats openapi --config <path> --out openapi.json
wats openapi --help
wats serve --config <path> --dry-run
wats serve --config <path> --dry-run --print-routes
wats serve --help
wats webhook token
wats webhook token --help
```

The CLI still does not:

- read or resolve live credentials from existing env files implicitly
- call Meta Graph APIs
- validate tokens against Meta
- manage multiple credential profiles interactively
- start live/credentialed service mode
- overwrite output files

## WATS-47 first-run operator flow

Design target:

```bash
wats init --dry-run
wats init --yes --format yaml --profile local
wats config validate --config wats.config.yaml --profile local
wats doctor --config wats.config.yaml --profile local
wats serve --config wats.config.yaml --profile local --dry-run
```

The first-run flow must be safe for local onboarding:

1. Preview generated files with `wats init --dry-run`.
2. Generate config/env placeholder files only when the operator runs `wats init` without dry-run.
3. Validate the generated config through `@wats/config`.
4. Run doctor offline diagnostics.
5. Start a local dry-run service wrapper around `@wats/service`.

## Env placeholder policy

This section is the env placeholder policy for WATS-47 onboarding.

`wats init` should generate env-secret references in config, not raw secrets:

```yaml
auth:
  accessToken:
    env: WATS_ACCESS_TOKEN
webhook:
  verifyToken:
    env: WATS_VERIFY_TOKEN
  appSecret:
    env: WATS_APP_SECRET
service:
  bearerToken:
    env: WATS_SERVICE_TOKEN
```

WATS-51 ships checked-in alpha examples at `examples/config/wats.config.example.yaml`, `examples/config/wats.config.example.json`, and `.env.example`. They contain placeholder env names only, not raw secrets, and both config examples parse through `@wats/config`.

WATS-69 adds real local generation:

```bash
wats init --dry-run
wats init ./my-bot --format yaml --profile local
wats init ./my-bot --format=json --profile prod
```

`wats init` writes `wats.config.yaml` or `wats.config.json` plus `.env.example`, refuses to overwrite either file, prints only a redacted count summary, and keeps `.env.example` secret-bearing values blank. Copy `.env.example` to an ignored local file such as `.env.local` before filling real values, or use `wats setup` for a guided local-only file write.

`wats setup [dir] [--profile <name>]` prompts for one profile's Graph defaults, WABA id, phone-number id, access token, app secret, webhook path, and local service defaults. Secret prompts display an `Input hidden` hint before reading so pasted tokens and app secrets intentionally do not echo. It writes `wats.config.yaml` with env-secret references and `.env.local` with local values, validates the generated config, refuses to overwrite either target, and rolls back the config if `.env.local` cannot be created. Blank verify/service-token answers generate local random `wats_wh_...` and `wats_srv_...` values. Success output is only:

```text
setup complete
files: 2
profile: [REDACTED_PROFILE]
```

The setup wizard does not read existing `.env.local`, resolve env-secret values, validate tokens against Meta, call Meta Graph APIs, manage multiple profiles, or start the service. Prompt answers are validated for empty/whitespace/control-character values, numeric bounds, safe path shape, and safe profile identifiers before any file is written.

Do not pass raw secrets as CLI arguments. Do not commit access tokens, app secrets, webhook verify tokens, service bearer tokens, WABA ids from real accounts, or phone-number ids from real accounts.

## Validate a config file

```bash
wats config validate wats.config.json
# or
wats config validate --config wats.config.yaml
```

Validation uses `@wats/config`. On success it prints only a safe count summary:

```text
config valid
default profile: [REDACTED_PROFILE]
profiles: 1
```

The summary intentionally does not print profile names, env-secret reference names, or secret values.

On failure, the command exits 1 and prints a compact `ConfigValidationError` code/path/message without stack traces or attacker-supplied file-path echoes.

## Doctor offline diagnostics

```bash
wats doctor --config wats.config.yaml --profile local
wats doctor --config wats.config.yaml --profile local --check-env
wats doctor --config wats.config.yaml --format json
```

`wats doctor` runs real offline diagnostics for local operator readiness:

- runtime compatibility
- package imports
- config discovery and validation
- selected profile existence
- route collision checks
- local OpenAPI generation
- env variable presence only when `--check-env` is passed

The text output is status-only and redacted:

```text
doctor ok
runtime: ok
package-imports: ok
config: ok
profile: ok
routes: ok
openapi: ok
summary: ok=6 warning=0 error=0
```

`--format json` returns `{ ok, summary, checks }` with stable check names. `--check-env` reports counts only, for example `missing 1 required env value`; it does not print env names or values. Doctor never calls Meta Graph APIs and never writes files.

## Export service OpenAPI

```bash
wats openapi --config wats.config.json
```

This prints OpenAPI 3.1 JSON for the WATS standalone service API implemented by `@wats/service`.

Useful variants:

```bash
wats openapi --config wats.config.json --profile prod
wats openapi --config wats.config.json --server-url https://service.example
wats openapi --config wats.config.json --out openapi.json
```

`--out` writes only when explicit and refuses to overwrite existing files. Use stdout redirection if you want shell-managed overwrite semantics.

The exported document is not a Meta Graph API OpenAPI document. It describes only WATS service routes such as health/readiness, configured webhook ingress, text-message service routes, and `/openapi.json`.

## Local verify-token generation

```bash
wats webhook token
```

This prints a single random token prefixed with `wats_wh_`. Copy it into an environment file manually if needed:

```env
WATS_VERIFY_TOKEN=<generated-token>
```

Do not commit the generated token.

## Serve local flow

This section defines the serve local flow for WATS-47.

WATS-47 target:

```bash
wats serve --config wats.config.yaml --profile local --dry-run
wats serve --config wats.config.yaml --profile local --host 127.0.0.1 --port 3000
```

Alpha `serve` should default to dry-run/mock mode. In dry-run mode it loads config, starts the `@wats/service` process wrapper with synthetic in-memory secrets, exposes health/readiness/OpenAPI/webhook routes, and makes no live Meta calls by default.

Live service mode is explicitly credential-gated, but the current build only ships the guard contract and still fails closed before secret resolution or service bind:

```bash
wats serve --config wats.config.yaml --profile prod --live --yes-live
WATS_LIVE_ENABLE=1 WATS_YES_LIVE=1 wats serve --config wats.config.yaml --profile prod --live --yes-live
```

`--live` declares live intent and `--yes-live` acknowledges live Graph/API side effects; `WATS_LIVE_ENABLE=1` and `WATS_YES_LIVE=1` are the equivalent environment-level gate. The follow-up secret-resolution slice will decide and implement explicit `--env-file <path>` support. Until then, `--env-file` is rejected, `.env.local` is never read implicitly, startup makes no Meta Graph call, and authenticated service routes cannot run in live mode.

## Troubleshooting matrix

This troubleshooting matrix is safe to publish because it names failure classes without printing secret values.

| Symptom | Likely cause | Safe next step |
| --- | --- | --- |
| `config_not_found` | no config discovered | pass `--config wats.config.yaml` or run `wats init --dry-run` |
| `profile_not_found` | selected profile missing | check `--profile`, `WATS_PROFILE`, and `defaultProfile` |
| `missing_secret_env` | future live mode requested without required env value | set the env var outside the CLI; explicit `--env-file` support is a follow-up slice |
| `output_exists` | generated file already exists | inspect the file; do not overwrite unless a future command documents safe force behavior |
| `port_in_use` | service bind port already taken | choose another `--port` or stop the existing process |
| `live_confirmation_required` | live check/service requested without acknowledgement | rerun only after reviewing side effects and adding `--yes-live` |

## Credential gate

No live Meta calls by default. The live guard requires both live intent and acknowledgement (`--live` plus `--yes-live`, or the paired `WATS_LIVE_ENABLE=1` / `WATS_YES_LIVE=1` environment gate). In the current guard-only slice the command still fails closed after recognizing the gate, so CI/docs/tests remain credential-free and no secrets are resolved.

## Webhook onboarding checklist

Use `wats onboarding` after you know the public HTTPS URL for your local tunnel or deployed WATS service:

```bash
wats onboarding --public-url https://example.test/wats
wats onboarding --public-url https://example.test --webhook-path /webhooks/whatsapp
```

The command prints the webhook callback address to paste into Meta App Dashboard > WhatsApp > Configuration. It also prints two locally generated values:

- `WATS_VERIFY_TOKEN` — use as the Meta webhook verify token and store in your local env/secret manager.
- `WATS_SERVICE_TOKEN` — use as the bearer token for protected WATS service routes.

The checklist also names the user-side values you must copy from Meta/WhatsApp without WATS generating them: `WATS_ACCESS_TOKEN`, `WATS_APP_SECRET`, `WATS_WABA_ID`, and `WATS_PHONE_NUMBER_ID`. The command prints generated values to stdout only; it does not write files, read `.env.local`, resolve existing secrets, or call Meta Graph APIs.

## Safety defaults

The CLI remains credential-safe by default:

- no raw secrets in command arguments
- no live Meta calls without explicit opt-in
- no secret values printed
- no env-secret reference names printed in validation or OpenAPI output
- no output-file overwrite without future explicit flag support
- generated files, once implemented, should prefer env references over embedded secrets

## Related

- Linear: WATS-47
- `docs/reference/cli.md`
- `docs/reference/config.md`
- `docs/reference/openapi.md`
- `docs/reference/cli.md`
- `docs/architecture/roadmap-to-whatsapp-pywa-parity.md`
