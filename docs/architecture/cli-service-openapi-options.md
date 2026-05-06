# CLI, Service, Config, and OpenAPI Options

- status: proposed
- lastReviewed: 2026-04-28

## Goal

Make WATS adoptable as both a library and an operations backbone:

- install via package manager
- initialize safely with a CLI
- generate YAML or JSON config
- run a standalone webhook/API service
- inspect API behavior through OpenAPI 3.1
- keep SDK internals portable and maintainable

## Recommendation

Add three app-layer packages above the current foundation:

```text
@switchbord/config   config schema, YAML/JSON loading, env-secret references
@switchbord/service  standalone webhook/API service, OpenAPI 3.1
@switchbord/cli      onboarding, validation, doctor, serve, openapi commands
```

Use Zod only at application boundaries: config, CLI inputs, service REST payloads, and OpenAPI schema generation. Do not retrofit Zod into low-level graph/http/core validation unless a later feature has a specific reason.

## Config package

Default generated file: `wats.config.yaml`.

Also support JSON for automation.

Example:

```yaml
version: 1
defaultProfile: default

profiles:
  default:
    graph:
      apiVersion: v25.0
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

Generated `.env.local` should contain placeholders or generated local tokens, never live Meta credentials.

## CLI package

Recommended command set:

```bash
wats init
wats config validate
wats config print
wats doctor
wats serve
wats dev
wats openapi print
wats openapi write
wats webhook token
```

Default behavior should be credential-safe. Live Graph checks require explicit `--live` or a similar opt-in flag.

Recommended libraries:

- `commander` for command parsing
- `@clack/prompts` or `@inquirer/prompts` for interactive onboarding
- `yaml` for YAML support
- boundary-only `zod` for validation

Keep the CLI Node-compatible and Bun-compatible. Ship a `wats` bin from `@switchbord/cli`; optionally add a future `create-wats` alias for `npm create wats` / `bun create wats`.

## Service package

The service should be an embeddable Web-standard app plus runtime adapters.

Recommended routes for first service release:

- `GET /healthz`
- `GET /readyz`
- `GET /webhook`
- `POST /webhook`
- `POST /v1/messages/text`
- `POST /v1/messages`
- `GET /openapi.json`
- `GET /docs`

All non-webhook API routes should require service auth by default.

Recommended framework: Hono.

Why Hono:

- small
- Web-standard `Request` / `Response`
- Bun and Node friendly
- works with Workers-style runtimes
- does not force WATS low-level packages into a server framework

Alternatives:

- Fastify: mature Node ecosystem, less portable.
- Elysia: excellent Bun DX, less suitable for Node/package-manager neutrality.
- Hand-rolled fetch router: smallest dependency footprint, more custom maintenance and weaker OpenAPI ergonomics.

## OpenAPI 3.1

Generate OpenAPI 3.1 for the WATS standalone service only. Do not attempt to model the full Meta Graph API as WATS OpenAPI in the first pass.

Recommended outputs:

- `GET /openapi.json`
- `GET /docs` rendered by Scalar
- committed or generated `openapi/wats-service.openapi.json`

Recommended renderer:

- Scalar for modern OpenAPI references
- Swagger UI only as a fallback
- Redocly CLI can still be useful for linting/bundling, but classic Redoc should not be the default if OpenAPI 3.1 fidelity matters

Schema generation:

- Prefer `zod-openapi` or `@asteasolutions/zod-to-openapi` after verifying OpenAPI 3.1 output in CI.
- If route tooling emits only OpenAPI 3.0 cleanly, generate OpenAPI separately from shared Zod schemas.

## Docs site

Recommended stack for a public docs site:

- Starlight for polished docs/search/navigation
- TypeDoc for package API docs
- Scalar for service REST API docs from OpenAPI

VitePress is a good lower-ceremony alternative. Docusaurus is powerful but heavier; choose it only if versioned docs/i18n/plugin needs are immediate.

## Publish path

Current packages are private and export `src/*.ts`; that is fine for local Bun workspace development but not for registry release.

Before first public package release:

- add build output under `dist`
- change publishable package exports to `dist`
- emit `.d.ts`
- add package smoke tests from a temp consumer
- keep root package private
- publish `@switchbord/internal-utils` only when required by public runtime packages; keep `@switchbord/testing` private
- add Changesets or an equivalent release manager

## Implementation order

1. Repo hygiene, release policy, README, docs drift cleanup.
2. Linear roadmap for 100% WhatsApp/pywa coverage.
3. `@switchbord/config`.
4. `@switchbord/cli` init/validate/doctor.
5. `@switchbord/service` webhook + text send + auth.
6. OpenAPI 3.1 generation and Scalar docs.
7. Publishable package build and CI.
8. switchbord GitHub repo creation and first release push.

## Key tradeoff

Do not let the service/CLI turn WATS into a monolith. The service should prove the packages are composable. The packages should remain useful when developers bring their own server, queue, database, workers, or observability stack.
