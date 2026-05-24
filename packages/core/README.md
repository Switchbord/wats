# @wats/core

Typed webhook normalization, filters, routers, listener registry, and the `WhatsApp` facade that composes Graph, routing, and scoped client helpers.

## Install

```bash
bun add @wats/core
npm i @wats/core
```

## Usage

```ts
import { TypedRouter, filtersTyped } from "@wats/core";

const router = new TypedRouter();
router.on(filtersTyped.message.text(), async (update) => {
  console.log(update.message.text.body);
});

await router.dispatch({
  type: "message",
  message: { type: "text", text: { body: "hello" } }
});
```

Pair this package with `@wats/http` for webhook ingestion and `@wats/graph` for outbound Graph calls.

Docs: https://github.com/Switchbord/wats
License: MIT
