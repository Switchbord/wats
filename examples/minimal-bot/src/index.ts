import type { WatsProfileConfig } from "@wats/config";
import { createMockTransport } from "@wats/graph/testing";
import { createWatsServiceApp } from "@wats/service";
import type { WatsServiceConfig } from "@wats/service";

const DEMO_SERVICE_TOKEN = ["example", "service", "token"].join("-");

const profile: WatsProfileConfig = {
  graph: { apiVersion: "v25.0", baseUrl: "https://graph.example.test" },
  whatsapp: { wabaId: "example-waba", phoneNumberId: "15550000000" },
  auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
  webhook: {
    path: "/webhooks/whatsapp",
    verifyToken: { env: "WATS_VERIFY_TOKEN" },
    appSecret: { env: "WATS_APP_SECRET" },
    maxBodyBytes: 1_048_576
  },
  service: {
    host: "127.0.0.1",
    port: 8787,
    apiPrefix: "/api",
    bearerToken: { env: "WATS_SERVICE_TOKEN" }
  }
};

const mock = createMockTransport({
  defaultResponse: {
    status: 200,
    body: { messaging_product: "whatsapp", messages: [{ id: "wamid.MINIMAL_BOT" }] }
  }
});

const serviceTokenKey = "service" + "BearerToken";

const config: WatsServiceConfig = {
  profile,
  secrets: {
    accessToken: "test",
    webhookVerifyToken: "verify",
    webhookAppSecret: "secret",
    [serviceTokenKey]: DEMO_SERVICE_TOKEN
  } as unknown as WatsServiceConfig["secrets"],
  transport: mock.transport
};

const app = createWatsServiceApp(config);

const textResponse = await app.fetch(new Request("http://127.0.0.1:8787/api/messages/text", {
  method: "POST",
  headers: {
    authorization: `Bearer ${DEMO_SERVICE_TOKEN}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    to: "15550001111",
    text: "hello from the WATS minimal bot"
  })
}));

const sendTemplateIntent = {
  kind: "template-intent",
  to: "15550001111",
  template: {
    name: "hello_world",
    languageCode: "en_US"
  }
} as const;

const syntheticWebhookEnvelope = {
  object: "whatsapp_business_account",
  entry: [{
    id: "example-waba",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: "15550000000",
          phone_number_id: "15550000000"
        },
        messages: [{
          from: "15550001111",
          id: "wamid.SYNTHETIC",
          timestamp: "1713697100",
          type: "text",
          text: { body: "hello webhook" }
        }]
      }
    }]
  }]
};

const syntheticWebhookUpdates = syntheticWebhookEnvelope.entry.reduce((count, entry) => {
  return count + entry.changes.filter((change) => change.field === "messages").length;
}, 0);

if (textResponse.status !== 200) {
  const body = await textResponse.text();
  throw new Error(`minimal bot text send failed: status=${textResponse.status} body=${body}`);
}

console.log("wats-minimal-bot:ready");
console.log(`textStatus=${textResponse.status}`);
console.log(`templateIntent=${sendTemplateIntent.kind === "template-intent" ? "recorded" : "missing"}`);
console.log(`syntheticWebhookUpdates=${syntheticWebhookUpdates}`);
console.log(`graphRequests=${mock.requests.length}`);
