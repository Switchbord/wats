// WATS-201 strict TDD — webhook ingress hardening (corrective pass).
//
// Behavioral RED+GREEN tests for:
//  1. /readyz rejects ANY schema version != CURRENT_SCHEMA_VERSION (not just 0),
//     plus unhealthy/throw.
//  2. recordStatusProjection appends one status event and updates the stored
//     row — exactly ONE message row per waMessageId after delivered/read.
//  3. Finite depth gate (<=128) enforced on the authenticated parsed envelope
//     for ALL families BEFORE dedup/dispatch — over-limit returns controlled
//     400, never silently bypasses as dispatch.
//  4. Future timestamps within 1h tolerance clamp to receipt (never extend the
//     window into the future).
//  5. Fallback dedup hash excludes receive-clock fields and hashes the entire
//     scope tuple (not raw phone/waba prefix), so retries dedup.
//  6. No raw-content store; /api 401, telemetry 404, ACK-on-handler-failure.
//
// Real @wats/persistence SQLite adapter throughout — no mutable fake store.

import { afterEach, describe, expect, test } from "bun:test";
import { createCryptoProvider } from "@wats/crypto";
import type { WatsProfileConfig } from "@wats/config";
import { createSqlitePersistence, getConversationWindowState, CURRENT_SCHEMA_VERSION } from "@wats/persistence";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  createWatsServiceApp,
  type WatsServiceConfig
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers (shared)
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(import.meta.dir, "tmp-wats201-ingress-"));
  tempDirs.push(dir);
  return join(dir, "wats.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function profile(overrides: Partial<WatsProfileConfig["webhook"]> = {}): WatsProfileConfig {
  return {
    graph: { apiVersion: "v25.0", baseUrl: "https://graph.test/root/" },
    whatsapp: { wabaId: "123456789012345", phoneNumberId: "15551234567" },
    auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
    webhook: {
      path: "/webhooks/whatsapp",
      verifyToken: { env: "WATS_WEBHOOK_VERIFY_TOKEN" },
      appSecret: { env: "WATS_WEBHOOK_APP_SECRET" },
      maxBodyBytes: 1_048_576,
      ...overrides
    },
    service: {
      host: "127.0.0.1",
      port: 8787,
      apiPrefix: "/api",
      bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
    }
  };
}

