// WATS-81 live probe — Phase 3 low-impact send.
//
// Sends ONE text message to the authorized test recipient and records the
// returned message id (hashed) to the ledger. A 200 + message id is
// ACCEPTANCE, not delivery — delivery/read are confirmed only by the status
// webhook observed separately in the Railway service logs.
//
// Run via:  HOME=/root railway run --service WATS -- \
//             bun run packages/testing/live/probe-send-text.ts
//
// FAIL-CLOSED: needs liveGate() AND WATS_ENABLE_SEND=1 (a domain opt-in for
// the side-effecting send, so a bare live-read run cannot accidentally send).

import { GraphClient, PhoneNumberClient } from "@wats/graph";
import { liveGate, mutationGate, LiveLedger, metaErrorFields } from "./ledger.ts";
import { hashId } from "./redact.ts";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) throw new Error(`missing env ${name}`);
  return v;
}

async function main(): Promise<void> {
  const gate = liveGate();
  if (!gate.enabled) {
    console.log(JSON.stringify({ event: "live.send.blocked", reason: gate.reason }));
    return;
  }
  const sendGate = mutationGate("WATS_ENABLE_SEND");
  if (!sendGate.enabled) {
    console.log(JSON.stringify({ event: "live.send.blocked", reason: sendGate.reason }));
    return;
  }

  const runId = process.env.WATS_TEST_RUN_ID ?? `send-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  const ledger = new LiveLedger(runId);

  const client = new GraphClient({
    accessToken: reqEnv("WATS_ACCESS_TOKEN"),
    apiVersion: process.env.WATS_GRAPH_API_VERSION ?? "v25.0",
    baseUrl: `${process.env.WATS_GRAPH_BASE_URL ?? "https://graph.facebook.com"}/`
  });
  const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: reqEnv("WATS_PHONE_NUMBER_ID") });
  const to = reqEnv("WATS_TEST_RECIPIENT");

  const text = `WATS live validation ${runId} — automated test message; please ignore.`;
  console.log(JSON.stringify({ event: "live.send.start", runId, recipientHash: hashId(to, ledger.runSalt) }));

  try {
    const res = await phone.sendText({ to, text });
    // Extract the message id for correlation with the status webhook.
    const wamid = (res as { messages?: ReadonlyArray<{ id?: string }> }).messages?.[0]?.id;
    const rec = ledger.record({
      phase: "phase3-send",
      surface: "WATS-38",
      op: "sendText",
      outcome: "pass",
      httpStatus: 200,
      requestShape: { to: "string", text: "string" },
      responseShape: res,
      sanitizedResponse: res,
      note: "200 accepted; delivery confirmed only by status webhook"
    });
    console.log(JSON.stringify({
      event: "live.send.accepted",
      runId,
      hasMessageId: typeof wamid === "string",
      messageIdHash: typeof wamid === "string" ? hashId(wamid, ledger.runSalt) : null,
      shape: rec.responseShape
    }));
  } catch (err) {
    const m = metaErrorFields(err);
    ledger.record({
      phase: "phase3-send",
      surface: "WATS-38",
      op: "sendText",
      outcome: "fail",
      httpStatus: m.httpStatus,
      metaCode: m.metaCode,
      metaSubcode: m.metaSubcode,
      note: m.name
    });
    console.log(JSON.stringify({ event: "live.send.failed", errorName: m.name, metaCode: m.metaCode, metaSubcode: m.metaSubcode, httpStatus: m.httpStatus ?? null }));
  }
}

main().catch((err) => {
  const name = err instanceof Error ? err.name : "Error";
  console.log(JSON.stringify({ event: "live.send.crash", errorName: name }));
  process.exitCode = 1;
});
