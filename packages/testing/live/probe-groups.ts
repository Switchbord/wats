// WATS-139 live probe — Phase 2c Groups campaign (highest-risk surface).
//
// Attempts the read+create+read portion of the Groups live matrix that does
// NOT require recipient action. Per the documented contract, group id and
// invite link arrive via WEBHOOK, not the create HTTP response — so this
// probe records the HTTP acceptance, then the caller observes the webhook in
// the Railway logs. Created group ids are written to the cleanup manifest.
//
// Run via:  HOME=/root railway run --service WATS -- \
//   bun run packages/testing/live/probe-groups.ts
// FAIL-CLOSED: liveGate() AND WATS_ENABLE_GROUPS=1.

import { GraphClient, PhoneNumberClient } from "@wats/graph";
import { liveGate, mutationGate, LiveLedger, metaErrorFields } from "./ledger.ts";
import { hashId } from "./redact.ts";

function reqEnv(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`missing env ${n}`);
  return v;
}

async function main(): Promise<void> {
  if (!liveGate().enabled) { console.log(JSON.stringify({ event: "live.groups.blocked", reason: liveGate().reason })); return; }
  const g = mutationGate("WATS_ENABLE_GROUPS");
  if (!g.enabled) { console.log(JSON.stringify({ event: "live.groups.blocked", reason: g.reason })); return; }

  const runId = process.env.WATS_TEST_RUN_ID ?? `groups-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  const ledger = new LiveLedger(runId);
  const client = new GraphClient({
    accessToken: reqEnv("WATS_ACCESS_TOKEN"),
    apiVersion: process.env.WATS_GRAPH_API_VERSION ?? "v25.0",
    baseUrl: `${process.env.WATS_GRAPH_BASE_URL ?? "https://graph.facebook.com"}/`
  });
  const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: reqEnv("WATS_PHONE_NUMBER_ID") });
  const subject = `wats-live-${runId}`;

  console.log(JSON.stringify({ event: "live.groups.start", runId, subject }));

  // read-only baseline
  try {
    const list = await phone.listGroups({});
    ledger.record({ phase: "phase2c-groups", surface: "WATS-139", op: "listGroups", outcome: "pass", httpStatus: 200, responseShape: list, sanitizedResponse: list });
    console.log(JSON.stringify({ op: "listGroups", outcome: "pass", count: ((list as { data?: unknown[] }).data ?? []).length }));
  } catch (err) {
    const m = metaErrorFields(err);
    ledger.record({ phase: "phase2c-groups", surface: "WATS-139", op: "listGroups", outcome: "fail", metaCode: m.metaCode, note: m.name });
    console.log(JSON.stringify({ op: "listGroups", outcome: "fail", errorName: m.name, metaCode: m.metaCode }));
  }

  // create (async: id/invite via webhook)
  try {
    const res = await phone.createGroup({ subject, joinApprovalMode: "approval_required" });
    const requestId = (res as { requestId?: string }).requestId;
    ledger.record({ phase: "phase2c-groups", surface: "WATS-139", op: "createGroup", outcome: "pass", httpStatus: 200, responseShape: res, sanitizedResponse: res, note: "async create; group_id + invite_link arrive via webhook" });
    console.log(JSON.stringify({ op: "createGroup", outcome: "pass", hasRequestId: typeof requestId === "string", requestIdHash: typeof requestId === "string" ? hashId(requestId, ledger.runSalt) : null, shape: Object.keys(res as object) }));
  } catch (err) {
    const m = metaErrorFields(err);
    ledger.record({ phase: "phase2c-groups", surface: "WATS-139", op: "createGroup", outcome: "fail", httpStatus: m.httpStatus, metaCode: m.metaCode, metaSubcode: m.metaSubcode, note: m.name });
    console.log(JSON.stringify({ op: "createGroup", outcome: "fail", errorName: m.name, metaCode: m.metaCode, metaSubcode: m.metaSubcode, httpStatus: m.httpStatus ?? null }));
  }

  console.log(JSON.stringify({ event: "live.groups.done", runId, ledger: ledger.filePath }));
}

main().catch((e) => { console.log(JSON.stringify({ event: "live.groups.crash", errorName: e instanceof Error ? e.name : "Error" })); process.exitCode = 1; });
