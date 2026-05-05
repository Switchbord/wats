# WhatsApp facade reference (`WhatsApp`)

- status: active
- applies-to: `@switchbord/core` (`0.2.0-foundations-complete`)
- lastReviewed: 2026-04-28

## WhatsApp

`WhatsApp` is the WATS-26 / Arch-L composition root for application code. It does not hide the lower-level packages; it binds them into one object so handlers, listeners, webhook dispatch, and scoped Graph calls share the same runtime context. The class shipped in the F-10 scope and was extended with listener support in F-11.

## Construction

```ts
import { WhatsApp } from "@switchbord/core";
import { GraphClient, createFetchTransport } from "@switchbord/graph";

const graphClient = new GraphClient({
  accessToken: process.env.META_WA_TOKEN!,
  apiVersion: "v21.0",
  transport: createFetchTransport()
});

const wa = new WhatsApp({
  graphClient,
  phoneNumberId: "1234567890",
  wabaId: "99999",
  routerOptions: { concurrency: "sequential" }
});
```

Required:

- `graphClient: GraphClient` — or a structural object exposing `request(...)`.

Optional (`WhatsAppFacadeConfig`):

- `phoneNumberId?: string` — creates `wa.phoneNumberClient`.
- `wabaId?: string` — creates `wa.wabaClient`.
- `router?: TypedRouter` — reuse an existing router.
- `observer?: RouterObserver` — dispatch/listener observability hooks.
- `routerOptions?: TypedRouterOptions` — options for a default router.
- `listenerRegistry?: ListenerRegistry` — reuse an existing listener registry.
- `listenerRegistryOptions?: ListenerRegistryOptions` — options for lazy registry creation.

Construction-time validation checks required shapes immediately. Facade config failures throw `WhatsAppFacadeConfigError`; path-unsafe scoped ids propagate the underlying `GraphRequestValidationError` from the Graph scoped-client validators.

## Exposed components

```ts
wa.graphClient;          // GraphClient
wa.phoneNumberClient;    // PhoneNumberClient | undefined
wa.wabaClient;           // WABAClient | undefined
wa.router;               // TypedRouter
wa.listenerRegistry;     // ListenerRegistry | undefined
wa.activeListenerCount;  // number
```

Absent ids produce `undefined` scoped clients. Use optional chaining:

```ts
await wa.phoneNumberClient?.sendMessage({
  messaging_product: "whatsapp",
  to: "15551230000",
  type: "text",
  text: { body: "hello" }
});
```

## Handlers

`wa.on(filter, handler)` delegates directly to the underlying `TypedRouter` and returns the same `RegistrationHandle`.

```ts
import { and, message } from "@switchbord/core/filtersTyped";

const handle = wa.on(and(message, message.textMatches(/hello/i)), async (ctx) => {
  if (ctx.update.kind !== "message") return;

  await wa.phoneNumberClient?.sendMessage({
    messaging_product: "whatsapp",
    to: ctx.update.message.from,
    type: "text",
    text: { body: "hello back" }
  });
});

handle.unregister();
```

Router dispatch rules apply unchanged:

- registration-order matching
- sequential or parallel handler execution
- `"stop"` return to halt subsequent handlers
- handler/predicate errors collected into `DispatchReport.errors`
- dispatch resolves rather than propagating handler exceptions

## Listeners

`wa.listen(options)` registers a one-shot listener for a future typed update. The facade lazily creates a default listener registry when needed.

```ts
const nextReply = wa.listen({
  type: "message",
  from: "15551230000",
  timeoutMs: 30_000,
  description: "wait for next customer reply"
});

const update = await nextReply.promise;
```

Options:

- `type: "message" | "status" | "account" | "unknown"`
- `from?: string` — currently narrows message sender or status recipient.
- `filter?: TypedFilter<...>` — additional typed constraint.
- `timeoutMs?: number`
- `signal?: AbortSignal`
- `description?: string`

Listener evaluation runs before normal handler dispatch when `wa.dispatch(update)` is called. Listeners are additive; a matched listener does not prevent normal handlers from running.

## Dispatch

```ts
const report = await wa.dispatch(typedUpdate);
```

`dispatch` first evaluates facade listeners, then delegates to `TypedRouter.dispatch`. The returned `DispatchReport` is the router report.

`@switchbord/http` uses this shape through `createWebhookAdapter({ whatsapp: wa, ... })`, but the facade itself is not an HTTP server.

## Error taxonomy

- `WhatsAppFacadeConfigError`
  - `invalid_config`
  - `invalid_graph_client`
  - `invalid_phone_number_id`
  - `invalid_waba_id`
  - `invalid_router`
  - `invalid_observer`
  - `invalid_listener_registry`
  - `invalid_listener_registry_options`

- `WhatsAppListenOptionsError`
  - `invalid_listen_options`
  - `invalid_listen_type`
  - `invalid_listen_from`
  - `invalid_listen_filter`

Scoped-client id safety errors may be `GraphRequestValidationError` rather than facade-coded errors so the Graph path-param taxonomy remains consistent.

## Non-goals

The facade currently does not provide:

- a `createWhatsApp(...)` factory
- shorthand `onMessage(...)` / `onStatus(...)` methods
- a standalone HTTP service
- endpoint breadth beyond current `PhoneNumberClient` / `WABAClient` methods
- persistence for router or listener state
- retry/backoff for failed handlers

Future CLI/service packages should compose this facade rather than embedding new routing semantics.

## Related

- `docs/reference/router.md`
- `docs/reference/listeners.md`
- `docs/reference/scoped-clients.md`
- `docs/reference/webhook-adapter.md`
- `docs/architecture/public-api-surface.md`