function config(overrides: Partial<WatsServiceConfig> = {}): WatsServiceConfig {
  return {
    profile: profile(),
    secrets: {
      accessToken: "graph-access-token",
      webhookVerifyToken: "verify-token",
      webhookAppSecret: "app-secret",
      serviceBearerToken: "service-bearer"
    },
    ...overrides
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function signature(secret: string, body: string): Promise<string> {
  const provider = await createCryptoProvider();
  return `sha256=${bytesToHex(await provider.hmacSha256(secret, body))}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function messageEnvelope(opts: {
  from: string;
  id: string;
  timestamp: string;
  body?: string;
  extraEnvelopeFields?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789012345",
      ...(opts.extraEnvelopeFields ?? {}),
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "15551234567" },
          messages: [{
            from: opts.from,
            id: opts.id,
            timestamp: opts.timestamp,
            type: "text",
            text: { body: opts.body ?? "hello" }
          }]
        }
      }]
    }]
  };
}

function statusEnvelope(opts: {
  id: string;
  status: string;
  timestamp: string;
  recipientId?: string;
}): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "123456789012345",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: "15551234567" },
          statuses: [{
            id: opts.id,
            status: opts.status,
            timestamp: opts.timestamp,
            ...(opts.recipientId !== undefined ? { recipient_id: opts.recipientId } : {})
          }]
        }
      }]
    }]
  };
}

async function postWebhook(
  app: ReturnType<typeof createWatsServiceApp>,
  envelope: unknown,
  opts: { secret?: string; noSignature?: boolean; rawBody?: string } = {}
): Promise<Response> {
  const secret = opts.secret ?? "app-secret";
  const body = opts.rawBody ?? JSON.stringify(envelope);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.noSignature) {
    headers["x-hub-signature-256"] = await signature(secret, body);
  }
  return app.fetch(new Request("https://service.test/webhooks/whatsapp", {
    method: "POST",
    headers,
    body
  }));
}

// Build a deeply nested object N levels deep.
function nestedObject(depth: number): unknown {
  let v: unknown = "leaf";
  for (let i = 0; i < depth; i++) v = { child: v };
  return v;
}

// Count message rows for a waMessageId directly via SQLite.
function countMessageRows(dbPath: string, waMessageId: string): number {
  const db = new Database(dbPath, { readonly: true });
  const row = db.query<{ c: number }>("SELECT COUNT(*) AS c FROM wats_messages WHERE wa_message_id = ?").get(waMessageId);
  db.close();
  return row?.c ?? 0;
}

// ---------------------------------------------------------------------------
// 1. Event-time projection BEFORE dispatch (real SQLite)
// ---------------------------------------------------------------------------

describe("WATS-201 event-time projection before dispatch", () => {
  test("first inbound message opens the conversation window using the Meta timestamp", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const ts = nowSeconds();
    const res = await postWebhook(app, messageEnvelope({ from: "15550001111", id: "wamid.FIRST", timestamp: String(ts) }));
    expect(res.status).toBe(200);

    const window = await getConversationWindowState(store, { phone: "15550001111", now: isoFromSeconds(ts) });
    expect(window.open).toBe(true);
    expect(window.lastInboundAt).not.toBeNull();
    await store.close();
  });

  test("48h-delayed inbound timestamp does NOT open a fresh window", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const now = nowSeconds();
    const oldTs = now - 172800; // 48h ago
    const res = await postWebhook(app, messageEnvelope({ from: "15550002222", id: "wamid.OLD", timestamp: String(oldTs) }));
    expect(res.status).toBe(200);

    const window = await getConversationWindowState(store, { phone: "15550002222", now: isoFromSeconds(now) });
    expect(window.open).toBe(false);
    expect(window.lastInboundAt).not.toBeNull();
    await store.close();
  });

  test("malformed inbound timestamp does not fabricate a fresh open window", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    const now = nowSeconds();
    const res = await postWebhook(app, messageEnvelope({ from: "15550003333", id: "wamid.MAL", timestamp: "not-a-number" }));
    expect(res.status).toBe(200);

    const window = await getConversationWindowState(store, { phone: "15550003333", now: isoFromSeconds(now) });
    expect(window.open).toBe(false);
    await store.close();
  });

  test("future inbound timestamp within 1h tolerance CLAMPS to receipt, never extends the window", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const now = nowSeconds();
    const futureTs = now + 1800; // 30 min in the future, within 1h tolerance
    const res = await postWebhook(app, messageEnvelope({ from: "15550004444", id: "wamid.FUTCLAMP", timestamp: String(futureTs) }));
    expect(res.status).toBe(200);

    // The projected createdAt must NOT be in the future — it must clamp to
    // receipt time so a future-skewed clock cannot extend the conversation
    // window beyond the real receipt moment.
    const stored = await store.getMessage({ waMessageId: "wamid.FUTCLAMP" });
    expect(stored).not.toBeNull();
    const storedMs = new Date(stored!.createdAt).getTime();
    const nowMs = Date.now();
    // Clamped to receipt: createdAt must be <= now + small tolerance, NOT 30m future.
    expect(storedMs).toBeLessThanOrEqual(nowMs + 1000);
    // And must not be the raw future timestamp.
    expect(storedMs).toBeLessThan((now + 1800) * 1000 - 60000);
    await store.close();
  });

  test("future inbound timestamp beyond 1h tolerance is rejected (no projection, no dispatch)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const now = nowSeconds();
    const futureTs = now + 86400; // 24h in the future, beyond 1h tolerance
    const res = await postWebhook(app, messageEnvelope({ from: "15550005555", id: "wamid.FUTREJ", timestamp: String(futureTs) }));
    expect(res.status).toBe(200);

    const window = await getConversationWindowState(store, { phone: "15550005555", now: isoFromSeconds(now) });
    expect(window.open).toBe(false);
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Per-update scoped dedup (real SQLite)
// ---------------------------------------------------------------------------

describe("WATS-201 per-update scoped dedup", () => {
  test("changed envelope batch (different entry.time) does not re-dispatch the same message", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const ts = nowSeconds();
    const env1 = messageEnvelope({ from: "15550001111", id: "wamid.DEDUP", timestamp: String(ts) });
    const res1 = await postWebhook(app, env1);
    expect(res1.status).toBe(200);
    expect(dispatches.length).toBe(1);

    // Same message id but a changed envelope (different receive-clock field).
    const env2 = messageEnvelope({
      from: "15550001111",
      id: "wamid.DEDUP",
      timestamp: String(ts),
      extraEnvelopeFields: { time: 1234567890 }
    });
    const res2 = await postWebhook(app, env2);
    expect(res2.status).toBe(200);
    expect(dispatches.length).toBe(1);

    await store.close();
  });

  test("duplicate identical envelope does not re-dispatch", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const env = messageEnvelope({ from: "15550001111", id: "wamid.IDENT", timestamp: String(nowSeconds()) });
    const res1 = await postWebhook(app, env);
    const res2 = await postWebhook(app, env);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(dispatches.length).toBe(1);
    await store.close();
  });

  test("invalid request does not poison dedup for a subsequent valid delivery", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const ts = nowSeconds();
    const env = messageEnvelope({ from: "15550001111", id: "wamid.POISON", timestamp: String(ts) });

    const invalid = await postWebhook(app, env, { noSignature: true });
    expect(invalid.status).toBe(401);

    const valid = await postWebhook(app, env);
    expect(valid.status).toBe(200);
    expect(dispatches.length).toBe(1);

    await store.close();
  });

  test("two different messages in the same envelope both dispatch", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const ts = nowSeconds();
    const env = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "15551234567" },
            messages: [
              { from: "15550001111", id: "wamid.MULTI.1", timestamp: String(ts), type: "text", text: { body: "first" } },
              { from: "15550002222", id: "wamid.MULTI.2", timestamp: String(ts), type: "text", text: { body: "second" } }
            ]
          }
        }]
      }]
    };
    const res = await postWebhook(app, env);
    expect(res.status).toBe(200);
    expect(dispatches.length).toBe(2);
    await store.close();
  });

  test("retry of a deduped webhook repairs a transient projection failure", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    let projectionShouldFail = true;
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const ts = nowSeconds();
    const env = messageEnvelope({ from: "15550001111", id: "wamid.REPAIR", timestamp: String(ts) });

    const realRecordMessage = store.recordMessage.bind(store);
    let callCount = 0;
    store.recordMessage = async (input: Parameters<typeof realRecordMessage>[0]) => {
      callCount += 1;
      if (projectionShouldFail && callCount <= 2) {
        throw new Error("transient DB failure");
      }
      return realRecordMessage(input);
    };

    const res1 = await postWebhook(app, env);
    expect(res1.status).toBe(200);
    expect(dispatches.length).toBe(1);

    let window = await getConversationWindowState(store, { phone: "15550001111", now: isoFromSeconds(ts) });
    expect(window.open).toBe(false);

    projectionShouldFail = false;
    const res2 = await postWebhook(app, env);
    expect(res2.status).toBe(200);
    expect(dispatches.length).toBe(1);

    window = await getConversationWindowState(store, { phone: "15550001111", now: isoFromSeconds(ts) });
    expect(window.open).toBe(true);

    await store.close();
  });

  test("fallback-family dedup excludes receive-clock fields so retries dedup", async () => {
    // An account-kind update (no natural message/status id) deduped via the
    // bounded fallback. The fallback hash must exclude receive-clock fields
    // (receivedAt, rawChange.time) so a re-delivery with a different receive
    // clock dedups rather than re-dispatching.
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const baseAccount = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{
          field: "phone_number_quality_update",
          value: {
            event: "FLAGGED",
            phone_number: "15551234567",
            reason: "ACCOUNT_MISUSE",
            current_quality_rating: "GREEN"
          }
        }]
      }]
    };

    const res1 = await postWebhook(app, baseAccount);
    expect(res1.status).toBe(200);
    expect(dispatches.length).toBe(1);

    // Re-deliver with an added receive-clock field (time on the entry). The
    // fallback hash must exclude this so it dedups.
    const withClock = JSON.parse(JSON.stringify(baseAccount));
    (withClock.entry[0] as Record<string, unknown>).time = 1234567890;
    const res2 = await postWebhook(app, withClock);
    expect(res2.status).toBe(200);
    expect(dispatches.length).toBe(1);

    await store.close();
  });

  test("fallback-family dedup hashes the entire scope tuple (stable across phone/waba shape)", async () => {
    // Two different account updates for the SAME waba + phone but different
    // event reasons must NOT dedup against each other (different content),
    // while a re-delivery of the SAME content must dedup. This proves the
    // hash covers the full stable content, not just a raw phone/waba prefix.
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const envA = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{ field: "phone_number_quality_update", value: { event: "FLAGGED", phone_number: "15551234567", reason: "ACCOUNT_MISUSE", current_quality_rating: "GREEN" } }]
      }]
    };
    const envB = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{ field: "phone_number_quality_update", value: { event: "FLAGGED", phone_number: "15551234567", reason: "DIFFERENT_REASON", current_quality_rating: "GREEN" } }]
      }]
    };

    const res1 = await postWebhook(app, envA);
    expect(res1.status).toBe(200);
    expect(dispatches.length).toBe(1);

    // Different content -> NOT deduped -> dispatched.
    const res2 = await postWebhook(app, envB);
    expect(res2.status).toBe(200);
    expect(dispatches.length).toBe(2);

    // Re-deliver envA -> deduped.
    const res3 = await postWebhook(app, envA);
    expect(res3.status).toBe(200);
    expect(dispatches.length).toBe(2);

    await store.close();
  });
});

// ---------------------------------------------------------------------------
// 3. Delivered/read/failed status projection — ONE row per message (real SQLite)
// ---------------------------------------------------------------------------

describe("WATS-201 status callback projection (one row per message)", () => {
  test("delivered status callback updates the stored row to delivered (one row)", async () => {
    const dbPath = tempDb();
    const store = await createSqlitePersistence({ filename: dbPath });
    await store.migrate();
    const mockTransport = {
      async request() {
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT.1" }] }), {
          headers: { "content-type": "application/json" }
        });
      }
    };
    const app = createWatsServiceApp({
      ...config({ persistence: store, transport: mockTransport as never }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    await app.fetch(new Request("https://service.test/api/messages/text", {
      method: "POST",
      headers: { authorization: "Bearer service-bearer", "content-type": "application/json" },
      body: JSON.stringify({ to: "15550001111", text: "out" })
    }));

    const ts = nowSeconds();
    const res = await postWebhook(app, statusEnvelope({ id: "wamid.OUT.1", status: "delivered", timestamp: String(ts), recipientId: "15550001111" }));
    expect(res.status).toBe(200);

    // Exactly ONE row for this message id after the delivered callback.
    expect(countMessageRows(dbPath, "wamid.OUT.1")).toBe(1);
    const stored = await store.getMessage({ waMessageId: "wamid.OUT.1" });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("delivered");
    await store.close();
  });

  test("read status callback updates the stored row to read (one row)", async () => {
    const dbPath = tempDb();
    const store = await createSqlitePersistence({ filename: dbPath });
    await store.migrate();
    const mockTransport = {
      async request() {
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT.2" }] }), {
          headers: { "content-type": "application/json" }
        });
      }
    };
    const app = createWatsServiceApp({
      ...config({ persistence: store, transport: mockTransport as never }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    await app.fetch(new Request("https://service.test/api/messages/text", {
      method: "POST",
      headers: { authorization: "Bearer service-bearer", "content-type": "application/json" },
      body: JSON.stringify({ to: "15550001111", text: "out" })
    }));

    const ts = nowSeconds();
    const res = await postWebhook(app, statusEnvelope({ id: "wamid.OUT.2", status: "read", timestamp: String(ts) }));
    expect(res.status).toBe(200);

    expect(countMessageRows(dbPath, "wamid.OUT.2")).toBe(1);
    const stored = await store.getMessage({ waMessageId: "wamid.OUT.2" });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("read");
    await store.close();
  });

  test("failed status callback updates the stored row to failed (one row)", async () => {
    const dbPath = tempDb();
    const store = await createSqlitePersistence({ filename: dbPath });
    await store.migrate();
    const mockTransport = {
      async request() {
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT.3" }] }), {
          headers: { "content-type": "application/json" }
        });
      }
    };
    const app = createWatsServiceApp({
      ...config({ persistence: store, transport: mockTransport as never }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    await app.fetch(new Request("https://service.test/api/messages/text", {
      method: "POST",
      headers: { authorization: "Bearer service-bearer", "content-type": "application/json" },
      body: JSON.stringify({ to: "15550001111", text: "out" })
    }));

    const ts = nowSeconds();
    const res = await postWebhook(app, statusEnvelope({ id: "wamid.OUT.3", status: "failed", timestamp: String(ts) }));
    expect(res.status).toBe(200);

    expect(countMessageRows(dbPath, "wamid.OUT.3")).toBe(1);
    const stored = await store.getMessage({ waMessageId: "wamid.OUT.3" });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("failed");
    await store.close();
  });

  test("delivered then read both update the same single row (no second insert)", async () => {
    const dbPath = tempDb();
    const store = await createSqlitePersistence({ filename: dbPath });
    await store.migrate();
    const mockTransport = {
      async request() {
        return new Response(JSON.stringify({ messages: [{ id: "wamid.OUT.SEQ" }] }), {
          headers: { "content-type": "application/json" }
        });
      }
    };
    const app = createWatsServiceApp({
      ...config({ persistence: store, transport: mockTransport as never }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    await app.fetch(new Request("https://service.test/api/messages/text", {
      method: "POST",
      headers: { authorization: "Bearer service-bearer", "content-type": "application/json" },
      body: JSON.stringify({ to: "15550001111", text: "out" })
    }));

    const ts = nowSeconds();
    await postWebhook(app, statusEnvelope({ id: "wamid.OUT.SEQ", status: "delivered", timestamp: String(ts), recipientId: "15550001111" }));
    await postWebhook(app, statusEnvelope({ id: "wamid.OUT.SEQ", status: "read", timestamp: String(ts + 10) }));

    // After delivered THEN read, still exactly one row, status read.
    expect(countMessageRows(dbPath, "wamid.OUT.SEQ")).toBe(1);
    const stored = await store.getMessage({ waMessageId: "wamid.OUT.SEQ" });
    expect(stored!.status).toBe("read");
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Finite depth gate (<=128) on authenticated parsed envelope — ALL families
// ---------------------------------------------------------------------------

describe("WATS-201 finite depth gate", () => {
  test("over-limit depth (200) in a message extra returns controlled 400, never dispatches", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    // A VALID message with a deeply-nested extra property (200 levels) on the
    // message text. Authenticated, parseable, normalizable — but over the
    // depth gate. Must be rejected with 400 BEFORE dedup/dispatch.
    const env = messageEnvelope({ from: "15550001111", id: "wamid.DEEPMSG", timestamp: String(nowSeconds()) });
    ((env.entry[0]!.changes[0]!.value.messages[0] as Record<string, unknown>).text as Record<string, unknown>).extra = nestedObject(200);

    const res = await postWebhook(app, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("payload_depth_exceeded");
    expect(dispatches.length).toBe(0);
    await store.close();
  });

  test("over-limit depth (200) in a status callback returns controlled 400, never dispatches", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const env = statusEnvelope({ id: "wamid.DEEPSTATUS", status: "delivered", timestamp: String(nowSeconds()) });
    ((env.entry[0]!.changes[0]!.value.statuses[0] as Record<string, unknown>).extra = nestedObject(200));

    const res = await postWebhook(app, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("payload_depth_exceeded");
    expect(dispatches.length).toBe(0);
    await store.close();
  });

  test("over-limit depth (200) in an account-family update returns controlled 400, never dispatches", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const env = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{
          field: "phone_number_quality_update",
          value: { event: "FLAGGED", phone_number: "15551234567", reason: "ACCOUNT_MISUSE", current_quality_rating: "GREEN", extra: nestedObject(200) }
        }]
      }]
    };
    const res = await postWebhook(app, env);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("payload_depth_exceeded");
    expect(dispatches.length).toBe(0);
    await store.close();
  });

  test("within-limit depth (128) is accepted and dispatched", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    // 128 levels deep — exactly at the limit, accepted.
    const env = messageEnvelope({ from: "15550001111", id: "wamid.AT128", timestamp: String(nowSeconds()) });
    ((env.entry[0]!.changes[0]!.value.messages[0] as Record<string, unknown>).text as Record<string, unknown>).extra = nestedObject(128);

    const res = await postWebhook(app, env);
    expect(res.status).toBe(200);
    expect(dispatches.length).toBe(1);
    await store.close();
  });

  test("within-limit fallback-family update is deduped on re-delivery", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });

    const env = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789012345",
        changes: [{ field: "phone_number_quality_update", value: { event: "FLAGGED", phone_number: "15551234567", reason: "ACCOUNT_MISUSE", current_quality_rating: "GREEN" } }]
      }]
    };
    const res1 = await postWebhook(app, env);
    expect(res1.status).toBe(200);
    expect(dispatches.length).toBe(1);

    const res2 = await postWebhook(app, env);
    expect(res2.status).toBe(200);
    expect(dispatches.length).toBe(1);
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Bounded raw body read + controlled error codes
// ---------------------------------------------------------------------------

describe("WATS-201 bounded raw body ingestion", () => {
  test("oversized body returns 413 (controlled), not RangeError", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({
      ...config({ persistence: store, profile: profile({ maxBodyBytes: 128 }) }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    const bigBody = JSON.stringify(messageEnvelope({
      from: "15550001111",
      id: "wamid.BIG",
      timestamp: String(nowSeconds()),
      body: "x".repeat(500)
    }));

    const res = await postWebhook(app, JSON.parse(bigBody), { rawBody: bigBody });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("payload_too_large");
    await store.close();
  });

  test("invalid signature returns 401 (controlled), not RangeError", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    const env = messageEnvelope({ from: "15550001111", id: "wamid.SIG", timestamp: String(nowSeconds()) });
    const res = await postWebhook(app, env, { secret: "wrong-secret" });
    expect(res.status).toBe(401);
    const resBody = await res.json();
    expect(resBody.error.code).toBe("signature_mismatch");
    await store.close();
  });

  test("malformed JSON returns 400 (controlled), not RangeError", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    const malformed = "{ not valid json ";
    const res = await postWebhook(app, null, { rawBody: malformed });
    expect(res.status).toBe(400);
    await store.close();
  });

  test("invalid nested JSON (wrong structure) returns 400, not a crash", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: () => Promise.resolve() } as never
    });

    const badNested = JSON.stringify({ object: "not_whatsapp", entry: "not_an_array" });
    const res = await postWebhook(app, JSON.parse(badNested), { rawBody: badNested });
    expect(res.status).toBe(400);
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// 6. /readyz persistence readiness — ANY non-current schema rejected (real SQLite)
// ---------------------------------------------------------------------------

describe("WATS-201 /readyz persistence readiness", () => {
  test("/readyz returns 200 when store is healthy and at CURRENT_SCHEMA_VERSION", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({ ...config({ persistence: store }) });

    const res = await app.fetch(new Request("https://service.test/readyz"));
    expect(res.status).toBe(200);
    await store.close();
  });

  test("/readyz returns 503 when store health reports not ok (closed)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({ ...config({ persistence: store }) });

    await store.close();

    const res = await app.fetch(new Request("https://service.test/readyz"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_unavailable");
  });

  test("/readyz returns 503 when store is not migrated (version 0)", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    const app = createWatsServiceApp({ ...config({ persistence: store }) });

    const res = await app.fetch(new Request("https://service.test/readyz"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_unavailable");
    await store.close();
  });

  test("/readyz returns 503 when store schema is a STALE version != CURRENT_SCHEMA_VERSION", async () => {
    // Migrate to current, then force a stale (lower) schema version in the
    // migrations table. health() reports ok:true + the stale version — /readyz
    // MUST reject it (not just version 0).
    const dbPath = tempDb();
    const store = await createSqlitePersistence({ filename: dbPath });
    await store.migrate();
    const app = createWatsServiceApp({ ...config({ persistence: store }) });

    // Force a stale schema version (lower than current).
    const db = new Database(dbPath);
    db.run("DELETE FROM wats_schema_migrations");
    db.run("INSERT INTO wats_schema_migrations (id, version, checksum, applied_at) VALUES (?, ?, ?, ?)", "0001_init", 1, "stale", new Date().toISOString());
    db.close();

    const health = await store.health();
    expect(health.ok).toBe(true);
    expect(health.currentVersion).toBe(1);
    expect(health.currentVersion).not.toBe(CURRENT_SCHEMA_VERSION);

    const res = await app.fetch(new Request("https://service.test/readyz"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_unavailable");
    await store.close();
  });

  test("/readyz returns 503 when store health() throws", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({ ...config({ persistence: store }) });

    await store.close();
    // health() on a closed store throws store_closed.
    const res = await app.fetch(new Request("https://service.test/readyz"));
    expect(res.status).toBe(503);
    await store.close();
  });

  test("/healthz always returns 200 regardless of store health", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({ ...config({ persistence: store }) });

    const res = await app.fetch(new Request("https://service.test/healthz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    await store.close();
  });

  test("/readyz returns 200 when no persistence is configured", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/readyz"));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 7. Auth policies preserved + ACK-on-handler-failure + no raw-content store
// ---------------------------------------------------------------------------

describe("WATS-201 auth policies preserved", () => {
  test("GET webhook challenge still works without persistence", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request(
      "https://service.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=CHALLENGE"
    ));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CHALLENGE");
  });

  test("POST webhook without persistence still dispatches (raw-body auth preserved)", async () => {
    const dispatches: unknown[] = [];
    const app = createWatsServiceApp({
      ...config(),
      whatsapp: { dispatch: (u: unknown) => { dispatches.push(u); return Promise.resolve(); } } as never
    });
    const env = messageEnvelope({ from: "15550001111", id: "wamid.NOPERSIST", timestamp: String(nowSeconds()) });
    const res = await postWebhook(app, env);
    expect(res.status).toBe(200);
    expect(dispatches.length).toBe(1);
  });

  test("/api routes return 401 unauthorized (not 404) on missing token", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/api/messages/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "15550001111", text: "hi" })
    }));
    expect(res.status).toBe(401);
  });

  test("/metrics returns 404 (existence-hiding) on missing token", async () => {
    const app = createWatsServiceApp(config());
    const res = await app.fetch(new Request("https://service.test/metrics"));
    expect(res.status).toBe(404);
  });
});

describe("WATS-201 ACK-on-handler-failure + no raw-content store", () => {
  test("handler throw does not break the 200 ACK", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: () => { throw new Error("handler boom"); } } as never
    });
    const env = messageEnvelope({ from: "15550001111", id: "wamid.HANDLEFAIL", timestamp: String(nowSeconds()) });
    const res = await postWebhook(app, env);
    expect(res.status).toBe(200);
    await store.close();
  });

  test("handler receives a normalized update, not the raw envelope", async () => {
    const store = await createSqlitePersistence({ filename: tempDb() });
    await store.migrate();
    const seen: unknown[] = [];
    const app = createWatsServiceApp({
      ...config({ persistence: store }),
      whatsapp: { dispatch: (u: unknown) => { seen.push(u); return Promise.resolve(); } } as never
    });
    const env = messageEnvelope({ from: "15550001111", id: "wamid.RAWCHECK", timestamp: String(nowSeconds()), body: "secret text" });
    await postWebhook(app, env);

    expect(seen.length).toBe(1);
    const update = seen[0] as Record<string, unknown>;
    expect(update.kind).toBe("message");
    expect(update.message).toBeDefined();
    expect(JSON.stringify(update)).not.toContain("whatsapp_business_account");
    await store.close();
  });
});
