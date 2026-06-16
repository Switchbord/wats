# WATS service image for Railway (and any Docker host).
#
# wats is a Bun-target build (extensionless ESM imports resolved by Bun, not
# Node), so the runtime MUST be Bun. Multi-stage: install + build packages in a
# builder, then copy the built tree into a lean runtime image.
#
# Railway auto-detects this file (capital "Dockerfile") at the repo root.
# Strip Railway support by deleting this file and deploy/railway/.

# ---- builder ----
FROM oven/bun:1.3.13 AS builder
WORKDIR /app

# Install deps first for layer caching.
COPY package.json bun.lock* bunfig.toml* tsconfig*.json ./
COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY examples/ ./examples/
# The root package.json declares "site" as a Bun workspace member, so a
# frozen-lockfile install fails ("Workspace not found \"site\"") unless the
# member's manifest exists. The service image does NOT build the docs site, so
# copy ONLY site/package.json (the manifest) to satisfy workspace resolution
# without pulling the whole site tree. If you add another root workspace member,
# its package.json must be copied here too (or the Railway build breaks silently).
COPY site/package.json ./site/package.json
RUN bun install --frozen-lockfile || bun install

# Build all publishable packages (produces packages/*/dist).
RUN bun run build:packages

# ---- runtime ----
FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    WATS_SERVE_MODE=dry-run \
    WATS_CONFIG=/app/deploy/railway/wats.config.yaml

# Copy the built monorepo (dist + node_modules + package manifests).
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY deploy/ ./deploy/

RUN chmod +x /app/deploy/railway/entrypoint.sh

# Railway injects PORT; default 8080 for local docker runs.
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/app/deploy/railway/entrypoint.sh"]
