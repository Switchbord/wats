# WATS-47 CLI operator UX design

- status: design
- applies-to: WATS-47
- lastReviewed: 2026-05-01
- owner: Linear roadmap; implementation remains tracked in WATS-47 and follow-up issues

## Purpose

WATS-47 turns the WATS alpha operator path into an explicit CLI contract before the remaining runtime work lands. This document defines the target `@switchbord/cli` command surface, safety defaults, config/env precedence, side effects, error taxonomy, and test plan for alpha onboarding. The side-effect matrix below is the canonical quick scan for operator-visible reads, writes, network, and live behavior.

ADR-007 keeps this work in the existing WATS monorepo. The CLI composes `@switchbord/config` and `@switchbord/service`; it does not fork schema validation, duplicate service routing, or create a second repository.

## Scope ledger

Included:

- operator UX for `wats init`, `wats config validate`, `wats config print`, `wats config paths`, `wats doctor`, `wats openapi`, `wats serve`, and `wats webhook token`
- no live Meta calls by default
- env-secret references as the public secret model
- no overwrite by default for CLI-created files
- config discovery, profile selection, redaction, machine output, exit-code, and live-gate rules
- test expectations for the later behavior-bearing WATS-47 implementation
- dependency links to WATS-48, WATS-49, WATS-50, WATS-51, and WATS-52

Not included:

- implementing new CLI runtime behavior in this design slice
- live Meta validation or credentialed campaign execution
- persistence schema/adapters from WATS-48
- Docker/deployment artifacts from WATS-49
- config template implementation from WATS-50
- release automation from WATS-51
- community example expansion from WATS-52
- private GitHub repository creation or a second examples repository

## Command tree

```text
wats [global options] <command>

Global options:
  -h, --help
  --version
  --cwd <dir>
  --config <path>
  --profile <name>
  --format <text|json>
  --no-color
  --quiet
  --verbose

Commands:
  wats init [dir]
  wats config validate [path]
  wats config print
  wats config paths
  wats doctor
  wats openapi
  wats serve
  wats webhook token
```

The alpha default is credential-safe. Unless a command explicitly says otherwise, it reads config files, produces local output, and does not resolve secrets or contact Meta.

## Side-effect matrix

| Command | Reads config | Resolves env secret values | Reads `.env` | Writes files | Opens port | Calls Meta | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `wats --help` | no | no | no | no | no | no | static help only |
| `wats init --dry-run` | no | no | no | no | no | no | previews generated files |
| `wats init` | no | no | no | yes | no | no | writes templates with no overwrite by default |
| `wats config validate` | yes | no | no | no | no | no | uses `@switchbord/config` |
| `wats config print` | yes | no | no | optional explicit `--out` | no | no | redacted by default |
| `wats config paths` | optional | no | no | no | no | no | explains discovery without secrets |
| `wats doctor` | yes | no by default | no by default | no | no | no by default | offline diagnostics first |
| `wats openapi` | yes | no | no | optional explicit `--out` | no | no | WATS service OpenAPI only |
| `wats serve --dry-run` | yes | no | no | no | yes | no | synthetic local secrets + mock transport |
| `wats serve --live --yes-live` | yes | yes | only explicit `--env-file` | no | yes | not at startup by default | routes may send real messages after authenticated calls |
| `wats webhook token` | no | no | no | no | no | no | prints one generated secret to stdout by design |

## Config discovery and precedence

Working directory:

1. `--cwd <dir>`
2. process current working directory

Config file path:

1. `--config <path>`
2. `WATS_CONFIG`
3. first existing file under the working directory: `wats.config.yaml`, `wats.config.yml`, then `wats.config.json`
4. fail closed when a command requires config and no file is found

Profile selection:

1. `--profile <name>`
2. `WATS_PROFILE`
3. `defaultProfile` in the loaded config

Non-secret runtime overrides:

1. command flags such as `--host`, `--port`, and `--server-url`
2. documented WATS CLI meta environment variables such as `WATS_SERVICE_HOST`, `WATS_SERVICE_PORT`, and `WATS_LOG_LEVEL`
3. selected config profile
4. package defaults only for template generation, not for missing required runtime fields

Secret env-reference names come from the selected config profile only. Raw secret CLI arguments are not supported. `WATS_ACCESS_TOKEN` is used only when the config explicitly contains `auth.accessToken.env: WATS_ACCESS_TOKEN`.

Secret values are resolved only in live mode. Process environment wins over values loaded from an explicit `--env-file`; env files only supply missing values and duplicate keys fail closed.

## `wats init`

Target purpose: safe first-run project bootstrap.

