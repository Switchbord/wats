# CLI Onboarding Guide

- status: experimental
- applies-to: WATS-33, WATS-47, and WATS-69
- lastReviewed: 2026-05-04

## Purpose

The WATS CLI is the package-manager entry point for safe local onboarding and inspection. WATS-33 ships credential-safe help surfaces, local verify-token generation, offline config validation, OpenAPI export, and a `serve --help` handoff. WATS-69 implements the safe `wats init` bootstrap for config/env placeholder generation; `doctor` and `serve` remain future runtime slices.

## Current commands

```bash
wats --help
wats init --help
wats config validate <path>
wats config validate --config <path>
wats doctor --help
wats openapi --config <path>
wats openapi --config <path> --profile <name>
wats openapi --config <path> --server-url https://service.example
wats openapi --config <path> --out openapi.json
wats openapi --help
wats serve --help
wats webhook token
wats webhook token --help
```

The CLI still does not:

- create `.env.local`
- read or resolve live credentials
- call Meta Graph APIs
- validate tokens against Meta
- start a server process
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
3. Validate the generated config through `@switchbord/config`.
4. Run doctor offline diagnostics.
5. Start a local dry-run service wrapper around `@switchbord/service` when implemented.

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

WATS-51 ships checked-in alpha examples at `examples/config/wats.config.example.yaml`, `examples/config/wats.config.example.json`, and `.env.example`. They contain placeholder env names only, not raw secrets, and both config examples parse through `@switchbord/config`.

WATS-69 adds real local generation:

```bash
wats init --dry-run
wats init ./my-bot --format yaml --profile local
wats init ./my-bot --format=json --profile prod
```

`wats init` writes `wats.config.yaml` or `wats.config.json` plus `.env.example`, refuses to overwrite either file, prints only a redacted count summary, and keeps `.env.example` secret-bearing values blank. Copy `.env.example` to an ignored local file such as `.env.local` before filling real values.

Generated local verify tokens and service bearer tokens are secrets; if a later `--generate-local-secrets` writes them, it should do so only to an explicitly chosen local env file, with no overwrite by default.

Do not pass raw secrets as CLI arguments. Do not commit access tokens, app secrets, webhook verify tokens, service bearer tokens, WABA ids from real accounts, or phone-number ids from real accounts.

## Validate a config file

```bash
wats config validate wats.config.json
# or
wats config validate --config wats.config.yaml
```

Validation uses `@switchbord/config`. On success it prints only a safe count summary:

```text
config valid
default profile: [REDACTED_PROFILE]
profiles: 1
```

The summary intentionally does not print profile names, env-secret reference names, or secret values.

On failure, the command exits 1 and prints a compact `ConfigValidationError` code/path/message without stack traces or attacker-supplied file-path echoes.

## Doctor offline diagnostics

WATS-47 target:

```bash
wats doctor --config wats.config.yaml --profile local
wats doctor --config wats.config.yaml --profile local --check-env
```

Default doctor checks should stay offline:

- runtime compatibility
- package imports
- config discovery and validation
- selected profile existence
- route collision checks
- local OpenAPI generation
- env variable presence only when `--check-env` is passed

Doctor should never print env values. Live checks require the credential gate and are not part of default docs/tests.

## Export service OpenAPI

```bash
wats openapi --config wats.config.json
```

This prints OpenAPI 3.1 JSON for the WATS standalone service API implemented by `@switchbord/service`.

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

Alpha `serve` should default to dry-run/mock mode. In dry-run mode it loads config, starts the `@switchbord/service` process wrapper with synthetic in-memory secrets, exposes health/readiness/OpenAPI/webhook routes, and makes no live Meta calls by default.

Live service mode is explicitly credential-gated:

```bash
wats serve --config wats.config.yaml --profile prod --live --yes-live --env-file .env.local
```

Live mode should resolve required secret values only after explicit opt-in. Startup should not call Meta by default, but authenticated service routes may send real WhatsApp messages once live credentials are loaded.

## Troubleshooting matrix

This troubleshooting matrix is safe to publish because it names failure classes without printing secret values.

| Symptom | Likely cause | Safe next step |
| --- | --- | --- |
| `config_not_found` | no config discovered | pass `--config wats.config.yaml` or run `wats init --dry-run` |
| `profile_not_found` | selected profile missing | check `--profile`, `WATS_PROFILE`, and `defaultProfile` |
| `missing_secret_env` | live mode requested without required env value | set the env var outside the CLI or use explicit `--env-file` |
| `output_exists` | generated file already exists | inspect the file; do not overwrite unless a future command documents safe force behavior |
| `port_in_use` | service bind port already taken | choose another `--port` or stop the existing process |
| `live_confirmation_required` | live check/service requested without acknowledgement | rerun only after reviewing side effects and adding `--yes-live` |

## Credential gate

No live Meta calls by default. The credential gate requires an explicit live flag plus a confirmation such as `--yes-live` or `WATS_LIVE_ENABLE=1`. CI/docs/tests remain credential-free.

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
- `docs/architecture/wats47-cli-operator-ux-design.md`
- `docs/architecture/alpha-cli-runtime-operations-plan.md`
- `docs/architecture/decisions/ADR-007-alpha-cli-runtime-operator-layer.md`
