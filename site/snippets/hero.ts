import { GraphClient, GraphRateLimitError, PhoneNumberClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";

const mock = createMockTransport();
const graphClient = new GraphClient({
  accessToken: "demo-token",
  apiVersion: "v25.0",
  baseUrl: "https://graph.facebook.com",
  transport: mock.transport,
});
const phone = new PhoneNumberClient({ graphClient, phoneNumberId: "1234567890" });

try {
  await phone.sendText({ to: "15550001111", text: "hello from WATS" });
} catch (err) {
  if (err instanceof GraphRateLimitError) console.log(err.retryAfter);
}

console.log(JSON.stringify(mock.requests, null, 2));
