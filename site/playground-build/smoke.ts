// playground-build/smoke.ts
//
// Smoke test for the BUILT browser ESM bundle (T18 verification).
//
//   bun run smoke.ts
//
// Imports the generated site/public/playground/wats-bundle.js (NOT the source
// packages), constructs createMockTransport + GraphClient + PhoneNumberClient,
// sends a text, and prints the captured Graph request. This proves the bundle
// is self-contained and the real published packages work end-to-end.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(here, "..", "public", "playground", "wats-bundle.js");

const wats = await import(BUNDLE);
const { createMockTransport, GraphClient, PhoneNumberClient } = wats;

// MockTransport: returns a canned Graph "message sent" response and captures
// every outbound request (this is the playground's no-network proof primitive).
const mock = createMockTransport({
  defaultResponse: {
    status: 200,
    headers: { "content-type": "application/json" },
    body: {
      messaging_product: "whatsapp",
      contacts: [{ input: "15551234567", wa_id: "15551234567" }],
      messages: [{ id: "wamid.SMOKE_TEST_MESSAGE_ID" }],
    },
  },
});

const graph = new GraphClient({
  accessToken: "SMOKE_TEST_TOKEN_NOT_A_REAL_CREDENTIAL",
  apiVersion: "v21.0",
  transport: mock.transport,
});

const phone = new PhoneNumberClient({
  graphClient: graph,
  phoneNumberId: "123456789012345",
});

const sendResult = await phone.sendText({
  to: "15551234567",
  text: "Hello from the wats.sh playground bundle smoke test",
});

console.log("=== sendText result ===");
console.log(JSON.stringify(sendResult, null, 2));

console.log("\n=== mock.requests (captured Graph request) ===");
console.log(
  JSON.stringify(
    mock.requests.map((r: any) => ({
      method: r.method,
      url: r.url,
      headers: r.headers,
      body: r.body,
    })),
    null,
    2,
  ),
);

if (mock.requests.length !== 1) {
  console.error(`\nSMOKE FAIL: expected exactly 1 captured request, got ${mock.requests.length}`);
  process.exit(1);
}
console.log("\nSMOKE OK: bundle ran createMockTransport + GraphClient + PhoneNumberClient.sendText and captured the Graph request.");