```bash
wats init
wats init ./my-bot
wats init --dry-run
wats init --yes
wats init --format yaml
wats init --format json
wats init --profile local
wats init --config wats.config.yaml
wats init --env-file .env.local --generate-local-secrets
```

Target behavior:

- generate `wats.config.yaml` or `wats.config.json`
- generate `.env.example` with env names and placeholders
- optionally generate local verify/service tokens only when requested
- use env-secret references for every secret-bearing field
- no raw access tokens, app secrets, service bearer tokens, or WABA assets in generated config
- no overwrite by default; existing files fail with a safe output error
- `--dry-run` writes nothing and prints only a plan
- `--force` is not global; if added later, it must be limited to known WATS-generated files

Template config shape:

```yaml
version: 1
defaultProfile: local
profiles:
  local:
    graph:
      apiVersion: v21.0
      baseUrl: https://graph.facebook.com
    whatsapp:
      wabaId: replace-with-waba-id
      phoneNumberId: replace-with-phone-number-id
    auth:
      accessToken:
        env: WATS_ACCESS_TOKEN
    webhook:
      path: /webhook
      verifyToken:
        env: WATS_VERIFY_TOKEN
      appSecret:
        env: WATS_APP_SECRET
      maxBodyBytes: 1048576
    service:
      host: 127.0.0.1
      port: 3000
      apiPrefix: /v1
      bearerToken:
        env: WATS_SERVICE_TOKEN
```

## `wats config validate`, `print`, and `paths`

`wats config validate` remains credential-safe. It uses `@switchbord/config` and never resolves secret values.

```bash
wats config validate
wats config validate wats.config.yaml
wats config validate --config wats.config.yaml --profile local
wats config validate --check-env
wats config validate --format json
```

`--check-env` checks presence only. It does not print values. Env names remain redacted unless an explicit `--show-env-names` flag is added and documented.

`wats config print` prints a normalized, redacted config. It may show env names only under explicit `--show-env-names`; it never resolves values.

`wats config paths` explains how the CLI discovered config/profile inputs. It is for operator debugging and should redact profile names and unsafe paths by default.

## `wats doctor`

Target purpose: offline diagnostics first.

```bash
wats doctor
wats doctor --config wats.config.yaml
wats doctor --profile local
wats doctor --check-env
wats doctor --format json
wats doctor --live --yes-live
```

Default checks:

- supported Bun/Node runtime
- `@switchbord/cli` can import `@switchbord/config` and `@switchbord/service`
- config file is discovered, readable, and valid
- selected profile exists
- route paths do not collide with `/healthz`, `/readyz`, `/openapi.json`, or message routes
- OpenAPI can be generated locally
- env checks are skipped unless `--check-env` is set
- live checks are skipped unless `--live` and a live confirmation are present

`doctor` should aggregate safe findings rather than crash on the first expected issue.

## `wats openapi`

Target purpose: export WATS standalone service OpenAPI only.

`wats openapi` remains credential-free. It reads config and produces the OpenAPI document for `@switchbord/service`; it is not a Meta Graph OpenAPI exporter.

```bash
wats openapi --config wats.config.yaml
wats openapi --config wats.config.yaml --profile prod
wats openapi --config wats.config.yaml --server-url https://service.example
wats openapi --config wats.config.yaml --out openapi.json
```

Explicit `--out` uses exclusive-create writes and no overwrite by default.

## `wats serve`

Target purpose: process wrapper around `@switchbord/service`.

```bash
wats serve
wats serve --config wats.config.yaml
wats serve --profile local
wats serve --host 127.0.0.1 --port 3000
wats serve --dry-run
wats serve --live --yes-live
wats serve --live --env-file .env.local --yes-live
wats serve --print-routes
wats serve --once
```

Alpha default should be dry-run. Dry-run loads and validates config, starts the service with synthetic in-memory secrets and mock transport, exposes health/readiness/OpenAPI/webhook routes, and makes no live Meta calls.

Live mode requires:

1. `--live`
2. `--yes-live` or `WATS_LIVE_ENABLE=1`
3. a valid selected profile
4. resolved required env-secret values
5. no `--dry-run`

Even in live mode, startup should not call Meta unless a separately documented live check is requested. Authenticated message routes may send real WhatsApp messages once a service is running with live secrets, so startup output must clearly label side effects.

Local init defaults should bind to `127.0.0.1`. Binding `0.0.0.0` is a deployment choice and should be explicit in config or flags.

## `wats webhook token`

Target purpose: generate one local webhook verify token.

```bash
wats webhook token
wats webhook token --prefix wats_wh_
wats webhook token --bytes 32
```

The token is a secret and is printed to stdout by design. The command should not write files in alpha; file writes belong in `wats init` so overwrite behavior is consistent.

## Error taxonomy

