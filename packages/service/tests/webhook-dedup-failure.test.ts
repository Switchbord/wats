import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCryptoProvider } from "@wats/crypto";
import { createSqlitePersistence, type PersistenceStore } from "@wats/persistence";
import { createMockTransport } from "@wats/graph/testing";
import { createWatsServiceApp } from "../src/index";
import Ajv2020 from "ajv/dist/2020.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "wats-dedup-fault-"));
  const filename = join(dir, "state.sqlite");
  cleanup.push(async () => { rmSync(dir, { recursive: true, force: true }); });
  const store = await createSqlitePersistence({ filename });
  await store.migrate();
  cleanup.push(() => store.close());
  const database = new Database(filename);
  cleanup.push(async () => { database.close(); });
  const dispatched: string[] = [];
  const appFor = (persistence: PersistenceStore = store) => createWatsServiceApp({
    profile: {
      graph: { apiVersion: "v25.0", baseUrl: "https://graph.test" },
      whatsapp: { wabaId: "123456789012345", phoneNumberId: "15551234567" },
      auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
      webhook: {
        path: "/webhooks/whatsapp", maxBodyBytes: 1_048_576,
        verifyToken: { env: "WATS_VERIFY_TOKEN" }, appSecret: { env: "WATS_APP_SECRET" }
      },
      service: { host: "127.0.0.1", port: 8787, apiPrefix: "/api", bearerToken: { env: "WATS_SERVICE_TOKEN" } }
    },
    secrets: { accessToken: "synthetic-token", webhookVerifyToken: "verify", webhookAppSecret: "synthetic-secret", serviceBearerToken: "service" },
    transport: createMockTransport().transport,
    persistence,
    whatsapp: {
      dispatch(update: unknown) {
        const id = (update as { message?: { id?: string } }).message?.id;
        if (id !== undefined) dispatched.push(id);
        return {};
      }
    }
  });
  return { store, database, dispatched, app: appFor(), appFor };
}

async function request(ids: string[], validSignature = true): Promise<Request> {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "123456789012345", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "15551234567" },
      messages: ids.map(id => ({ id, from: "15550001111", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "synthetic" } }))
    } }] }]
  });
  const provider = await createCryptoProvider();
  const digest = await provider.hmacSha256(validSignature ? "synthetic-secret" : "wrong-secret", body);
  const hex = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://service.test/webhooks/whatsapp", {
    method: "POST", body, headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${hex}` }
  });
}

function failInserts(database: Database, afterFirst = false) {
  database.exec(`CREATE TRIGGER reject_webhook_record BEFORE INSERT ON wats_webhook_events
    ${afterFirst ? "WHEN (SELECT COUNT(*) FROM wats_webhook_events) = 1" : ""}
    BEGIN SELECT RAISE(ABORT, 'private-backend-detail'); END`);
}

async function expectUnavailable(app: ReturnType<typeof createWatsServiceApp>, input: Request) {
  // Await directly: an escaped rejection is a test failure, not a passing error case.
  const response = await app.fetch(input);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "persistence_unavailable", message: "Webhook deduplication store is unavailable." } });
}

describe("signed webhook dedup storage failures", () => {
  test("OpenAPI declares the retryable dedup failure and validates its actual response", async () => {
    const f = await fixture();
    const document = await (await f.app.fetch(new Request("https://service.test/openapi.json"))).json() as {
      paths: Record<string, { post: { responses: Record<string, { content: Record<string, { schema: object }> }> } }>;
      components: { schemas: Record<string, object> };
    };
    const responseSchema = document.paths["/webhooks/whatsapp"]!.post.responses["503"];
    expect(responseSchema).toBeDefined();
    const ajv = new Ajv2020({ strict: false });
    for (const [name, schema] of Object.entries(document.components.schemas)) ajv.addSchema(schema, `#/components/schemas/${name}`);
    const validate = ajv.compile(responseSchema!.content["application/json"]!.schema);
    failInserts(f.database);
    const response = await f.app.fetch(await request(["wamid.schema"]));
    expect(response.status).toBe(503);
    expect(validate(await response.json())).toBe(true);
  });
  test("real SQLite insert fault returns a redacted retryable response and recovers", async () => {
    const f = await fixture();
    failInserts(f.database);
    await expectUnavailable(f.app, await request(["wamid.one"]));
    expect(f.dispatched).toEqual([]);
    expect((await f.store.listMessages({ limit: 10 })).items).toHaveLength(0);
    f.database.exec("DROP TRIGGER reject_webhook_record");
    expect((await f.app.fetch(await request(["wamid.one"]))).status).toBe(200);
    expect(f.dispatched).toEqual(["wamid.one"]);
  });

  test("a later batch fault does not strand earlier recorded updates on retry", async () => {
    const f = await fixture();
    failInserts(f.database, true);
    // The first update is successfully recorded and must be processed before
    // the second record fails; retry must process only the unfinished update.
    await expectUnavailable(f.app, await request(["wamid.first", "wamid.second"]));
    expect(f.dispatched).toEqual(["wamid.first"]);
    f.database.exec("DROP TRIGGER reject_webhook_record");
    expect((await f.app.fetch(await request(["wamid.first", "wamid.second"]))).status).toBe(200);
    expect(f.dispatched).toEqual(["wamid.first", "wamid.second"]);
    expect((await f.store.listMessages({ limit: 10 })).items).toHaveLength(2);
  });

  test("closed database fails closed without leaking store errors or dispatching", async () => {
    const f = await fixture();
    await f.store.close();
    await expectUnavailable(f.app, await request(["wamid.closed"]));
    expect(f.dispatched).toEqual([]);
  });

  test("invalid signature is rejected before a failing dedup store is touched", async () => {
    const f = await fixture();
    failInserts(f.database);
    expect((await f.app.fetch(await request(["wamid.invalid"], false))).status).toBe(401);
    expect(f.dispatched).toEqual([]);
  });
});
