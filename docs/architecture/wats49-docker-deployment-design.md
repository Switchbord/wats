# WATS-49 Docker/deployment design

- status: design
- applies-to: WATS-49
- lastReviewed: 2026-05-01
- owner: Linear roadmap; Linear remains the source of truth for issue-level scope and deferrals

## Purpose

WATS-49 defines the Docker/deployment scaffold target for WATS alpha. It is design/docs/test-planner only. It does not add a supported container image, root Dockerfile, compose.yaml, registry workflow, or release automation.

ADR-007 keeps deployment scaffolding in the WATS monorepo. There is no second repository for Docker examples, deployment docs, templates, or alpha runtime packaging during this phase.

## Scope ledger

Included:

- future container contract around `wats serve`
- dependency on an implemented serve contract
- health/readiness route expectations for `/healthz` and `/readyz`
- OpenAPI route expectation for `/openapi.json`
- Bun-first container target
- non-root runtime requirements
- explicit port and bind behavior
- SIGTERM graceful shutdown expectations
- env-secret reference and no-secret-image policy
- no secrets baked into images
- future container smoke-test plan

Not included:

- no root Dockerfile
- no compose.yaml
- no docker-compose.yml
- no image build
- no image publication
- no registry credentials
- no release automation
- no live Meta calls
- no Docker daemon requirement in CI
- no second repository

## Phase split

WATS-49A, this design slice:

- documents the deployment contract
- publishes a Docker deployment guide as a non-runnable scaffold
- adds docs-lock coverage
- does not add supported container artifacts

WATS-49B, after real `wats serve` exists:

- may add a Dockerfile
- may add a compose.yaml
- may add a .dockerignore
- may add container build/smoke tests
- must keep builds credential-free

Docker packaging must not precede the real `wats serve` process contract. A Dockerfile that can only run `wats serve --help` would be misleading.

## Future container contract

A supported image should wrap the CLI process runner, not duplicate service routing:

```sh
wats serve --config /app/config/wats.config.yaml --profile prod --host 0.0.0.0 --port 3000
```

For live operation, the future command still needs the WATS live gate:

```sh
wats serve --config /app/config/wats.config.yaml --profile prod --host 0.0.0.0 --port 3000 --live --yes-live
```

Startup should not call Meta by default. Even in live mode, any explicit live reachability check must be separately documented and gated.

## Runtime target

The first alpha container target should be Bun-first because the monorepo is currently Bun-tested and package exports remain source-first TypeScript. Node images should wait until Node-compatible CLI/runtime process tests and package build outputs exist.

## Health, readiness, and OpenAPI

Future container health contracts:

- `/healthz` is liveness: process is alive and route handling works
- `/readyz` is readiness: service is ready for configured local routes
- `/openapi.json` serves WATS service OpenAPI

Do not claim that `/readyz` verifies Meta credentials, database connectivity, migrations, or webhook reachability until those checks are implemented.

A future Docker healthcheck should call a local route and must not include secrets:

```Dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:3000/healthz'); process.exit(r.ok ? 0 : 1)"
```

## Ports and bind behavior

Containers bind to `0.0.0.0` inside the container only by explicit config/flag. Host exposure should remain explicit in Docker/Compose examples.

Default documented port: `3000`.

Local examples should prefer loopback host mapping such as `127.0.0.1:3000:3000` unless documenting a reverse-proxy/TLS setup.

## Secrets and environment

No secrets baked into images:

- no Meta access token
- no app secret
- no webhook verify token
- no service bearer token
- no database URL
- no Authorization header values

Config files should use env-secret references. Runtime platforms inject values through environment or secret-manager features.

Future `.dockerignore` must exclude `.env`, `.env.*`, local generated config, `.git`, `node_modules`, build/cache/log output, coverage, and test artifacts unless explicitly safe.

## Non-root runtime

Future images should run as a non-root runtime user, expose a high port, avoid privileged mode, and avoid Docker socket mounts.

Recommended hardening for future Compose/Kubernetes examples:

- non-root user
- read-only root filesystem where practical
- tmpfs for `/tmp`
- no-new-privileges
- dropped Linux capabilities
- no host networking by default

## Persistence and volumes

Current WATS has no persistence runtime. WATS-48 is design-only.

Future SQLite deployment must use an explicit writable data directory, such as `/var/lib/wats`, owned by the non-root runtime user. SQLite should remain a single-instance/local target.

Future multi-replica deployment should use Postgres once the adapter exists. Do not publish a multi-replica SQLite example.

## Shutdown

Future containers must handle SIGTERM and SIGINT as expected shutdown signals. `wats serve` should gracefully shutdown route handling, stop workers, close persistence if present, and avoid stack traces for normal shutdown.

## Registry and release boundary

WATS-49 does not publish images. There are no registry credentials, no `docker login`, no GHCR workflow, no SBOM/provenance claim, and no signing claim in this design slice.

Image publication and release automation belong to WATS-51 or a later explicitly authorized release issue.

## Test plan

Design/docs lock:

- `packages/testing/tests/wats49-docker-deployment-docs.test.ts`
- public docs manifest includes this design and the Docker deployment guide
- tests assert no supported root Dockerfile, compose.yaml, or docker-compose.yml exists in the design slice

Future implementation tests:

- static Dockerfile and .dockerignore checks
- static Compose checks
- image build without WATS secrets
- container smoke: `/healthz`, `/readyz`, `/openapi.json`
- no live Meta calls during build/test/startup
- non-root runtime assertion
- fake-secret log redaction assertion
- graceful SIGTERM shutdown smoke
