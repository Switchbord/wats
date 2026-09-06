import { describe, expect, test } from "bun:test";
import { createFetchWebhookHandler, createWebhookAdapter } from "../src/index";

async function signature(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture-app"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function nested(depth: number): unknown {
  let result: unknown = "leaf";
  for (let i = 0; i < depth; i++) result = { child: result };
  return result;
}
function envelope(extra: unknown) {
  return {
    object: "whatsapp_business_account", extra,
    entry: [{ id: "123", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "1234" },
      messages: [{ id: "wamid.depth", from: "15550001111", timestamp: "1", type: "text", text: { body: "fixture" } }]
    } }] }]
  };
}
async function send(depth: number, validSignature = true) {
  let dispatched = 0;
  const handler = createFetchWebhookHandler(createWebhookAdapter({ verifyToken: "fixture-verify", appSecret: "fixture-app", whatsapp: { dispatch: () => { dispatched++; } } }));
  const raw = JSON.stringify(envelope(nested(depth)));
  const response = await handler(new Request("https://fixture.invalid/webhook", { method: "POST", headers: {
    "content-type": "application/json", "x-hub-signature-256": validSignature ? await signature(raw) : `sha256=${"0".repeat(64)}`
  }, body: raw }));
  return { status: response.status, body: await response.json() as { error?: { code: string } }, dispatched };
}

describe("authenticated envelope complexity", () => {
  test("rejects deep top-level data before normalization discards it", async () => {
    const result = await send(200);
    expect(result.status).toBe(400);
    expect(result.body.error?.code).toBe("payload_depth_exceeded");
    expect(result.dispatched).toBe(0);
  });
  test("accepts bounded envelope data", async () => {
    const result = await send(120);
    expect(result.status).toBe(200);
    expect(result.dispatched).toBe(1);
  });
  test("authenticates before reporting payload complexity", async () => {
    const result = await send(200, false);
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("signature_mismatch");
    expect(result.dispatched).toBe(0);
  });
});
