// @wats/core — whatsappFacade.ts (F-11 GREEN)
//
// Composition root: `WhatsApp` binds a `GraphClient` (mandatory),
// optional `PhoneNumberClient` / `WABAClient` sub-clients scoped by
// id, a `TypedRouter`, and (F-11) a listener substrate for
// conversational `listen → dispatch → resolve` flows. Closes WATS-22
// (Arch-H) + WATS-26 (Arch-L facade).
//
// Design:
//   - Thin BINDING layer. All heavy lifting lives in the components
//     the facade wires together — GraphClient (transport), F-7 scoped
//     sub-clients (id-bound endpoint methods), TypedRouter (handler
//     registry + dispatch), ListenerRegistry (F-11 listener
//     substrate).
//   - Constructor validation is strict AND construction-time: caller
//     receives a WhatsAppFacadeConfigError (or, for id shape failures,
//     the underlying GraphRequestValidationError from F-7 validators)
//     BEFORE any network or dispatch activity.
//   - `phoneNumberId` / `wabaId` are OPTIONAL. When present the facade
//     auto-constructs the matching sub-client; when absent, the
//     corresponding getter returns `undefined` (explicitly NOT an
//     empty object, so `wa.phoneNumberClient?.sendMessage(...)` is
//     the correct guarded-call idiom).
//   - A caller-supplied `router` is REUSED (not replaced). Otherwise
//     a new TypedRouter is constructed from `routerOptions` (with the
//     top-level `observer` merged in as a convenience).
//   - `.listen(options)` lazily initializes a default
//     ListenerRegistry on first call (unless the caller supplied one
//     via config.listenerRegistry). The facade wraps `.dispatch()`
//     so listeners evaluate BEFORE handler dispatch per the F-11 plan
//     DoD — first-match-wins semantics are delegated to the registry.
//
// Non-goals (reiterated for the scope ledger):
//   - No webhook HTTP integration (F-12).
//   - No endpoint-catalog breadth beyond what the sub-clients already
//     expose in F-7.
//   - No cross-instance listener distribution; no persistence.

import {
  GraphClient,
  GraphRequestValidationError,
  PhoneNumberClient,
  WABAClient,
  type GraphMessagesMarkMessageAsReadInput,
  type GraphMessagesRemoveReactionInput,
  type GraphMessagesRequestLocationInput,
  type GraphMessagesSendAudioInput,
  type GraphMessagesSendButtonsInput,
  type GraphMessagesSendCatalogInput,
  type GraphMessagesSendContactsInput,
  type GraphMessagesSendCtaUrlInput,
  type GraphMessagesSendDocumentInput,
  type GraphMessagesSendImageInput,
  type GraphMessagesSendListInput,
  type GraphMessagesSendLocationInput,
  type GraphMessagesSendProductInput,
  type GraphMessagesSendProductsInput,
  type GraphMessagesSendReactionInput,
  type GraphMessagesSendResponse,
  type GraphMessagesSendStickerInput,
  type GraphMessagesSendTemplateInput,
  type GraphMessagesSendTextInput,
  type GraphMessagesSendVideoInput,
  type GraphMessagesTypingIndicatorInput
} from "@wats/graph";
import {
  and,
  createTypedFilter,
  message as messageFilter,
  status as statusFilter,
  account as accountFilter,
  unknown as unknownFilter,
  call as callFilter
} from "./filtersTyped/index.js";
import type { TypedFilter } from "./filtersTyped/typedFilter.js";
import {
  normalizeWebhookEnvelope,
  type NormalizedWebhookResult,
  type TypedAccountUpdate,
  type TypedCallStatusUpdate,
  type TypedCallUpdate,
  type TypedMessageUpdate,
  type TypedStatusUpdate,
  type TypedUnknownUpdate,
  type TypedUpdate
} from "./webhookNormalizer.js";
import type {
  DispatchReport,
  Handler,
  RegistrationHandle,
  RouterObserver,
  TypedRouterOptions
} from "./typedRouter.js";
import { TypedRouter } from "./typedRouter.js";
import {
  createListenerRegistry,
  type ListenerHandle,
  type ListenerOptions,
  type ListenerRegistry,
  type ListenerRegistryOptions
} from "./listener.js";

