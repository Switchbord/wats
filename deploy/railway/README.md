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

## Known limitations (alpha)

- Stateless: no persistence is wired into `serve` yet, so webhook dedup and
  idempotency are not active out of the box (tracked in WATS-87).
- No transport retry/backoff/timeout primitives yet (WATS-86).
- SQLite-only persistence package; no Postgres/HA (WATS-125).

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
(message type or status value).
