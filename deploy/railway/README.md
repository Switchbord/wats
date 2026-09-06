# Deploy WATS on Railway

A container deployment of the `@wats/service` app via the `wats serve` CLI.
Railway gives every service a public HTTPS domain, which is exactly what Meta's
WhatsApp webhook callback requires — no ngrok tunnel needed.

Fork-friendly: delete `Dockerfile`, `railway.json`, and `deploy/railway/` to
strip Railway support. Nothing in the SDK packages depends on these files.

## What ships

- `Dockerfile` (repo root) — Bun multi-stage build; Railway auto-detects it.
- `railway.json` (repo root) — config-as-code: Dockerfile builder + `/healthz` healthcheck.
- `deploy/railway/entrypoint.sh` — maps Railway's `$PORT` onto `wats serve --host 0.0.0.0 --port $PORT`.
- `deploy/railway/wats.config.yaml` — a `0.0.0.0`-binding service profile with env-secret refs.

## Modes

- `WATS_SERVE_MODE=dry-run` (default) — synthetic in-memory secrets, no live Meta
  calls. Safe for verifying the deploy, healthcheck, and routing.
- `WATS_SERVE_MODE=live` — resolves real credentials from the service env and
  uses the fetch-backed Graph transport. The entrypoint synthesizes a temp
  env-file to satisfy the CLI's `--live --yes-live --env-file` guard.

## Required Railway service variables (live mode)

Set these in the Railway service Variables UI — never commit them:

    WATS_ACCESS_TOKEN       # Meta WhatsApp access token
    WATS_APP_SECRET         # Meta app secret (webhook HMAC)
    WATS_VERIFY_TOKEN       # webhook verify token (you choose this)
    WATS_SERVICE_TOKEN      # bearer token for authenticated message routes
    WATS_WABA_ID            # WhatsApp Business Account id
    WATS_PHONE_NUMBER_ID    # phone number id
    WATS_SERVE_MODE=live

`PORT` is injected by Railway automatically — do not set it.

## Deploy

    railway init            # create/select project in your workspace
    railway up              # build + deploy from this repo (uses Dockerfile)
    railway domain          # generate the public HTTPS domain

Then point Meta App Dashboard > WhatsApp > Configuration at:

    Callback URL:  https://<your-app>.up.railway.app/webhooks/whatsapp
    Verify token:  <the WATS_VERIFY_TOKEN value you set>

## Local smoke test

    docker build -t wats-railway .
    docker run --rm -e PORT=9090 -p 9090:9090 wats-railway
    curl http://127.0.0.1:9090/healthz     # {"ok":true,"service":"wats"}

## Persistence and limits

- Persistence is opt-in. Set `WATS_DATABASE=/data/wats.sqlite` with a mounted
  volume, or `WATS_DATABASE_URL_ENV=DATABASE_URL` and provide the PostgreSQL URL
  in that environment variable. The entrypoint passes the selected option to
  `wats serve`, which migrates the store before listening. With neither option,
  webhook deduplication and local message history remain inactive.
- Reliable-transport primitives (retry, bounded exponential full-jitter
  backoff, `Retry-After`, per-attempt timeout) ship opt-in via
  `createReliableTransport(inner, options?)` in `@wats/graph` (since 0.3.10) but
  are not wired into the default `serve` transport; `GraphClient` still uses
  the bare fetch transport unless a caller passes the decorator. The decorator
  exposes an `onRetry(ctx)` hook as the redacted-telemetry primitive surface —
  the caller controls what (if anything) to record and is responsible for
  redaction. The service exposes local metrics and an opt-in telemetry adapter;
  it does not send telemetry to a maintainer-owned endpoint.
- Storage volumes, backups, database availability, and recovery of ambiguous
  sends are operator-owned. No HA topology or payload outbox worker is enabled
  by this container.

## Inbound webhook observability

Set `WATS_LOG_WEBHOOK_EVENTS=1` to log a compact, redaction-safe summary of every
dispatched webhook update to stdout:

    {"event":"wats.webhook.update","kind":"status","updateId":"wamid...","wabaId":"...","phoneNumberId":"...","at":"..."}

It logs only `kind` + ids (no message text or PII), is opt-in, and is isolated —
unset (default) registers no handler and leaves behavior unchanged. Useful for
confirming live receipt of `message` / `status` webhooks via `railway logs`.

## Demo auto-reply

Set `WATS_ECHO_REPLY=1` to make the service reply to inbound text messages with a
fixed acknowledgement ("Received by WATS."). This exercises the dispatch-to-send
round-trip in one process — a minimal bot. Auto-reply failures never affect
webhook acknowledgement. Opt-in and fork-strippable; unset (default) does nothing.
The enriched `WATS_LOG_WEBHOOK_EVENTS` log also includes a PII-safe `detail`
(message type or status value). Each echo attempt logs a PII-safe outcome
(`wats.echo.reply`: `sent`, or `failed` with the Meta error code/subcode), so a
reply blocked by the 24-hour window is observable rather than silent.
