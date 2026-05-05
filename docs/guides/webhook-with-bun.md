# Webhook Verification with Bun

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-21

## Goal

Show minimal Bun route wiring for webhook challenge and signature verification using C1 primitives from `@switchbord/http`.

## Minimal Example

```ts
import { validateWebhookSignature, verifyWebhookChallenge } from "@switchbord/http";

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN as string;
const appSecret = process.env.WHATSAPP_APP_SECRET as string;

Bun.serve({
  port: 3000,
  routes: {
    "/webhook": {
      GET: (req) => {
        const url = new URL(req.url);

        const result = verifyWebhookChallenge({
          mode: url.searchParams.get("hub.mode"),
          challenge: url.searchParams.get("hub.challenge"),
          verifyToken: url.searchParams.get("hub.verify_token"),
          expectedVerifyToken: verifyToken
        });

        if (!result.ok) {
          return new Response(result.error.message, { status: result.error.status });
        }

        return new Response(result.challenge, { status: 200 });
      },

      POST: async (req) => {
        const signatureHeader = req.headers.get("x-hub-signature-256");
        const rawBody = await req.text();

        const signature = validateWebhookSignature({
          appSecret,
          rawBody,
          signatureHeader
        });

        if (!signature.ok) {
          return new Response(signature.error.message, { status: 401 });
        }

        const payload = JSON.parse(rawBody) as unknown;
        // dispatch payload to your handlers

        return new Response("ok", { status: 200 });
      }
    }
  }
});
```

## Notes

- Always compute the signature from the raw request body bytes/string before JSON parsing.
- Keep `verifyToken` and `appSecret` in environment variables or a secrets manager.
- Primitives are transport-agnostic; Bun usage is only one integration pattern.
