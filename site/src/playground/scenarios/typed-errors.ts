import { GraphClient, GraphRateLimitError, PhoneNumberClient } from "@wats/graph"
import { createMockTransport } from "@wats/graph/testing"

// A 429 from Graph becomes a typed GraphRateLimitError — caught by class, with
// the retryAfter header surfaced as a typed field. No string matching.
const mock = createMockTransport({
  defaultResponse: {
    status: 429,
    headers: { "retry-after": "30" },
    body: {
      error: {
        message: "rate limit hit",
        type: "OAuthException",
        code: 130429,
      },
    },
  },
})

const graphClient = new GraphClient({
  accessToken: "demo-token",
  apiVersion: "v25.0",
  baseUrl: "https://graph.facebook.com",
  transport: mock.transport,
})

const phone = new PhoneNumberClient({
  graphClient,
  phoneNumberId: "1234567890",
})

try {
  await phone.sendText({ to: "15550001111", text: "hello from WATS" })
  console.log("send succeeded (unexpected)")
} catch (err) {
  if (err instanceof GraphRateLimitError) {
    console.log("rate limited, retryAfter=", err.retryAfter)
  } else {
    console.log("unexpected error:", err)
  }
}

report(mock)
