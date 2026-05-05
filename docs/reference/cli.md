# CLI reference

- status: experimental
- applies-to: WATS-33, WATS-47, and WATS-69
- package: `@switchbord/cli`
- lastReviewed: 2026-05-04

`@switchbord/cli` provides the `wats` command for safe local onboarding and inspection. WATS-33 ships real offline config validation and OpenAPI export. WATS-69 adds safe `wats init` config/env placeholder generation. `doctor` and `serve` remain planned/help-only surfaces until their runtime slices land.

## No-live-credentials default

The CLI does not read Meta access tokens, app secrets, service bearer tokens, `.env.local`, or live credential values by default. It does not call Meta Graph APIs by default. Config commands read WATS config files only; config secret fields remain env-secret references and are never resolved.

Do not paste production access tokens or app secrets into CLI arguments. Unknown arguments fail closed and intentionally do not echo user-supplied path-like or token-like values.

## Implemented commands

### `wats --help`

Prints top-level help and exits 0.

### `wats init [dir] [--dry-run] [--format yaml|json] [--profile <name>]`

Generates `wats.config.yaml` / `wats.config.json` plus `.env.example` placeholder files for local onboarding. The command uses env-secret references only, refuses to overwrite existing files, and never resolves live credentials or reads `.env.local`.

Default behavior:

```bash
wats init
wats init ./my-bot --format yaml --profile local
wats init ./my-bot --format=json --profile prod
```

`--dry-run` previews a count-oriented summary without writing files:

```text
init dry-run
files: 2
format: yaml
profile: [REDACTED_PROFILE]
```

Success output is similarly redacted and does not print target paths, profile names, or env-secret reference names. Generated `.env.example` values are blank except non-secret live-gate defaults (`WATS_LIVE_ENABLE=0`, `WATS_YES_LIVE=0`).

Failure behavior:

- unknown flags, duplicate flags, unsafe paths, unsupported formats, and unsafe profile names fail closed;
- existing `wats.config.*` or `.env.example` targets fail with `refusing to overwrite`;
- diagnostics do not echo attacker-supplied paths or token-like values;
- no raw secrets are generated.

### `wats onboarding --public-url <https URL> [--webhook-path /webhooks/whatsapp]`

Prints an operator-facing onboarding checklist for Meta webhook setup. The command accepts the public HTTPS base URL for the WATS service or tunnel, combines it with the configured webhook path, and prints the callback address to paste into Meta App Dashboard > WhatsApp > Configuration.

Example:

```bash
wats onboarding --public-url https://example.test/wats
wats onboarding --public-url https://example.test --webhook-path /webhooks/whatsapp
```

Output includes:

- `webhook callback address: https://example.test/wats/webhooks/whatsapp`
- a locally generated `WATS_VERIFY_TOKEN` for Meta webhook verification;
- a locally generated `WATS_SERVICE_TOKEN` for protected WATS service routes;
- user-side values to copy from Meta/WhatsApp: `WATS_ACCESS_TOKEN`, `WATS_APP_SECRET`, `WATS_WABA_ID`, and `WATS_PHONE_NUMBER_ID`.

The generated tokens are printed to stdout only. The command does not write files, read `.env.local`, resolve existing environment secrets, or call Meta Graph APIs. `--public-url` must be HTTPS, cannot include raw whitespace, credentials, query strings, or fragments, and `--webhook-path` must be an absolute safe path with no traversal segments.

### `wats config validate <path>`

Loads and validates a JSON/YAML WATS config file through `@switchbord/config` and exits 0 when valid.

Equivalent alias:

```bash
wats config validate --config <path>
```

Success output is intentionally safe and count-oriented:

```text
config valid
default profile: [REDACTED_PROFILE]
profiles: 2
```

The command does not print profile names, env-secret reference names such as `WATS_ACCESS_TOKEN`, or any raw token values.

Failure behavior:

- exits 1
- prints `ConfigValidationError`
- prints code, path, and safe message
- never prints stack traces
- sanitizes file-read errors so attacker-supplied paths are not echoed
- redacts dynamic profile-name path segments in validation paths and uses generic profile-validation messages

### `wats doctor --help`

Prints planned offline diagnostics help and exits 0. The current command performs no environment inspection, network access, credential validation, or file writes.

### `wats openapi --config <path>`

