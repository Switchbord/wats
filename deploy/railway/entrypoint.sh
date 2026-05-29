#!/usr/bin/env bash
# WATS Railway entrypoint.
#
# Railway injects PORT at runtime and requires binding 0.0.0.0. The wats CLI
# reads host/port from the config profile, so this shim maps the platform
# environment onto explicit `wats serve` flags. Fork-friendly: delete this file
# and the Dockerfile to strip the Railway integration; nothing in the SDK
# packages depends on it.
#
# Required env (set in the Railway service variables UI, never in git):
#   PORT                 - injected by Railway (fallback 8080 for local runs)
#   WATS_CONFIG          - path to wats.config.yaml inside the image (default below)
#   WATS_SERVE_MODE      - "dry-run" (default, no creds) or "live"
# Live mode additionally requires (Railway variables):
#   WATS_ACCESS_TOKEN WATS_APP_SECRET WATS_VERIFY_TOKEN WATS_SERVICE_TOKEN
#   WATS_WABA_ID WATS_PHONE_NUMBER_ID
set -euo pipefail

HOST="${WATS_HOST:-0.0.0.0}"
PORT="${PORT:-8080}"
CONFIG="${WATS_CONFIG:-/app/deploy/railway/wats.config.yaml}"
MODE="${WATS_SERVE_MODE:-dry-run}"

echo "wats-railway: mode=${MODE} host=${HOST} port=${PORT} config=${CONFIG}"

# The committed config carries placeholder whatsapp ids (wabaId/phoneNumberId)
# because those are not env-secret-ref capable in the config schema. In live
# mode the real ids must come from the Railway env, so materialize a runtime
# copy of the config with the placeholders replaced. (These ids are not secrets,
# but keeping them out of the committed file avoids hardcoding account state.)
if [ -n "${WATS_PHONE_NUMBER_ID:-}" ] || [ -n "${WATS_WABA_ID:-}" ]; then
  RUNTIME_CONFIG="$(dirname "${CONFIG}")/wats.runtime.yaml"
  cp "${CONFIG}" "${RUNTIME_CONFIG}"
  if [ -n "${WATS_PHONE_NUMBER_ID:-}" ]; then
    sed -i "s/phoneNumberId:.*/phoneNumberId: \"${WATS_PHONE_NUMBER_ID}\"/" "${RUNTIME_CONFIG}"
  fi
  if [ -n "${WATS_WABA_ID:-}" ]; then
    sed -i "s/wabaId:.*/wabaId: \"${WATS_WABA_ID}\"/" "${RUNTIME_CONFIG}"
  fi
  CONFIG="${RUNTIME_CONFIG}"
  echo "wats-railway: materialized runtime config with env whatsapp ids"
fi

if [ "${MODE}" = "live" ]; then
  # The CLI's --env-file is validated by isSafeServeEnvFile: it must be a
  # RELATIVE path (no leading "/"), resolved against the config directory, with
  # a leaf of ".env.local" or "*.env". So write ".env.local" next to the config
  # and pass the bare relative name. Never bake secrets into the image layers.
  CONFIG_DIR="$(dirname "${CONFIG}")"
  ENV_FILE="${CONFIG_DIR}/.env.local"
  trap 'rm -f "${ENV_FILE}"' EXIT
  ( umask 077
    {
      for k in WATS_ACCESS_TOKEN WATS_APP_SECRET WATS_VERIFY_TOKEN \
               WATS_SERVICE_TOKEN WATS_WABA_ID WATS_PHONE_NUMBER_ID; do
        if [ -n "${!k:-}" ]; then printf '%s=%s\n' "$k" "${!k}"; fi
      done
    } > "${ENV_FILE}"
  )
  exec bun /app/packages/cli/dist/bin.js serve \
    --config "${CONFIG}" --host "${HOST}" --port "${PORT}" \
    --live --yes-live --env-file .env.local
fi

exec bun /app/packages/cli/dist/bin.js serve \
  --config "${CONFIG}" --host "${HOST}" --port "${PORT}" --dry-run