export interface WhatsAppFacadeConfig {
  readonly graphClient: GraphClient;
  readonly phoneNumberId?: string;
  readonly wabaId?: string;
  readonly router?: TypedRouter;
  readonly observer?: RouterObserver;
  readonly routerOptions?: TypedRouterOptions;
  // F-11 listener substrate integration. When a caller passes an
  // explicit `listenerRegistry`, the facade reuses it (and exposes it
  // via the `listenerRegistry` getter). When absent, a default in-
  // memory registry is lazily created on first `.listen()` call.
  readonly listenerRegistry?: ListenerRegistry;
  readonly listenerRegistryOptions?: ListenerRegistryOptions;
}

// Per-call listen options. `type` narrows the TypedUpdate discriminant
// (e.g. "message" → TypedMessageUpdate). `from` optionally narrows
// message updates to a single sender wa_id. `filter` (optional) allows
// arbitrary additional constraints that compose ABOVE the kind gate.
export interface WhatsAppListenOptions<
  TKind extends TypedUpdate["kind"] = TypedUpdate["kind"]
> {
  readonly type: TKind;
  readonly from?: string;
  readonly filter?: TypedFilter<Extract<TypedUpdate, { kind: TKind }>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly description?: string;
}

export type WhatsAppStartChatInput = GraphMessagesSendTextInput;
export type WhatsAppSendImageInput = GraphMessagesSendImageInput;
export type WhatsAppSendVideoInput = GraphMessagesSendVideoInput;
export type WhatsAppSendAudioInput = GraphMessagesSendAudioInput;
export type WhatsAppSendDocumentInput = GraphMessagesSendDocumentInput;
export type WhatsAppSendStickerInput = GraphMessagesSendStickerInput;
export type WhatsAppSendLocationInput = GraphMessagesSendLocationInput;
export type WhatsAppSendContactsInput = GraphMessagesSendContactsInput;
export type WhatsAppSendReactionInput = GraphMessagesSendReactionInput;
export type WhatsAppRemoveReactionInput = GraphMessagesRemoveReactionInput;
export type WhatsAppSendButtonsInput = GraphMessagesSendButtonsInput;
export type WhatsAppSendListInput = GraphMessagesSendListInput;
export type WhatsAppSendCtaUrlInput = GraphMessagesSendCtaUrlInput;
export type WhatsAppSendProductInput = GraphMessagesSendProductInput;
export type WhatsAppSendProductsInput = GraphMessagesSendProductsInput;
export type WhatsAppSendCatalogInput = GraphMessagesSendCatalogInput;
export type WhatsAppRequestLocationInput = GraphMessagesRequestLocationInput;
export type WhatsAppMarkMessageAsReadInput = GraphMessagesMarkMessageAsReadInput;
export type WhatsAppTypingIndicatorInput = GraphMessagesTypingIndicatorInput;
export type WhatsAppSendTemplateInput = GraphMessagesSendTemplateInput;

export type WhatsAppListenErrorCode =
  | "invalid_listen_options"
  | "invalid_listen_type"
  | "invalid_listen_from"
  | "invalid_listen_filter";

export class WhatsAppListenOptionsError extends Error {
  readonly code: WhatsAppListenErrorCode;
  constructor(code: WhatsAppListenErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WhatsAppListenOptionsError";
    this.code = code;
  }
}

export type WhatsAppFacadeErrorCode =
  | "invalid_config"
  | "invalid_graph_client"
  | "invalid_phone_number_id"
  | "invalid_waba_id"
  | "invalid_router"
  | "invalid_observer"
  | "invalid_listener_registry"
  | "invalid_listener_registry_options";

export class WhatsAppFacadeConfigError extends Error {
  readonly code: WhatsAppFacadeErrorCode;
  constructor(code: WhatsAppFacadeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WhatsAppFacadeConfigError";
    this.code = code;
  }
}

function hasRequestMethod(
  candidate: unknown
): candidate is { request: (...args: readonly unknown[]) => unknown } {
  if (candidate === null || typeof candidate !== "object") return false;
  const maybe = candidate as { request?: unknown };
  return typeof maybe.request === "function";
}

// ---- kind → base filter dispatch ----------------------------------

