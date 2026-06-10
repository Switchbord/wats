// WATS-80/81 live probe — Phase 0 (asset identity) + Phase 1 (read-only).
//
// Run via:  HOME=/root railway run --service WATS -- \
//             bun run packages/testing/live/probe-readonly.ts
// so that secrets arrive only as subprocess env vars. Nothing here prints a
// raw secret, id, or PII — everything routes through the ledger's redaction.
//
// FAIL-CLOSED: refuses to call Meta unless liveGate() passes.

import { GraphClient } from "@wats/graph";
import {
  getWabaInfo,
  listSubscribedApps,
  getPhoneNumberInfo,
  getBusinessProfile,
  getCommerceSettings
} from "@wats/graph/endpoints/business-management";
import { listPhoneNumbers } from "@wats/graph";
import { listMessageTemplates } from "@wats/graph/endpoints/templates";
import { listFlows } from "@wats/graph/endpoints/flows";
import { liveGate, LiveLedger, metaErrorFields } from "./ledger.ts";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`missing required env var ${name}`);
  }
  return v;
}

async function main(): Promise<void> {
  const gate = liveGate();
  if (!gate.enabled) {
    console.log(JSON.stringify({ event: "live.probe.blocked", reason: gate.reason }));
    process.exitCode = 0;
    return;
  }

  const runId = process.env.WATS_TEST_RUN_ID ?? `ro-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  const ledger = new LiveLedger(runId);

  const accessToken = reqEnv("WATS_ACCESS_TOKEN");
  const wabaId = reqEnv("WATS_WABA_ID");
  const phoneNumberId = reqEnv("WATS_PHONE_NUMBER_ID");
  const apiVersion = process.env.WATS_GRAPH_API_VERSION ?? "v25.0";
  const baseUrl = process.env.WATS_GRAPH_BASE_URL ?? "https://graph.facebook.com";

  const client = new GraphClient({ accessToken, apiVersion, baseUrl: `${baseUrl}/` });

  console.log(JSON.stringify({ event: "live.probe.start", runId, ledger: ledger.filePath, apiVersion }));

  // Each probe: call the real WATS helper, record shape + outcome, print a
  // one-line safe summary. A thrown Meta error is recorded, not fatal — the
  // campaign wants the failure surface captured, then continues.
  type Probe = { surface: string; op: string; run: () => Promise<unknown> };
  const probes: Probe[] = [
    { surface: "WATS-42A", op: "getWabaInfo", run: () => getWabaInfo(client, { wabaId }) },
    { surface: "WATS-42A", op: "listSubscribedApps", run: () => listSubscribedApps(client, { wabaId }) },
    { surface: "WATS-42A", op: "listPhoneNumbers", run: () => listPhoneNumbers(client, { wabaId }) },
    { surface: "WATS-42A", op: "getPhoneNumberInfo", run: () => getPhoneNumberInfo(client, { phoneNumberId }) },
    { surface: "WATS-42A", op: "getBusinessProfile", run: () => getBusinessProfile(client, { phoneNumberId }) },
    { surface: "WATS-42A", op: "getCommerceSettings", run: () => getCommerceSettings(client, { phoneNumberId }) },
    { surface: "WATS-39", op: "listMessageTemplates", run: () => listMessageTemplates(client, { wabaId }) },
    { surface: "WATS-40", op: "listFlows", run: () => listFlows(client, { wabaId }) }
  ];

  let pass = 0;
  let fail = 0;
  for (const probe of probes) {
    try {
      const res = await probe.run();
      const rec = ledger.record({
        phase: "phase1-readonly",
        surface: probe.surface,
        op: probe.op,
        outcome: "pass",
        httpStatus: 200,
        responseShape: res,
        sanitizedResponse: res
      });
      pass += 1;
      console.log(JSON.stringify({ op: probe.op, outcome: "pass", shape: rec.responseShape }));
    } catch (err) {
      const m = metaErrorFields(err);
      ledger.record({
        phase: "phase1-readonly",
        surface: probe.surface,
        op: probe.op,
        outcome: "fail",
        httpStatus: m.httpStatus,
        metaCode: m.metaCode,
        metaSubcode: m.metaSubcode,
        note: m.name
      });
      fail += 1;
      console.log(JSON.stringify({ op: probe.op, outcome: "fail", errorName: m.name, metaCode: m.metaCode, metaSubcode: m.metaSubcode, httpStatus: m.httpStatus ?? null }));
    }
  }

  console.log(JSON.stringify({ event: "live.probe.done", runId, pass, fail, total: probes.length, ledger: ledger.filePath }));
}

main().catch((err) => {
  // Never let an unexpected throw print a raw secret; surface name only.
  const name = err instanceof Error ? err.name : "Error";
  const msg = err instanceof Error ? err.message : "unknown";
  console.log(JSON.stringify({ event: "live.probe.crash", errorName: name, message: msg.slice(0, 200) }));
  process.exitCode = 1;
});