Loads a WATS config and prints OpenAPI 3.1 JSON for the current WATS standalone service API.

Default behavior:

```bash
wats openapi --config wats.config.json
```

- uses the config `defaultProfile`
- prints JSON to stdout
- does not create files
- does not resolve env-secret references
- does not describe the full Meta Graph API

Options:

```bash
wats openapi --config wats.config.json --profile prod
wats openapi --config wats.config.json --server-url https://service.example
wats openapi --config wats.config.json --out openapi.json
```

`--profile <name>` selects a named config profile. Missing or blank profiles fail closed.

`--server-url <url>` must be an `http:` or `https:` URL accepted by `@switchbord/service`; query strings and fragments are stripped by the generator.

`--out <path>` writes JSON only when explicit. The CLI refuses to overwrite existing files. Empty paths, directories, control characters, NUL, backslashes, and `.` / `..` path segments are rejected. Relative paths resolve under the current working directory.

Failure behavior:

- config parse/validation errors use the `ConfigValidationError` safe format
- service OpenAPI option/profile errors use `WatsServiceError` safe format
- explicit `--out` writes use exclusive create semantics and refuse existing targets
- unexpected host errors collapse to a generic safe usage hint
- attacker-supplied values are not echoed

### `wats openapi --help`

Prints OpenAPI export help and exits 0. OpenAPI export remains service-only: it describes the WATS standalone service API, not Meta Graph.

### `wats serve --help`

Prints service-runtime handoff help and exits 0. WATS-33 does not start a process/server; the current runtime-neutral app remains available programmatically through `@switchbord/service`.

WATS-49 deployment note: Docker packaging must target implemented `wats serve`, not this help-only handoff. The current CLI does not start a server process.

### `wats webhook token`

Prints one freshly generated verify token and exits 0. The token has a `wats_wh_` prefix and is generated from Web Crypto random bytes when available, with a `crypto.randomUUID()` fallback for compatible runtimes.

The command writes only to stdout. It does not create, update, or overwrite files.

### `wats webhook token --help`

Prints safe token-generation help and exits 0.

## WATS-47 design target

Design-only note: this section records the WATS-47 alpha CLI target. It is not an implementation claim until matching command tests and consumer fixtures land.

Target command examples:

```bash
wats init [dir]
wats init --dry-run
wats init --format yaml --profile local
wats config validate --config wats.config.yaml --profile local
wats config print --redacted
wats config paths
wats doctor --config wats.config.yaml --profile local
wats doctor --check-env
wats serve --config wats.config.yaml --profile local --host 127.0.0.1 --port 3000
wats serve --dry-run
wats serve --live --yes-live --env-file .env.local
wats openapi --config wats.config.yaml --out openapi.json
wats webhook token
```

WATS-47 target rules:

- `wats init` writes `wats.config.yaml` or `wats.config.json` and `.env.example` only with explicit command intent.
- Generated configs use env-secret references rather than embedded secret values.
- All CLI file creation uses no overwrite by default.
- `wats doctor` is offline by default and reports env variable presence by name/presence only.
- `wats serve` wraps `@switchbord/service` and starts in dry-run/mock mode by default for alpha.
- Credential-gated live validation requires explicit live flags and an acknowledgement.
- The phrase credential-gated live validation means the CLI requires both a live flag and an operator acknowledgement before any live check can run.
- There are no live Meta calls by default, and no command prints raw secrets.
- `@switchbord/cli` composes `@switchbord/config` for schema validation and `@switchbord/service` for routing/OpenAPI; it does not duplicate either package.

See `docs/architecture/wats47-cli-operator-ux-design.md` for the full design.

## Error behavior

Unknown commands and unsupported flags fail closed with exit code 1 and a generic usage hint. User-supplied path-like or secret-like values are not echoed in diagnostics.

WATS-47 target error families include `CliUsageError`, `CliConfigError`, `ConfigValidationError`, `SecretResolutionError`, `LiveGuardError`, `OutputError`, `DoctorError`, `ServeError`, and `WatsServiceError`.

## Still planned

Future implementation work may add:

- deeper `wats doctor` diagnostics for runtime/package/config health;
- a real `wats serve` process wrapper;
- optional live checks behind explicit credential-gated flags.

Those planned commands must keep the no-live-credentials default unless a user explicitly opts into live validation.
