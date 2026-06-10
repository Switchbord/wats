// WATS-81 live probe — Phase 3 template send (deliverable outside 24h window).
//
// Sends an existing APPROVED template (default hello_world/en_US) to the test
// recipient. Unlike freeform text, an approved template is deliverable without
// an open customer-service window, so this is the path that should yield a
// real `delivered` status webhook.
//
// Run via:  HOME=/root railway run --service WATS -- \
//   bun run packages/testing/live/probe-send-template.ts
// FAIL-CLOSED: liveGate() AND WATS_ENABLE_SEND=1.

import { GraphClient, PhoneNumberClient } from "@wats/graph";
import { liveGate, mutationGate, LiveLedger, metaErrorFields } from "./ledger.ts";
import { hashId } from "./redact.ts";

function reqEnv(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`missing env ${n}`);
  return v;
}

async function main(): Promise<void> {
  if (!liveGate().enabled) { console.log(JSON.stringify({ event: "live.tmpl.blocked", reason: liveGate().reason })); return; }
  const g = mutationGate("WATS_ENABLE_SEND");
  if (!g.enabled) { console.log(JSON.stringify({ event: "live.tmpl.blocked", reason: g.reason })); return; }

  const runId = process.env.WATS_TEST_RUN_ID ?? `tmpl-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  const ledger = new LiveLedger(runId);
  const client = new GraphClient({
    accessToken: reqEnv("WATS_ACCESS_TOKEN"),
    apiVersion: process.env.WATS_GRAPH_API_VERSION ?? "v25.0",
    baseUrl: `${process.env.WATS_GRAPH_BASE_URL ?? "https://graph.facebook.com"}/`
  });
  const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: reqEnv("WATS_PHONE_NUMBER_ID") });
  const to = reqEnv("WATS_TEST_RECIPIENT");
  const name = process.env.WATS_TEMPLATE_NAME ?? "hello_world";
  const languageCode = process.env.WATS_TEMPLATE_LANG ?? "en_US";

  console.log(JSON.stringify({ event: "live.tmpl.start", runId, name, languageCode, recipientHash: hashId(to, ledger.runSalt) }));
  try {
    const res = await phone.sendTemplate({ to, name, languageCode });
    const wamid = (res as { messages?: ReadonlyArray<{ id?: string }> }).messages?.[0]?.id;
    const rec = ledger.record({
      phase: "phase3-send-template",
      surface: "WATS-39",
      op: "sendTemplate",
      outcome: "pass",
      httpStatus: 200,
      requestShape: { to: "string", name: "string", languageCode: "string" },
      responseShape: res,
      sanitizedResponse: res,
      note: `approved template ${name}/${languageCode}; delivery via status webhook`
    });
    console.log(JSON.stringify({ event: "live.tmpl.accepted", runId, hasMessageId: typeof wamid === "string", messageIdHash: typeof wamid === "string" ? hashId(wamid, ledger.runSalt) : null, shape: rec.responseShape }));
  } catch (err) {
    const m = metaErrorFields(err);
    ledger.record({ phase: "phase3-send-template", surface: "WATS-39", op: "sendTemplate", outcome: "fail", httpStatus: m.httpStatus, metaCode: m.metaCode, metaSubcode: m.metaSubcode, note: m.name });
    console.log(JSON.stringify({ event: "live.tmpl.failed", errorName: m.name, metaCode: m.metaCode, metaSubcode: m.metaSubcode, httpStatus: m.httpStatus ?? null }));
  }
}

main().catch((e) => { console.log(JSON.stringify({ event: "live.tmpl.crash", errorName: e instanceof Error ? e.name : "Error" })); process.exitCode = 1; });
