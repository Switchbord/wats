// F-8 consumer fixture for @wats/core's webhookNormalizer.
//
// Imports ONLY through the published package specifier `@wats/core`
// (never via relative paths) so the external-shape contract is
// exercised across the workspace boundary. Runs a realistic multi-
// entry webhook envelope through `normalizeWebhookEnvelope` and
// asserts the TypedUpdate discriminated union, skipped reason
// taxonomy, CRLF/NUL defense on id-bearing fields, within-envelope
// duplicate-id dedup, and the soft-truncate limit surface.
//
// Emits a single-line JSON report on stdout and the success sentinel
// `core-consumer:ok` as the last line.

import * as rootEntrypoint from "@wats/core";
import {
  DEFAULT_MAX_EVENTS_PER_ENVELOPE,
  ListenerAbortError,
  ListenerTimeoutError,
  TypedRouter,
  WebhookNormalizationError,
  WhatsApp,
  createListenerRegistry,
  normalizeWebhookEnvelope,
  type WhatsAppSendButtonsInput,
  type WhatsAppSendImageInput,
  type WhatsAppSendLocationInput,
  type WhatsAppStartChatInput,
  type DispatchReport,
  type ListenerHandle,
  type NormalizedWebhookResult,
  type RegistrationHandle,
  type TypedAccountUpdate,
  type TypedCallStatusUpdate,
  type TypedCallUpdate,
  type TypedMessageUpdate,
  type TypedStatusUpdate,
  type TypedUnknownUpdate,
  type TypedUpdate
} from "@wats/core";
import {
  FILTER_BRAND,
  FilterValidationError,
  account,
  call,
  template,
  and,
  createTypedFilter,
  custom,
  isTypedFilter,
  message,
  not,
  or,
  status,
  unknown as unknownKind,
  type TypedFilter
} from "@wats/core/filtersTyped";
import { GraphClient } from "@wats/graph";
import { createMockTransport } from "@wats/graph/testing";

interface VerifyReportOk {
  readonly ok: true;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly sentinel: "core-consumer:ok";
  readonly moduleKeys: Readonly<Record<string, readonly string[]>>;
}

