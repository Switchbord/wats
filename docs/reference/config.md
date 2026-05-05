# Config Reference (`@switchbord/config`)

- status: experimental
- applies-to: WATS-32
- lastReviewed: 2026-04-28

## Purpose

`@switchbord/config` defines the first WATS application config shape for CLI onboarding and the future standalone service. It validates YAML or JSON config into a frozen `WatsConfig` object and keeps secrets as environment-variable references rather than raw credential values.

## Install / import

```ts
import {
  loadConfig,
  parseConfig,
  validateConfig,
  redactConfig,
  ConfigValidationError
} from "@switchbord/config";
```

## Config shape

```yaml
version: 1
defaultProfile: local
profiles:
  local:
    graph:
      apiVersion: v21.0
      baseUrl: https://graph.facebook.com
    whatsapp:
      wabaId: "1234567890"
      phoneNumberId: "9876543210"
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
      host: 0.0.0.0
      port: 3000
      apiPrefix: /v1
      bearerToken:
        env: WATS_SERVICE_TOKEN
```

JSON uses the same object shape.

## WATS-51 checked templates

WATS-51 adds checked-in alpha templates with placeholder env names only:

- `examples/config/wats.config.example.yaml`
- `examples/config/wats.config.example.json`
- `.env.example`

The YAML and JSON templates parse through `@switchbord/config` and use the same validated shape shown above. They include `local` and `prod` profiles, placeholder WABA/phone ids, env-secret refs for all secret-bearing fields, service routing defaults, and no raw tokens. `.env.example` lists placeholder env names only; copy it to an ignored local file such as `.env.local` before filling real values.

These templates are also available through `wats init` as of WATS-69. The command writes config/env placeholder files with no overwrite by default and keeps secret-bearing `.env.example` values blank.

## Secret model

Secrets are not represented as raw values. Every secret-bearing field must be an object with an `env` string:

```ts
{ env: "WATS_ACCESS_TOKEN" }
```

The following fields are secret references:

- `auth.accessToken`
- `webhook.verifyToken`
- `webhook.appSecret`
- `service.bearerToken`

Raw strings in these positions are rejected with `ConfigValidationError` code `invalid_env_ref`.

## API

### `validateConfig(value)`

Validates an unknown in-memory value and returns a frozen `WatsConfig`.

Throws `ConfigValidationError` for malformed input. Host `TypeError` should not escape for expected bad input.

### `parseConfig(source, options?)`

Parses a config string as JSON or YAML and then validates it.

```ts
const config = parseConfig(source, { format: "yaml" });
```

If `format` is omitted, JSON is inferred when the string starts with `{` or `[`; otherwise YAML is assumed.

YAML support in WATS-32 is intentionally small and dependency-free. It supports the generated onboarding mapping shape; full YAML language coverage is not a goal for this slice.

### `loadConfig(filePath, options?)`

Reads a `.json`, `.yaml`, or `.yml` file and returns validated config.

```ts
const config = await loadConfig("./wats.config.yaml");
```

Unsupported extensions fail with `unsupported_format`. Read failures fail with `file_read_error`.

### `redactConfig(value)`

Validates and returns a copy where all env names under secret references are replaced with `[REDACTED_ENV]`. Non-secret fields remain visible.

Use this for logs, diagnostics, and `wats config print`-style output.

## Validation rules

| Field | Rule |
| --- | --- |
| `version` | Must be exactly `1`. |
| `defaultProfile` | Non-empty string and must exist in `profiles`. |
| `profiles` | Object map of profile names to profile configs. |
| `graph.apiVersion` | Must match `vNN.N`, for example `v21.0`. |
| `graph.baseUrl` | Absolute `http:` or `https:` URL. |
| `whatsapp.wabaId` | Non-empty string; no CR/LF/NUL. |
| `whatsapp.phoneNumberId` | Non-empty string; no CR/LF/NUL. |
| secret env names | Non-empty string; no CR/LF/NUL. |
| `webhook.path` | Absolute safe path with at least one segment; rejects traversal and control chars. |
| `webhook.maxBodyBytes` | Integer `1..10_485_760`; defaults to `1_048_576`. |
| `service.host` | Non-empty string; no CR/LF/NUL. |
| `service.port` | Integer `1..65_535`. |
| `service.apiPrefix` | Absolute safe path with at least one segment. |

## Error taxonomy

`ConfigValidationError` fields:

- `code: ConfigErrorCode`
- `path: string`
- `issues: ConfigIssue[]`

Primary codes:

- `invalid_config`
- `invalid_source`
- `parse_error`
- `unsupported_format`
- `file_read_error`
- `invalid_version`
- `missing_default_profile`
- `invalid_profiles`
- `invalid_profile`
- `invalid_graph`
- `invalid_api_version`
- `invalid_base_url`
- `invalid_whatsapp`
- `invalid_env_ref`
- `invalid_webhook`
- `invalid_webhook_path`
- `invalid_max_body_bytes`
- `invalid_service`
- `invalid_service_host`
- `invalid_service_port`
- `invalid_service_api_prefix`

## Live testing profile

Use env-secret refs for any credentialed campaign profile. Do not place raw tokens in config files:

```yaml
version: 1
defaultProfile: live-test
profiles:
  live-test:
    graph:
      apiVersion: v21.0
      baseUrl: https://graph.facebook.com
    whatsapp:
      wabaId: "${WATS_WABA_ID_FROM_ENV_OR_SECRET_STORE}"
      phoneNumberId: "${WATS_PHONE_NUMBER_ID_FROM_ENV_OR_SECRET_STORE}"
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
      host: 0.0.0.0
      port: 3000
      apiPrefix: /v1
      bearerToken:
        env: WATS_SERVICE_TOKEN
```

The WATS-44 live campaign also requires runtime env flags such as `WATS_LIVE_ENABLE=1` and domain-specific mutation opt-ins. Keep those outside checked-in config examples.

## WATS-48 persistence config design note

WATS-48 is design-only. The current @switchbord/config schema has no persistence field.

A future persistence config may introduce SQLite local paths and Postgres database URL env-secret references such as `WATS_DATABASE_URL`. Raw database credentials must not be committed, printed, or passed as CLI arguments; in lowercase, raw database credentials must not be committed. Config examples should keep database URLs as env-secret refs rather than raw credential-bearing strings.

## Non-goals

WATS-32/WATS-48 do not implement:

- CLI file generation (`WATS-33`)
- standalone service runtime (`WATS-34`)
- live Graph credential checks
- secret storage, encryption, or vault integration
- full YAML language support

## Related

- Linear: WATS-32
- `docs/architecture/cli-service-openapi-options.md`
- `docs/architecture/roadmap-to-whatsapp-pywa-parity.md`
