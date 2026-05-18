# Docker Deployment Guide

- status: design/scaffold
- applies-to: WATS-49
- lastReviewed: 2026-05-01

## Current implementation status

`wats serve --config <path> --dry-run` is implemented for local Bun smoke checks. There is still no supported root Dockerfile, no supported Compose file, no credential-gated live serve mode, no container image release, and no container-registry workflow in WATS today.

This guide is the WATS-49 deployment contract scaffold. It documents the shape future Docker artifacts should take around the implemented serve contract once live/deploy packaging is explicitly authorized.

## Safety defaults

- no live Meta calls during build
- no live Meta calls during tests
- no secrets baked into images
- no registry credentials in normal CI
- no image publication in this slice
- env-secret references only
- do not commit `.env`
- do not pass raw secrets as CLI arguments

## Future Dockerfile shape

This is the future Dockerfile shape for WATS-49.

A future Bun-first Dockerfile should follow this pattern after credential-gated live serve packaging lands:

```Dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
RUN addgroup --system --gid 10001 wats && adduser --system --uid 10001 --ingroup wats wats
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:3000/healthz'); process.exit(r.ok ? 0 : 1)"
CMD ["bun", "run", "wats", "serve", "--config", "/app/config/wats.config.yaml", "--profile", "prod", "--host", "0.0.0.0", "--port", "3000"]
```

This is not a supported root Dockerfile. It is a future shape only.

## Future compose.yaml shape

This is the future compose.yaml shape for WATS-49.

A future compose file should inject runtime environment values rather than baking secrets into the image:

```yaml
services:
  wats:
    image: wats:local
    command:
      - wats
      - serve
      - --config
      - /app/config/wats.config.yaml
      - --profile
      - prod
      - --host
      - 0.0.0.0
      - --port
      - "3000"
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      WATS_ACCESS_TOKEN: ${WATS_ACCESS_TOKEN:?set outside repo}
      WATS_VERIFY_TOKEN: ${WATS_VERIFY_TOKEN:?set outside repo}
      WATS_APP_SECRET: ${WATS_APP_SECRET:?set outside repo}
      WATS_SERVICE_TOKEN: ${WATS_SERVICE_TOKEN:?set outside repo}
    volumes:
      - ./wats.config.yaml:/app/config/wats.config.yaml:ro
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

This is not a supported Compose file. It is a future shape only.

## Healthcheck and readiness

Use local service routes:

- `/healthz` for liveness
- `/readyz` for readiness
- `/openapi.json` for service OpenAPI smoke checks

Do not put tokens in a healthcheck. Do not make a healthcheck call Meta Graph.

## Env-secret references

Config should refer to env names, not secret values:

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

Future Postgres deployment should use an env-secret reference such as `WATS_DATABASE_URL`; database URLs are secrets and must not be printed in logs.

## Volumes and persistence

Current WATS has no persistence runtime. Future SQLite examples should mount a writable data directory such as `/var/lib/wats` and document that SQLite is for local/single-instance operation. Future multi-replica deployments should use Postgres once the adapter exists.

## Non-root runtime

Future container artifacts should run as a non-root user, bind a high port, avoid privileged mode, and avoid Docker socket mounts. The app source should be read-only where practical.

## Future smoke checks

After a real Dockerfile exists, credential-free smoke checks should:

```sh
docker build -t wats:local .
docker run --rm -p 127.0.0.1:3000:3000 wats:local
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/readyz
curl -fsS http://127.0.0.1:3000/openapi.json
```

These are future commands only. WATS-49 design docs do not require Docker in CI.

## Related

- `docs/guides/deploy-docker.md`
- `docs/reference/cli.md`
- `docs/reference/service.md`
- `docs/reference/persistence.md`