function makeEnvelope(): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-ALPHA",
        time: 1713697200,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001111",
                phone_number_id: "1234567890"
              },
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.AAA",
                  timestamp: "1713697100",
                  type: "text",
                  text: { body: "hello\r\nkeep\u0000bytes" }
                },
                {
                  from: "15551234567",
                  id: "wamid.IMG",
                  timestamp: "1713697103",
                  type: "image",
                  image: { id: "media-image", mime_type: "image/jpeg", sha256: "sha-image" }
                },
                {
                  from: "15551234567",
                  id: "wamid.CB",
                  timestamp: "1713697104",
                  type: "interactive",
                  interactive: { type: "button_reply", button_reply: { id: "btn-1", title: "Yes" } }
                },
                {
                  // duplicate id → second goes to skipped[]
                  from: "15551234567",
                  id: "wamid.AAA",
                  timestamp: "1713697101",
                  type: "text",
                  text: { body: "dup" }
                },
                {
                  // malformed — missing id
                  from: "15551234567",
                  timestamp: "1713697102",
                  type: "text",
                  text: { body: "no-id" }
                }
              ],
              statuses: [
                {
                  id: "wamid.STATUS1",
                  recipient_id: "15551234567",
                  status: "delivered",
                  timestamp: "1713697200"
                }
              ]
            }
          },
          { field: "account_update", value: { decision: "APPROVED" } },
          { field: "some_future_field", value: { raw: true } },
          null // malformed change
        ]
      },
      {
        id: "WABA-BETA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              // phone_number_id with CR/LF → all messages in this change
              // must be skipped with malformed_field.
              metadata: { phone_number_id: "bad\r\nphone" },
              messages: [
                {
                  from: "x",
                  id: "wamid.BETA1",
                  timestamp: "1",
                  type: "text",
                  text: { body: "hi" }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

async function verify(): Promise<VerifyReportOk> {
  const checks: Record<string, boolean> = {};

  checks["rootEntrypoint is a module namespace"] =
    typeof rootEntrypoint === "object" && rootEntrypoint !== null;
  checks["normalizeWebhookEnvelope is a function"] =
    typeof normalizeWebhookEnvelope === "function";
  checks["WebhookNormalizationError is a class"] =
    typeof WebhookNormalizationError === "function";
  checks["DEFAULT_MAX_EVENTS_PER_ENVELOPE is 1000"] =
    DEFAULT_MAX_EVENTS_PER_ENVELOPE === 1000;

  // Envelope-level error path — null envelope throws typed error.
  let caught: unknown;
  try {
    normalizeWebhookEnvelope(null);
  } catch (err) {
    caught = err;
  }
  checks["null envelope throws WebhookNormalizationError"] =
    caught instanceof WebhookNormalizationError &&
    (caught as WebhookNormalizationError).code === "invalid_envelope";
  // Sibling-NOT — must not escape as a raw TypeError.
  checks["thrown error is NOT a raw TypeError"] =
    !(caught instanceof TypeError) || caught instanceof WebhookNormalizationError;

  // Wrong-object envelope → unsupported_object.
  let wrongObj: unknown;
  try {
    normalizeWebhookEnvelope({ object: "page", entry: [] });
  } catch (err) {
    wrongObj = err;
  }
  checks["wrong object field → unsupported_object code"] =
    wrongObj instanceof WebhookNormalizationError &&
    (wrongObj as WebhookNormalizationError).code === "unsupported_object";

  // Main realistic envelope.
  const result: NormalizedWebhookResult = normalizeWebhookEnvelope(makeEnvelope());

  // Expect: wamid.AAA/wamid.IMG/wamid.CB (messages),
  // wamid.STATUS1 (status), account_update (account),
  // some_future_field (unknown) → 6 updates from entry[0].
  // Entry[1] messages change is skipped entirely because phone_number_id
  // fails the CR/LF gate → 0 updates from entry[1].
  checks["updates length is 6"] = result.updates.length === 6;

  // Skipped reasons must include duplicate_update_id, malformed_field
  // (missing-id and CRLF phone_number_id), and malformed_change.
  const skippedReasons = new Set(result.skipped.map((s) => s.reason));
  checks["skipped includes duplicate_update_id"] = skippedReasons.has(
    "duplicate_update_id"
  );
  checks["skipped includes malformed_field"] = skippedReasons.has(
    "malformed_field"
  );
  checks["skipped includes malformed_change"] = skippedReasons.has(
    "malformed_change"
  );

  // No limitError for the small realistic envelope.
  checks["no limitError on small envelope"] = result.limitError === undefined;

  // Narrow and assert discriminated-union exhaustiveness.
  const kinds = new Set<TypedUpdate["kind"]>();
  for (const u of result.updates) {
    kinds.add(u.kind);
    switch (u.kind) {
      case "message": {
        const m: TypedMessageUpdate = u;
        if (m.updateId === "wamid.AAA") {
          checks["message update wabaId is WABA-ALPHA"] =
            m.wabaId === "WABA-ALPHA";
          checks["message update phoneNumberId is 1234567890"] =
            m.phoneNumberId === "1234567890";
          checks["message update receivedAt is derived from timestamp"] =
            m.receivedAt === 1713697100 * 1000;
          // Sibling-class: kind is 'message', not 'status'/'account'/'unknown'.
          checks["message kind NOT status"] = (m.kind as string) !== "status";
        }
        break;
      }
      case "status": {
        const s: TypedStatusUpdate = u;
        if (s.updateId === "wamid.STATUS1") {
          checks["status update wabaId is WABA-ALPHA"] =
            s.wabaId === "WABA-ALPHA";
          checks["status update receivedAt is timestamp * 1000"] =
            s.receivedAt === 1713697200 * 1000;
        }
        break;
      }
      case "account": {
        const a: TypedAccountUpdate = u;
        checks["account update eventName is account_update"] =
          a.eventName === "account_update";
        break;
      }
      case "unknown": {
        const uu: TypedUnknownUpdate = u;
        checks["unknown update field is some_future_field"] =
          uu.field === "some_future_field";
        break;
      }
    }
  }
  checks["all four TypedUpdate kinds observed"] =
    kinds.has("message") &&
    kinds.has("status") &&
    kinds.has("account") &&
    kinds.has("unknown");

  // Soft-truncate: 5 messages with maxEventsPerEnvelope=3 → 3 updates +
  // limitError populated.
  const bigEnvelope = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-LIMIT",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "555" },
              messages: Array.from({ length: 5 }, (_, i) => ({
                from: "15551234567",
                id: `wamid.L${i}`,
                timestamp: "1",
                type: "text",
                text: { body: `msg-${i}` }
              }))
            }
          }
        ]
      }
    ]
  };
  const limitResult = normalizeWebhookEnvelope(bigEnvelope, {
    maxEventsPerEnvelope: 3
  });
  checks["soft-truncate yields exactly 3 updates"] =
    limitResult.updates.length === 3;
  checks["soft-truncate exposes limitError with limit=3"] =
    limitResult.limitError?.limit === 3 &&
    (limitResult.limitError?.count ?? 0) > 3;

  // Clock injection test.
  const clockEnvelope = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-CLOCK",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "111" },
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.C1",
                  type: "text",
                  text: { body: "h" }
                }
              ]
            }
          }
        ]
      }
    ]
  };
  const clockResult = normalizeWebhookEnvelope(clockEnvelope, {
    clockNow: () => 424_242
  });
  checks["injected clockNow used when timestamp missing"] =
    (clockResult.updates[0] as TypedMessageUpdate).receivedAt === 424_242;

  // ---- F-9 typed-filter surface round-trip ----------------------
  //
  // Assert the typed-filter surface is wired through @wats/core AND
  // the @wats/core/filtersTyped subpath, and that round-tripping a
  // compound filter over the realistic envelope above produces the
  // expected per-variant truth table. Every sibling-kind check
  // should return a boolean (never throw) — the router layer (F-10)
  // owns the final try/catch boundary.

  checks["TypedFilter surface exports are functions / branded"] =
    typeof createTypedFilter === "function" &&
    typeof isTypedFilter === "function" &&
    typeof and === "function" &&
    typeof or === "function" &&
    typeof not === "function" &&
    typeof custom === "function" &&
    typeof FilterValidationError === "function" &&
    typeof FILTER_BRAND === "symbol";

  checks["FILTER_BRAND is interned via Symbol.for"] =
    FILTER_BRAND === Symbol.for("@wats/core/filter-brand");

  checks["message / status / account / template / unknown are typed filters"] =
    isTypedFilter(message) &&
    isTypedFilter(status) &&
    isTypedFilter(account) &&
    isTypedFilter(template) &&
    isTypedFilter(call) &&
    isTypedFilter(unknownKind);

  // Compound filter: ANY message whose body matches /hello/i.
  const helloFilter: TypedFilter<TypedMessageUpdate> = and(
    message,
    message.textMatches(/hello/i)
  );
  checks["compound filter is branded"] = isTypedFilter(helloFilter);

  let helloMatches = 0;
  let statusMatches = 0;
  let sentSiblingFalse = 0;
  const deliveredFilter = status.delivered();
  for (const u of result.updates) {
    if (helloFilter.predicate(u)) {
      helloMatches += 1;
    }
    if (deliveredFilter.predicate(u)) {
      statusMatches += 1;
    }
    // Sibling-NOT: status.sent should NEVER throw on a message update.
    const sentFilter = status.sent();
    if (u.kind === "message" && sentFilter.predicate(u) === false) {
      sentSiblingFalse += 1;
    }
  }
  checks["compound /hello/i filter matches exactly one message"] =
    helloMatches === 1;
  const imageUpdate = result.updates.find(
    (u): u is TypedMessageUpdate => u.kind === "message" && u.updateId === "wamid.IMG"
  );
  const callbackUpdate = result.updates.find(
    (u): u is TypedMessageUpdate => u.kind === "message" && u.updateId === "wamid.CB"
  );
  checks["WATS-43A normalizer camelCases media payloads"] =
    imageUpdate?.message.type === "image" &&
    imageUpdate.message.image.mimeType === "image/jpeg" &&
    !("mime_type" in (imageUpdate.message.image as unknown as Record<string, unknown>));
  checks["WATS-43A filters match media and interactive callbacks"] =
    imageUpdate !== undefined &&
    callbackUpdate !== undefined &&
    message.image().predicate(imageUpdate) === true &&
    message.media().predicate(imageUpdate) === true &&
    message.interactiveButtonReply("btn-1").predicate(callbackUpdate) === true;
  checks["status.delivered matches exactly one status update"] =
    statusMatches === 1;
  checks["status.sent returns false on message updates (sibling-kind)"] =
    sentSiblingFalse >= 1;

  // Construction-time rejection surfaces a FilterValidationError.
  let emptyCaught: unknown;
  try {
    message.text("");
  } catch (err) {
    emptyCaught = err;
  }
  checks["message.text('') throws FilterValidationError(empty_substring)"] =
    emptyCaught instanceof FilterValidationError &&
    (emptyCaught as FilterValidationError).code === "empty_substring";

  let andEmptyCaught: unknown;
  try {
    and();
  } catch (err) {
    andEmptyCaught = err;
  }
  checks["and() with zero args throws FilterValidationError(empty_args)"] =
    andEmptyCaught instanceof FilterValidationError &&
    (andEmptyCaught as FilterValidationError).code === "empty_args";

  // Custom predicate + not() composition.
  const fromAlpha = custom<TypedMessageUpdate>(
    (u): u is TypedMessageUpdate =>
      u.kind === "message" && u.message.from === "15551234567",
    "from=15551234567"
  );
  const notAlpha = not(fromAlpha);
  checks["not(custom) inverts and returns a branded filter"] =
    isTypedFilter(notAlpha);

  // or() across two disjoint filters. or() infers T from the first
  // argument, so for a heterogeneous union we wrap each via
  // createTypedFilter<TypedUpdate> to broaden the inferred T.
  const anyMessage = createTypedFilter<TypedUpdate>(
    (u): u is TypedUpdate => u.kind === "message",
    () => "any-message"
  );
  const anyStatus = createTypedFilter<TypedUpdate>(
    (u): u is TypedUpdate => u.kind === "status",
    () => "any-status"
  );
  const anyMessageOrStatus: TypedFilter<TypedUpdate> = or(anyMessage, anyStatus);
  let anyMsgOrStatus = 0;
  for (const u of result.updates) {
    if (anyMessageOrStatus.predicate(u)) {
      anyMsgOrStatus += 1;
    }
  }
  checks["or(message, status) catches both kinds"] = anyMsgOrStatus === 4;

  const templateEnvelope = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-TEMPLATE",
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: "APPROVED",
              message_template_id: "tpl1",
              message_template_name: "order_ready",
              message_template_language: "en_US"
            }
          }
        ]
      }
    ]
  };
  const templateUpdate = normalizeWebhookEnvelope(templateEnvelope).updates[0] as TypedAccountUpdate;
  checks["template account update exposes normalized helper fields"] =
    templateUpdate.template?.event === "APPROVED" &&
    templateUpdate.template?.name === "order_ready";
  checks["template.status('APPROVED') matches template status update"] =
    template.status("APPROVED").predicate(templateUpdate) === true;
  checks["template.status('REJECTED') does not match approved update"] =
    template.status("REJECTED").predicate(templateUpdate) === false;

  const callEnvelope = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-CALL",
        changes: [
          {
            field: "calls",
            value: {
              metadata: { phone_number_id: "1234567890" },
              calls: [
                { id: "call-connect", event: "connect", direction: "USER_INITIATED", timestamp: "1" },
                { id: "call-terminate", event: "terminate", direction: "BUSINESS_INITIATED", timestamp: "2" }
              ],
              statuses: [
                { id: "call-status", status: "ACCEPTED", timestamp: "3" }
              ]
            }
          }
        ]
      }
    ]
  };
  const callResult = normalizeWebhookEnvelope(callEnvelope);
  const callConnectUpdate = callResult.updates[0] as TypedCallUpdate;
  const callTerminateUpdate = callResult.updates[1] as TypedCallUpdate;
  const callStatusUpdate = callResult.updates[2] as TypedCallStatusUpdate;
  checks["calling webhook normalizer emits typed call updates"] =
    callConnectUpdate.kind === "callConnect" &&
    callConnectUpdate.call.event === "connect" &&
    callTerminateUpdate.kind === "callTerminate" &&
    callStatusUpdate.kind === "callStatus" &&
    callStatusUpdate.callStatus.status === "ACCEPTED";
  checks["calling typed filters match event/status/direction helpers"] =
    call.connect().predicate(callConnectUpdate) === true &&
    call.terminate().predicate(callTerminateUpdate) === true &&
    call.answered().predicate(callStatusUpdate) === true &&
    call.incoming().predicate(callConnectUpdate) === true &&
    call.outgoing().predicate(callTerminateUpdate) === true &&
    call.connect().predicate(templateUpdate) === false;

  // ---- F-10 TypedRouter + WhatsApp facade round-trip -----------
  //
  // Exercise the composition root: a `WhatsApp` facade wrapping a
  // real `GraphClient` (backed by MockTransport — no network) plus
  // a `TypedRouter` that receives handler registrations and
  // dispatches synthetic TypedUpdate values. Asserts:
  //   - WhatsApp exposes graphClient + router + optional sub-clients
  //   - handlers fire in registration order on matching filters
  //   - non-matching filter (sibling-kind) does NOT fire
  //   - a throwing handler is captured in DispatchReport.errors —
  //     dispatch still resolves; sibling handlers still fire
  //   - unregister() during dispatch preserves snapshot semantics

  const mockHandle = createMockTransport({
    defaultResponse: {
      status: 200,
      body: { ok: true, messages: [{ id: "wamid.CORE" }] }
    }
  });
  const graphClient = new GraphClient({
    accessToken: "fixture-token",
    apiVersion: "v21.0",
    transport: mockHandle.transport
  });
  const facade = new WhatsApp({
    graphClient,
    phoneNumberId: "1234567890",
    wabaId: "99999"
  });

  checks["WhatsApp facade exposes GraphClient + router + sub-clients"] =
    facade.graphClient === graphClient &&
    facade.router instanceof TypedRouter &&
    facade.phoneNumberClient?.phoneNumberId === "1234567890" &&
    facade.wabaClient?.wabaId === "99999";

  mockHandle.reset();
  const startChatInput: WhatsAppStartChatInput = {
    to: "15551230002",
    text: "fixture start chat",
    previewUrl: false
  };
  const startChatRes = await facade.startChat(startChatInput);
  const startChatBody = JSON.parse(String(mockHandle.requests[0]?.body)) as {
    readonly to?: string;
    readonly type?: string;
    readonly text?: { readonly body?: string; readonly preview_url?: boolean };
  };
  checks["WhatsApp.startChat returns parsed response"] =
    startChatRes.messages?.[0]?.id === "wamid.CORE";
  checks["WhatsApp.startChat sends arbitrary recipient through @wats/core"] =
    mockHandle.requests[0]?.url ===
      "https://graph.facebook.com/v21.0/1234567890/messages" &&
    startChatBody.to === "15551230002" &&
    startChatBody.type === "text" &&
    startChatBody.text?.body === "fixture start chat" &&
    startChatBody.text?.preview_url === false;

  mockHandle.reset();
  const sendImageInput: WhatsAppSendImageInput = {
    to: "15551230003",
    mediaId: "IMG_ID",
    caption: "fixture image"
  };
  const sendImageRes = await facade.sendImage(sendImageInput);
  const sendImageBody = JSON.parse(String(mockHandle.requests[0]?.body)) as {
    readonly to?: string;
    readonly type?: string;
    readonly image?: { readonly id?: string; readonly caption?: string };
  };
  checks["WhatsApp.sendImage returns parsed response"] =
    sendImageRes.messages?.[0]?.id === "wamid.CORE";
  checks["WhatsApp.sendImage sends exact media payload through @wats/core"] =
    mockHandle.requests[0]?.url ===
      "https://graph.facebook.com/v21.0/1234567890/messages" &&
    sendImageBody.to === "15551230003" &&
    sendImageBody.type === "image" &&
    sendImageBody.image?.id === "IMG_ID" &&
    sendImageBody.image?.caption === "fixture image";

  mockHandle.reset();
  const sendLocationInput: WhatsAppSendLocationInput = {
    to: "15551230004",
    latitude: 1,
    longitude: 2
  };
  await facade.sendLocation(sendLocationInput);
  const sendLocationBody = JSON.parse(String(mockHandle.requests[0]?.body)) as {
    readonly type?: string;
    readonly location?: { readonly latitude?: number; readonly longitude?: number };
  };
  checks["WhatsApp.sendLocation sends exact location payload through @wats/core"] =
    sendLocationBody.type === "location" &&
    sendLocationBody.location?.latitude === 1 &&
    sendLocationBody.location?.longitude === 2;

  mockHandle.reset();
  const sendButtonsInput: WhatsAppSendButtonsInput = {
    to: "15551230005",
    bodyText: "fixture buttons",
    buttons: [{ id: "yes", title: "Yes" }]
  };
  await facade.sendButtons(sendButtonsInput);
  const sendButtonsBody = JSON.parse(String(mockHandle.requests[0]?.body)) as {
    readonly type?: string;
    readonly interactive?: { readonly type?: string };
  };
  checks["WhatsApp.sendButtons sends interactive payload through @wats/core"] =
    sendButtonsBody.type === "interactive" &&
    sendButtonsBody.interactive?.type === "button";

  // A synthetic TypedMessageUpdate (no network; constructed in-memory).
  const synthetic: TypedMessageUpdate = {
    kind: "message",
    updateId: "wamid.FIX1",
    phoneNumberId: "1234567890",
    wabaId: "WABA-FIX",
    receivedAt: 1_713_700_000_000,
    message: {
      from: "15550001111",
      id: "wamid.FIX1",
      timestamp: "1713700000",
      type: "text",
      text: { body: "hello fixture" }
    } as TypedMessageUpdate["message"],
    rawChange: {
      field: "messages",
      value: { messaging_product: "whatsapp", metadata: {}, messages: [] }
    } as TypedMessageUpdate["rawChange"]
  };

  const callOrder: string[] = [];
  const h1: RegistrationHandle = facade.on(message, () => {
    callOrder.push("h1");
  });
  const h2: RegistrationHandle = facade.on(status, () => {
    callOrder.push("h2-status");
  });
  const h3: RegistrationHandle = facade.on(
    and(message, message.textMatches(/fixture/i)),
    () => {
      callOrder.push("h3");
    }
  );
  const reportA: DispatchReport = await facade.dispatch(synthetic);
  checks["router dispatches 3 handlers in registration order"] =
    callOrder[0] === "h1" &&
    callOrder[1] === "h3" &&
    callOrder.length === 2 &&
    reportA.matchedHandlers === 2 &&
    reportA.errors.length === 0;
  // Sibling-kind: the status handler must NOT fire on a message update.
  checks["non-matching handler does not fire (sibling-kind)"] =
    !callOrder.includes("h2-status");

  // A throwing handler + snapshot-semantics unregister test.
  h1.unregister();
  h2.unregister();
  h3.unregister();
  callOrder.length = 0;
  const thrower: RegistrationHandle = facade.on(message, () => {
    throw new Error("fixture-boom");
  });
  const keeper: RegistrationHandle = facade.on(message, () => {
    callOrder.push("keeper");
  });
  let unregInDispatch: RegistrationHandle | undefined;
  facade.on(message, () => {
    callOrder.push("gatekeeper");
    unregInDispatch?.unregister();
  });
  unregInDispatch = facade.on(message, () => {
    callOrder.push("late");
  });

  const reportB: DispatchReport = await facade.dispatch(synthetic);
  checks["throwing handler is captured in DispatchReport.errors"] =
    reportB.errors.length === 1 &&
    reportB.errors[0]?.handleId === thrower.id &&
    callOrder.includes("keeper");
  checks["unregister() during dispatch preserves snapshot"] =
    callOrder.includes("gatekeeper") && callOrder.includes("late");

  // Scoped-client absent when id is absent (explicitly undefined).
  const barebone = new WhatsApp({ graphClient });
  checks["absent phoneNumberId → phoneNumberClient is undefined"] =
    barebone.phoneNumberClient === undefined &&
    barebone.wabaClient === undefined;

  // Keep keeper used to avoid dead-code elimination concerns.
  void keeper;

  // ---- F-11 listener substrate round-trip ----------------------
  //
  // Exercises the facade-owned listener substrate: constructs a
  // brand-new WhatsApp facade over MockTransport, registers a
  // `wa.listen({ type: "message" })` listener + a plain handler,
  // dispatches a matching synthetic TypedMessageUpdate, and asserts:
  //   - handle is a ListenerHandle shape (id, promise, cancel,
  //     cancelled, settled)
  //   - wa.activeListenerCount is 1 pre-dispatch, 0 post-resolve
  //   - listener resolves to the typed-narrowed update
  //   - listener.promise races against a setTimeout reject to pin
  //     the resolve path (not the timeout path)
  //   - wa.listenerRegistry is the lazily-created registry (or the
  //     caller-supplied one)
  //   - cancel() rejects pending listeners with
  //     ListenerAbortError(code "listener_cancelled")
  //   - a ListenerTimeoutError fires on `timeoutMs` expiry
  //   - the createListenerRegistry factory is re-exported from
  //     @wats/core alongside the facade method

  const listenerFacade = new WhatsApp({
    graphClient,
    phoneNumberId: "1234567890"
  });

  // Shape: the listener handle carries all five public fields.
  const listenerH: ListenerHandle<TypedMessageUpdate> = listenerFacade.listen({
    type: "message"
  });
  checks["wa.listen({ type: 'message' }) returns a ListenerHandle"] =
    typeof listenerH.id === "symbol" &&
    listenerH.promise instanceof Promise &&
    listenerH.cancelled === false &&
    listenerH.settled === false &&
    typeof listenerH.cancel === "function";

  checks["facade activeListenerCount reflects register + resolve lifecycle"] =
    listenerFacade.activeListenerCount === 1;

  // Handler fires too (additive, not short-circuit).
  let handlerFired = 0;
  const handlerReg: RegistrationHandle = listenerFacade.on(
    // Kind-only message filter is the root-barrel `WhatsApp` doesn't
    // export; pull it through filtersTyped.
    message,
    () => {
      handlerFired += 1;
    }
  );

  const listenerUpdate: TypedMessageUpdate = {
    kind: "message",
    updateId: "wamid.L1",
    phoneNumberId: "1234567890",
    wabaId: "WABA-L",
    receivedAt: 1_713_700_100_000,
    message: {
      from: "15550001111",
      id: "wamid.L1",
      timestamp: "1713700100",
      type: "text",
      text: { body: "listener fixture" }
    } as TypedMessageUpdate["message"],
    rawChange: {
      field: "messages",
      value: { messaging_product: "whatsapp", metadata: {}, messages: [] }
    } as TypedMessageUpdate["rawChange"]
  };

  await listenerFacade.dispatch(listenerUpdate);
  const resolvedUpdate = await listenerH.promise;
  checks["listener resolves via wa.dispatch() with typed narrowing"] =
    resolvedUpdate.kind === "message" &&
    resolvedUpdate.updateId === "wamid.L1" &&
    resolvedUpdate.message.from === "15550001111" &&
    handlerFired === 1 &&
    listenerFacade.activeListenerCount === 0;
  handlerReg.unregister();

  // Lazy registry getter now returns the in-memory registry.
  checks["wa.listenerRegistry is defined after first .listen()"] =
    listenerFacade.listenerRegistry !== undefined &&
    listenerFacade.listenerRegistry?.activeCount === 0;

  // Timeout rejection path.
  const timeoutH = listenerFacade.listen({
    type: "message",
    timeoutMs: 20
  });
  let timeoutErr: unknown;
  try {
    await timeoutH.promise;
  } catch (e) {
    timeoutErr = e;
  }
  checks["listener timeout rejects with ListenerTimeoutError"] =
    timeoutErr instanceof ListenerTimeoutError &&
    (timeoutErr as ListenerTimeoutError).code === "listener_timeout" &&
    (timeoutErr as ListenerTimeoutError).timeoutMs === 20 &&
    listenerFacade.activeListenerCount === 0;

  // Cancel path.
  const cancelH = listenerFacade.listen({ type: "message" });
  cancelH.cancel();
  let cancelErr: unknown;
  try {
    await cancelH.promise;
  } catch (e) {
    cancelErr = e;
  }
  checks["listener cancel() rejects with ListenerAbortError(cancelled)"] =
    cancelErr instanceof ListenerAbortError &&
    (cancelErr as ListenerAbortError).code === "listener_cancelled" &&
    cancelH.cancelled === true &&
    cancelH.settled === true;

  // Caller-supplied registry is reused.
  const sharedRegistry = createListenerRegistry({ maxActiveListeners: 5 });
  const sharedFacade = new WhatsApp({
    graphClient,
    listenerRegistry: sharedRegistry
  });
  checks["createListenerRegistry factory re-exported + reused by facade"] =
    sharedFacade.listenerRegistry === sharedRegistry &&
    typeof createListenerRegistry === "function";

  void sharedFacade;

  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) {
      throw new Error(`core-consumer check failed: ${label}`);
    }
  }

  return {
    ok: true,
    checks,
    sentinel: "core-consumer:ok",
    moduleKeys: {
      "@wats/core": Object.keys(rootEntrypoint).sort()
    }
  };
}

const report = await verify();
console.log(JSON.stringify(report));
console.log(report.sentinel);
