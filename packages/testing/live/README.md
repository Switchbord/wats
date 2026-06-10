# WATS live-testing harness (WATS-80)

Env-gated probes that validate WATS against **live Meta/WhatsApp** assets.
These are NOT part of `bun test`, NOT run in CI, and NEVER execute without
explicit credentials and authorization flags. They exist so WATS's request/
response shapes can be checked against reality, not just MockTransport.

## Fail-closed contract

Every probe calls `liveGate()` first and refuses to touch Meta unless **both**
`WATS_LIVE_ENABLE=1` and `WATS_YES_LIVE=1` are set. Mutating probes
additionally require a domain opt-in flag:

| Probe | File | Extra flag |
| --- | --- | --- |
| Read-only discovery (WATS-42A/39/40) | `probe-readonly.ts` | — |
| Text send | `probe-send-text.ts` | `WATS_ENABLE_SEND=1` |
| Template send | `probe-send-template.ts` | `WATS_ENABLE_SEND=1` |
| Media lifecycle | `probe-media.ts` | `WATS_ENABLE_MEDIA=1` (+ `WATS_ENABLE_SEND=1` to send by id) |
| Groups | `probe-groups.ts` | `WATS_ENABLE_GROUPS=1` |

Absent the gate, a probe prints `PASS_SHAPE_ENV_BLOCKED: ...` and exits 0
making zero Graph calls. `PASS_SHAPE_ENV_BLOCKED` is **never** live parity.

## Running

Secrets live in the deployment environment (e.g. Railway), never in argv,
repo, or chat. Drive probes so the secrets arrive only as subprocess env:

```sh
# Railway injects the WATS service env into the local subprocess.
HOME=/root WATS_TEST_RUN_ID="ro-$(date -u +%Y%m%dT%H%M%SZ)" \
  railway run --service WATS -- \
  bun run packages/testing/live/probe-readonly.ts
```

Required env (names only): `WATS_ACCESS_TOKEN`, `WATS_WABA_ID`,
`WATS_PHONE_NUMBER_ID`, `WATS_TEST_RECIPIENT`, plus the gate/domain flags.
Optional: `WATS_GRAPH_API_VERSION` (default `v25.0`), `WATS_GRAPH_BASE_URL`,
`WATS_TEMPLATE_NAME`/`WATS_TEMPLATE_LANG` (default `hello_world`/`en_US`).

## Evidence ledger + redaction

`ledger.ts` writes one JSONL entry per op to `~/.hermes/notes/wats-live/<runId>.jsonl`
— **outside the repository**. `redact.ts` runs first: secrets are dropped,
correlatable ids (WABA/phone/wamid/media/template/group ids, recipients) are
replaced with a per-run salted short hash (`h:<12hex>`), and free-form PII
(message text, names, profile fields) is dropped. The structural **shape**
(what the campaign validates) is preserved; no raw secret, id, or PII reaches
disk. Created assets (media ids, etc.) are recorded so teardown is mechanical.

## Campaign result (2026-06-10, v0.3.25)

See `docs/parity/live-testing-campaign.md` execution log for the dated summary.
Read-only discovery 8/8; text send accepted (delivery `failed` — no open 24h
window, expected); template send → full `sent`/`delivered`/`read` + inbound
reaction (webhook runtime end-to-end); media upload/metadata/send/delete pass;
Groups create blocked by Meta `#131215` (phone not Groups-eligible — asset
limitation, not a WATS defect). One wire-contract bug found and fixed:
WATS-149 (`downloadMediaBytes` hex sha256).