Default exit codes:

- `0` success
- `1` expected usage/config/check failure
- `2` unexpected internal failure after redaction, if safely distinguishable
- `130` interrupted `serve`

Machine-readable JSON output uses a stable envelope:

```json
{
  "ok": false,
  "error": {
    "type": "CliUsageError",
    "code": "unknown_option",
    "message": "Unknown option. Run `wats --help` for usage."
  }
}
```

Named error families:

- `CliUsageError`: unknown command, unknown option, missing argument, invalid option value, invalid path
- `CliConfigError`: config not found, profile not found, discovery failure, route collision
- `ConfigValidationError`: forwarded from `@switchbord/config`
- `SecretResolutionError`: secret resolution disabled, missing env, invalid env, env-file errors
- `LiveGuardError`: live not enabled, confirmation required, live check failed, mutation blocked
- `OutputError`: output exists, output directory, write failed, unsafe output path
- `DoctorError`: runtime unsupported, package import failed, config/env/service/live check failed
- `ServeError`: bind failed, port in use, service start failed, shutdown failed
- `WatsServiceError`: forwarded from `@switchbord/service`

## Redaction policy

The CLI must never print raw access tokens, app secrets, webhook verify tokens, service bearer tokens, Graph Authorization headers, or `.env` values. Stack traces are hidden for expected user/config errors.

Default redaction markers:

- `[REDACTED_PROFILE]`
- `[REDACTED_ENV]`
- `[REDACTED_PATH]`
- `[REDACTED_SECRET]`
- `[REDACTED_TOKEN]`

Controlled disclosure:

- `--show-env-names` may show env variable names only
- `--verbose` may show safe static paths on success
- no alpha `--debug` mode should bypass the redactor

## Live guardrails

Every WATS-47 command is offline by default. Live mode requires an explicit flag and an explicit acknowledgement. No CI/docs/test command requires Meta credentials.

Forbidden in WATS-47:

- raw secrets as CLI arguments
- implicit `.env.local` reads in live mode
- live WABA mutations
- Docker/image publication
- release publication
- tests that require real credentials

## Package boundaries

`@switchbord/cli` owns parsing, operator output, safe file writes, env resolution, process lifecycle, and live confirmation gates.

`@switchbord/config` owns config schema validation, parsing, and redaction helpers.

`@switchbord/service` owns runtime-neutral Request/Response routing, route validation, webhook integration, authenticated message routes, and service OpenAPI generation.

`@switchbord/graph` owns Graph request construction and transport use. CLI tests use mock transport; they do not call Meta.

## Implementation sequencing

1. CLI foundation hardening: shared command context, global flags, JSON envelope, redactor.
2. Config discovery and print: `--config`, `WATS_CONFIG`, default filenames, `--profile`, `WATS_PROFILE`, `config print`, `config paths`.
3. Real `wats init`: templates, dry-run, no-overwrite, generated config validation.
4. Offline `wats doctor`: runtime/package/config/routes/OpenAPI/env-presence checks.
5. `wats serve` dry-run process wrapper: local bind, service routes, readiness smoke tests, graceful shutdown.
6. Secret resolver and live serve gate: explicit `--env-file`, `--live --yes-live`, no startup Graph call by default.
7. Docs and release hygiene: reference, guide, consumer fixture, changelog, release-policy updates.

## Follow-up dependencies

- WATS-48 should consume the `wats serve` lifecycle and `doctor` check model when adding SQLite/Postgres persistence.
- WATS-49 should package only the implemented `wats serve` contract and keep container builds credential-free.
- WATS-50 should turn the template contract into checked `wats.config.yaml` and `.env.example` artifacts.
- WATS-51 should classify CLI behavior changes as minor `0.x` release changes and design automation around the no-live default.
- WATS-52 should build community examples on the public commands that actually exist.

## Test plan

Design/docs lock:

- `packages/testing/tests/wats47-cli-operator-ux-docs.test.ts`
- public docs manifest includes this design doc and the CLI onboarding guide
- docs check/build must remain credential-free

Future implementation tests:

- `packages/cli/tests/init.test.ts`: dry-run, template shape, no overwrite, env references only, generated config validates
- `packages/cli/tests/doctor.test.ts`: offline default, safe env presence checks, no secret values, live gate fail-closed
- `packages/cli/tests/serve.test.ts`: local bind, dry-run service routes, graceful shutdown, no startup Meta call, safe failure output
- `packages/testing/tests/cli-consumer.test.ts`: package-specifier import of public helpers/types and command help surfaces

WATS-47 is ready only after targeted CLI tests, docs-lock tests, `bun run typecheck`, `bun run docs:check`, and a final no-edit review pass are green.