const KIND_FILTERS: {
  readonly message: TypedFilter<TypedMessageUpdate>;
  readonly status: TypedFilter<TypedStatusUpdate>;
  readonly account: TypedFilter<TypedAccountUpdate>;
  readonly unknown: TypedFilter<TypedUnknownUpdate>;
  readonly callConnect: TypedFilter<TypedCallUpdate>;
  readonly callTerminate: TypedFilter<TypedCallUpdate>;
  readonly callStatus: TypedFilter<TypedCallStatusUpdate>;
} = {
  message: messageFilter,
  status: statusFilter,
  account: accountFilter,
  unknown: unknownFilter,
  callConnect: callFilter.connect(),
  callTerminate: callFilter.terminate(),
  callStatus: callFilter.status()
};

const VALID_KINDS: readonly TypedUpdate["kind"][] = [
  "message",
  "status",
  "account",
  "unknown",
  "callConnect",
  "callTerminate",
  "callStatus"
];

function buildListenFilter<TKind extends TypedUpdate["kind"]>(
  options: WhatsAppListenOptions<TKind>
): TypedFilter<Extract<TypedUpdate, { kind: TKind }>> {
  const kindFilter = KIND_FILTERS[options.type] as TypedFilter<
    Extract<TypedUpdate, { kind: TKind }>
  >;
  const parts: TypedFilter<Extract<TypedUpdate, { kind: TKind }>>[] = [
    kindFilter
  ];
  if (options.from !== undefined) {
    const from = options.from;
    const fromFilter = createTypedFilter<
      Extract<TypedUpdate, { kind: TKind }>
    >(
      ((u: TypedUpdate): u is Extract<TypedUpdate, { kind: TKind }> => {
        if (u.kind !== options.type) return false;
        if (u.kind === "message") return u.message.from === from;
        if (u.kind === "status") {
          const sid = (u.status as { recipient_id?: unknown })?.recipient_id;
          return sid === from;
        }
        return false;
      }) as (u: TypedUpdate) => u is Extract<TypedUpdate, { kind: TKind }>,
      () => `from=${from}`
    );
    parts.push(fromFilter);
  }
  if (options.filter !== undefined) {
    parts.push(options.filter);
  }
  if (parts.length === 1) return parts[0]!;
  return and(...parts) as TypedFilter<Extract<TypedUpdate, { kind: TKind }>>;
}

// ---- WhatsApp facade ----------------------------------------------

export class WhatsApp {
  readonly #graphClient: GraphClient;
  readonly #phoneNumberClient: PhoneNumberClient | undefined;
  readonly #wabaClient: WABAClient | undefined;
  readonly #router: TypedRouter;
  readonly #observer: RouterObserver | undefined;
  readonly #listenerRegistryOptions: ListenerRegistryOptions | undefined;
  #listenerRegistry: ListenerRegistry | undefined;

  constructor(config: WhatsAppFacadeConfig) {
    if (typeof config !== "object" || config === null) {
      throw new WhatsAppFacadeConfigError(
        "invalid_config",
        "WhatsApp: config must be an options object."
      );
    }

    const {
      graphClient,
      phoneNumberId,
      wabaId,
      router,
      observer,
      routerOptions,
      listenerRegistry,
      listenerRegistryOptions
    } = config;

    if (!hasRequestMethod(graphClient)) {
      throw new WhatsAppFacadeConfigError(
        "invalid_graph_client",
        "WhatsApp: graphClient must expose a request() method."
      );
    }

    if (observer !== undefined) {
      if (typeof observer !== "object" || observer === null) {
        throw new WhatsAppFacadeConfigError(
          "invalid_observer",
          "WhatsApp: observer must be an object if provided."
        );
      }
    }

    if (router !== undefined && !(router instanceof TypedRouter)) {
      throw new WhatsAppFacadeConfigError(
        "invalid_router",
        "WhatsApp: router must be a TypedRouter instance if provided."
      );
    }

    if (listenerRegistry !== undefined) {
      if (
        typeof listenerRegistry !== "object" ||
        listenerRegistry === null ||
        typeof (listenerRegistry as { register?: unknown }).register !==
          "function" ||
        typeof (listenerRegistry as { evaluate?: unknown }).evaluate !==
          "function" ||
        typeof (listenerRegistry as { clear?: unknown }).clear !== "function"
      ) {
        throw new WhatsAppFacadeConfigError(
          "invalid_listener_registry",
          "WhatsApp: listenerRegistry must be a ListenerRegistry-shaped object."
        );
      }
    }

    if (
      listenerRegistryOptions !== undefined &&
      (typeof listenerRegistryOptions !== "object" ||
        listenerRegistryOptions === null)
    ) {
      throw new WhatsAppFacadeConfigError(
        "invalid_listener_registry_options",
        "WhatsApp: listenerRegistryOptions must be an object if provided."
      );
    }

    let phoneNumberClient: PhoneNumberClient | undefined;
    if (phoneNumberId !== undefined) {
      if (typeof phoneNumberId !== "string" || phoneNumberId.length === 0) {
        throw new WhatsAppFacadeConfigError(
          "invalid_phone_number_id",
          "WhatsApp: phoneNumberId must be a non-empty string if provided."
        );
      }
      phoneNumberClient = new PhoneNumberClient({
        graphClient,
        phoneNumberId
      });
    }

    let wabaClient: WABAClient | undefined;
    if (wabaId !== undefined) {
      if (typeof wabaId !== "string" || wabaId.length === 0) {
        throw new WhatsAppFacadeConfigError(
          "invalid_waba_id",
          "WhatsApp: wabaId must be a non-empty string if provided."
        );
      }
      wabaClient = new WABAClient({ graphClient, wabaId });
    }

    const effectiveRouter: TypedRouter =
      router ??
      new TypedRouter({
        ...(routerOptions ?? {}),
        observer: observer ?? routerOptions?.observer
      });

    this.#graphClient = graphClient;
    this.#phoneNumberClient = phoneNumberClient;
    this.#wabaClient = wabaClient;
    this.#router = effectiveRouter;
    this.#observer = observer ?? routerOptions?.observer;
    this.#listenerRegistry = listenerRegistry;
    this.#listenerRegistryOptions = listenerRegistryOptions;
  }

