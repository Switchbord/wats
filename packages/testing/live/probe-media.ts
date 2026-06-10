// WATS-81 live probe — Phase 4 media lifecycle (self-contained, no recipient
// action needed). upload -> metadata -> download bytes (capped + integrity)
// -> send by id -> delete. Every created media id is recorded to the run
// cleanup manifest so teardown is mechanical and verifiable.
//
// Run via:  HOME=/root railway run --service WATS -- \
//   bun run packages/testing/live/probe-media.ts
// FAIL-CLOSED: liveGate() AND WATS_ENABLE_MEDIA=1. Sending the uploaded media
// to the recipient additionally requires WATS_ENABLE_SEND=1.

import { GraphClient, PhoneNumberClient } from "@wats/graph";
import { uploadMedia, downloadMedia, downloadMediaBytes, deleteMedia } from "@wats/graph/endpoints/media";
import { liveGate, mutationGate, LiveLedger, metaErrorFields } from "./ledger.ts";
import { hashId } from "./redact.ts";

function reqEnv(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`missing env ${n}`);
  return v;
}

// Minimal valid 1x1 PNG (67 bytes), generated inline — no external fixture.
const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

async function main(): Promise<void> {
  if (!liveGate().enabled) { console.log(JSON.stringify({ event: "live.media.blocked", reason: liveGate().reason })); return; }
  const g = mutationGate("WATS_ENABLE_MEDIA");
  if (!g.enabled) { console.log(JSON.stringify({ event: "live.media.blocked", reason: g.reason })); return; }

  const runId = process.env.WATS_TEST_RUN_ID ?? `media-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  const ledger = new LiveLedger(runId);
  const client = new GraphClient({
    accessToken: reqEnv("WATS_ACCESS_TOKEN"),
    apiVersion: process.env.WATS_GRAPH_API_VERSION ?? "v25.0",
    baseUrl: `${process.env.WATS_GRAPH_BASE_URL ?? "https://graph.facebook.com"}/`
  });
  const phoneNumberId = reqEnv("WATS_PHONE_NUMBER_ID");
  let mediaId: string | undefined;

  console.log(JSON.stringify({ event: "live.media.start", runId, ledger: ledger.filePath }));

  // 1. upload
  try {
    const up = await uploadMedia(client, { phoneNumberId }, { file: PNG_1X1, type: "image/png", messagingProduct: "whatsapp" });
    mediaId = up.id;
    ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "uploadMedia", outcome: "pass", httpStatus: 200, responseShape: up, sanitizedResponse: up });
    console.log(JSON.stringify({ op: "uploadMedia", outcome: "pass", mediaIdHash: hashId(up.id, ledger.runSalt) }));
  } catch (err) {
    const m = metaErrorFields(err);
    ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "uploadMedia", outcome: "fail", httpStatus: m.httpStatus, metaCode: m.metaCode, metaSubcode: m.metaSubcode, note: m.name });
    console.log(JSON.stringify({ op: "uploadMedia", outcome: "fail", errorName: m.name, metaCode: m.metaCode, httpStatus: m.httpStatus ?? null }));
    return; // nothing downstream without an id
  }

  // 2. metadata
  let mediaUrl: string | undefined;
  let expectedSha: string | undefined;
  try {
    const meta = await downloadMedia(client, { mediaId: mediaId });
    mediaUrl = meta.url;
    expectedSha = meta.sha256;
    ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "downloadMedia(metadata)", outcome: "pass", httpStatus: 200, responseShape: meta, sanitizedResponse: meta });
    console.log(JSON.stringify({ op: "downloadMedia", outcome: "pass", mimeType: meta.mimeType, fileSize: meta.fileSize, hasSha256: typeof meta.sha256 === "string" }));
  } catch (err) {
    const m = metaErrorFields(err);
    ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "downloadMedia(metadata)", outcome: "fail", metaCode: m.metaCode, note: m.name });
    console.log(JSON.stringify({ op: "downloadMedia", outcome: "fail", errorName: m.name, metaCode: m.metaCode }));
  }

  // 3. download bytes with cap + integrity check
  if (mediaUrl !== undefined) {
    try {
      const opts: { url: string; maxBytes: number; expectedSha256?: string } = { url: mediaUrl, maxBytes: 5_242_880 };
      if (expectedSha !== undefined) opts.expectedSha256 = expectedSha;
      const bytes = await downloadMediaBytes(client, opts);
      const integrityOk = bytes.bytes.length > 0;
      ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "downloadMediaBytes", outcome: "pass", httpStatus: 200, note: `bytes=${bytes.bytes.length}; sha256 verified=${expectedSha !== undefined}; contentType=${bytes.contentType ?? "?"}` });
      console.log(JSON.stringify({ op: "downloadMediaBytes", outcome: "pass", byteLength: bytes.bytes.length, integrityOk, contentType: bytes.contentType ?? null }));
    } catch (err) {
      const m = metaErrorFields(err);
      ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "downloadMediaBytes", outcome: "fail", metaCode: m.metaCode, note: m.name });
      console.log(JSON.stringify({ op: "downloadMediaBytes", outcome: "fail", errorName: m.name }));
    }
  }

  // 4. send by media id (only with the send opt-in)
  const sendGate = mutationGate("WATS_ENABLE_SEND");
  if (sendGate.enabled && mediaId !== undefined) {
    try {
      const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId });
      const res = await phone.sendImage({ to: reqEnv("WATS_TEST_RECIPIENT"), mediaId: mediaId });
      const wamid = (res as { messages?: ReadonlyArray<{ id?: string }> }).messages?.[0]?.id;
      ledger.record({ phase: "phase4-media", surface: "WATS-38", op: "sendImage(byMediaId)", outcome: "pass", httpStatus: 200, responseShape: res, sanitizedResponse: res });
      console.log(JSON.stringify({ op: "sendImage", outcome: "pass", messageIdHash: typeof wamid === "string" ? hashId(wamid, ledger.runSalt) : null }));
    } catch (err) {
      const m = metaErrorFields(err);
      ledger.record({ phase: "phase4-media", surface: "WATS-38", op: "sendImage(byMediaId)", outcome: "fail", metaCode: m.metaCode, note: m.name });
      console.log(JSON.stringify({ op: "sendImage", outcome: "fail", errorName: m.name, metaCode: m.metaCode }));
    }
  } else {
    console.log(JSON.stringify({ op: "sendImage", outcome: "skipped", reason: sendGate.reason }));
  }

  // 5. cleanup — delete the media we created
  if (mediaId !== undefined) {
    try {
      const del = await deleteMedia(client, { mediaId: mediaId });
      ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "deleteMedia(cleanup)", outcome: "pass", httpStatus: 200, responseShape: del, sanitizedResponse: del });
      console.log(JSON.stringify({ op: "deleteMedia", outcome: "pass", mediaIdHash: hashId(mediaId, ledger.runSalt) }));
    } catch (err) {
      const m = metaErrorFields(err);
      ledger.record({ phase: "phase4-media", surface: "WATS-37", op: "deleteMedia(cleanup)", outcome: "fail", metaCode: m.metaCode, note: `CLEANUP FAILED: ${m.name}` });
      console.log(JSON.stringify({ op: "deleteMedia", outcome: "fail", errorName: m.name, NEEDS_MANUAL_CLEANUP: hashId(mediaId, ledger.runSalt) }));
    }
  }

  console.log(JSON.stringify({ event: "live.media.done", runId, ledger: ledger.filePath }));
}

main().catch((e) => { console.log(JSON.stringify({ event: "live.media.crash", errorName: e instanceof Error ? e.name : "Error" })); process.exitCode = 1; });
