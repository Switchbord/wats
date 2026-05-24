# @wats/core

Typed webhook normalization, filters, routers, listener registry, and the `WhatsApp` facade that composes Graph, routing, and scoped client helpers.

## Install

```bash
bun add @wats/core
npm i @wats/core
```

## Usage

```ts
import { TypedRouter, filtersTyped, type TypedMessageUpdate } from "@wats/core";

const router = new TypedRouter();
router.on(filtersTyped.message.text(), async ({ update }) => {
  if (update.message.type === "text") {
    console.log(update.message.text.body);
  }
});

const update: TypedMessageUpdate = {
  kind: "message",
  updateId: "wamid.example",
  phoneNumberId: "1234567890",
  wabaId: "WABA_EXAMPLE",
  receivedAt: Date.now(),
  message: { id: "wamid.example", from: "15551234567", timestamp: "1713697100", type: "text", text: { body: "hello" } },
  rawChange: { field: "messages", value: { messagingProduct: "whatsapp", metadata: { displayPhoneNumber: "15551230000", phoneNumberId: "1234567890" }, messages: [] } }
};

await router.dispatch(update);
```

Pair this package with `@wats/http` for webhook ingestion and `@wats/graph` for outbound Graph calls.

Docs: https://github.com/Switchbord/wats
License: MIT