  get graphClient(): GraphClient {
    return this.#graphClient;
  }

  get phoneNumberClient(): PhoneNumberClient | undefined {
    return this.#phoneNumberClient;
  }

  get wabaClient(): WABAClient | undefined {
    return this.#wabaClient;
  }

  get router(): TypedRouter {
    return this.#router;
  }

  get listenerRegistry(): ListenerRegistry | undefined {
    return this.#listenerRegistry;
  }

  get activeListenerCount(): number {
    return this.#listenerRegistry?.activeCount ?? 0;
  }

  on<T extends TypedUpdate>(
    filter: TypedFilter<T>,
    handler: Handler<T>
  ): RegistrationHandle {
    return this.#router.on(filter, handler);
  }

  /**
   * WATS-30 ergonomic text conversation starter. The facade must be
   * constructed with a `phoneNumberId`; recipient `to` is intentionally
   * not checked against contacts, so callers can start chats with any
   * valid phone-number-like recipient allowed by the Graph API.
   */
  async startChat(
    input: WhatsAppStartChatInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.startChat requires a phoneNumberId-bound facade."
      );
    }
    return this.#phoneNumberClient.sendText(input);
  }

  async sendImage(
    input: WhatsAppSendImageInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendImage requires a phoneNumberId-bound facade."
      );
    }
    return this.#phoneNumberClient.sendImage(input);
  }

  async sendVideo(
    input: WhatsAppSendVideoInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendVideo requires a phoneNumberId-bound facade."
      );
    }
    return this.#phoneNumberClient.sendVideo(input);
  }

  async sendAudio(
    input: WhatsAppSendAudioInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendAudio requires a phoneNumberId-bound facade."
      );
    }
    return this.#phoneNumberClient.sendAudio(input);
  }

  async sendDocument(
    input: WhatsAppSendDocumentInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendDocument requires a phoneNumberId-bound facade."
      );
    }
    return this.#phoneNumberClient.sendDocument(input);
  }

  async sendSticker(
    input: WhatsAppSendStickerInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendSticker requires a phoneNumberId-bound facade."
      );
    }
    return this.#phoneNumberClient.sendSticker(input);
  }

  async sendLocation(
    input: WhatsAppSendLocationInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendLocation requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendLocation(input);
  }

  async sendContacts(
    input: WhatsAppSendContactsInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendContacts requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendContacts(input);
  }

  async sendReaction(
    input: WhatsAppSendReactionInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendReaction requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendReaction(input);
  }

  async removeReaction(
    input: WhatsAppRemoveReactionInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.removeReaction requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.removeReaction(input);
  }

  async sendButtons(
    input: WhatsAppSendButtonsInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendButtons requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendButtons(input);
  }

  async sendList(
    input: WhatsAppSendListInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendList requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendList(input);
  }

  async sendCtaUrl(
    input: WhatsAppSendCtaUrlInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendCtaUrl requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendCtaUrl(input);
  }

  async sendProduct(
    input: WhatsAppSendProductInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendProduct requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendProduct(input);
  }

  async sendProducts(
    input: WhatsAppSendProductsInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendProducts requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendProducts(input);
  }

  async sendCatalog(
    input: WhatsAppSendCatalogInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendCatalog requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendCatalog(input);
  }

  async requestLocation(
    input: WhatsAppRequestLocationInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.requestLocation requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.requestLocation(input);
  }

  async markMessageAsRead(
    input: WhatsAppMarkMessageAsReadInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.markMessageAsRead requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.markMessageAsRead(input);
  }

  async indicateTyping(
    input: WhatsAppTypingIndicatorInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.indicateTyping requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.indicateTyping(input);
  }

  async sendTemplate(
    input: WhatsAppSendTemplateInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendTemplate requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.sendTemplate(input);
  }

  // F-11: facade-owned dispatch wrapper. Listeners evaluate BEFORE
  // the router's handler loop fires (plan DoD). Evaluation is wrapped
  // in try/catch so a throwing listener-filter cannot poison
  // `dispatch()` — the router's "dispatch always resolves" contract
  // extends to the facade level.
  async dispatch(update: TypedUpdate): Promise<DispatchReport> {
    if (this.#listenerRegistry !== undefined) {
      try {
        const result = this.#listenerRegistry.evaluate(update);
        if (result.matched && result.listenerId !== undefined) {
          const observer = this.#observer;
          if (observer?.onListenerMatch) {
            try {
              observer.onListenerMatch(
                // We don't yet have a router-derived dispatchId —
                // synthesize a facade-scoped one that correlates
                // with the subsequent router dispatch via the
                // observer's onBeforeDispatch hook.
                "facade-pre-dispatch",
                result.listenerId,
                update
              );
            } catch {
              /* observer-throw isolated per F-10 policy */
            }
          }
        }
      } catch {
        /* predicate throw isolated — see listener.ts + router.ts */
      }
    }
    return this.#router.dispatch(update);
  }

  // F-11 listener substrate — ergonomic facade method.
  listen<TKind extends TypedUpdate["kind"]>(
    options: WhatsAppListenOptions<TKind>
  ): ListenerHandle<Extract<TypedUpdate, { kind: TKind }>> {
    if (typeof options !== "object" || options === null) {
      throw new WhatsAppListenOptionsError(
        "invalid_listen_options",
        "WhatsApp.listen: options must be an object."
      );
    }
    if (!VALID_KINDS.includes(options.type)) {
      throw new WhatsAppListenOptionsError(
        "invalid_listen_type",
        `WhatsApp.listen: options.type must be one of ${VALID_KINDS.join(", ")}.`
      );
    }
    if (options.from !== undefined) {
      if (typeof options.from !== "string" || options.from.length === 0) {
        throw new WhatsAppListenOptionsError(
          "invalid_listen_from",
          "WhatsApp.listen: options.from must be a non-empty string if provided."
        );
      }
    }
    if (options.filter !== undefined) {
      // Filter shape is validated inside ListenerRegistry.register;
      // we surface a facade-coded error ONLY for the obvious non-
      // object case.
      if (typeof options.filter !== "object" || options.filter === null) {
        throw new WhatsAppListenOptionsError(
          "invalid_listen_filter",
          "WhatsApp.listen: options.filter must be a TypedFilter if provided."
        );
      }
    }

    // Lazy-init the registry.
    if (this.#listenerRegistry === undefined) {
      this.#listenerRegistry = createListenerRegistry(
        this.#listenerRegistryOptions
      );
    }

    const listenerOptions: ListenerOptions = {};
    if (options.timeoutMs !== undefined) {
      (listenerOptions as { timeoutMs?: number }).timeoutMs = options.timeoutMs;
    }
    if (options.signal !== undefined) {
      (listenerOptions as { signal?: AbortSignal }).signal = options.signal;
    }
    if (options.description !== undefined) {
      (listenerOptions as { description?: string }).description =
        options.description;
    }

    const compound = buildListenFilter(options);
    return this.#listenerRegistry.register(compound, listenerOptions);
  }
}
