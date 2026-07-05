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
  GroupClient,
  PhoneNumberClient,
  WABAClient,
  createFetchTransport,
  type CreateGroupBody,
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
  type GraphMessagesSendMarketingTemplateInput,
  type GraphMessagesMarketingTemplateResponse,
  type GraphMessagesTextPayload,
  type GraphMessagesSendTextInput,
  type GraphMessagesSendVideoInput,
  type GraphMessagesTypingIndicatorInput,
  type GroupMutationResponse,
  type Transport
} from "@wats/graph";
import {
  and,
  createTypedFilter,
  message as messageFilter,
  status as statusFilter,
  account as accountFilter,
  unknown as unknownFilter,
  call as callFilter,
  group as groupFilter,
  chatOpened as chatOpenedFilter,
  system as systemFilter,
  userPreferences as userPreferencesFilter
} from "./filtersTyped/index.js";
import type { TypedFilter } from "./filtersTyped/typedFilter.js";
import {
  normalizeWebhookEnvelope,
  type NormalizedWebhookResult,
  type TypedAccountUpdate,
  type TypedCallStatusUpdate,
  type TypedCallUpdate,
  type TypedGroupLifecycleUpdate,
  type TypedGroupParticipantsUpdate,
  type TypedGroupSettingsUpdate,
  type TypedGroupStatusUpdate,
  type TypedChatOpenedUpdate,
  type TypedMessageUpdate,
  type TypedStatusUpdate,
  type TypedSystemUpdate,
  type TypedUnknownUpdate,
  type TypedUserPreferencesUpdate,
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

/**
 * WATS-172 factory options. `accessToken` is the only required field;
 * the factory constructs the `GraphClient` internally so the 80% case
 * is one call instead of a manual GraphClient + WhatsApp two-step.
 * All other fields are optional and pass through to the underlying
 * `WhatsAppFacadeConfig` / `GraphClientConfig`.
 *
 * `accessToken` flows into the Authorization header, so it is
 * validated at the factory boundary: non-string / empty / whitespace /
 * control-char / over-length values throw `WhatsAppFacadeConfigError`
 * with code `invalid_access_token` BEFORE any client is constructed.
 * The token value is never placed in an error message.
 */
export interface CreateWhatsAppOptions {
  readonly accessToken: string;
  readonly phoneNumberId?: string;
  readonly wabaId?: string;
  readonly apiVersion?: string;
  readonly baseUrl?: string;
  readonly transport?: Transport;
  readonly router?: TypedRouter;
  readonly observer?: RouterObserver;
  readonly routerOptions?: TypedRouterOptions;
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
  readonly groupId?: string;
  readonly filter?: TypedFilter<Extract<TypedUpdate, { kind: TKind }>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly description?: string;
}

export type WhatsAppStartChatInput = GraphMessagesSendTextInput;
export type WhatsAppCreateGroupInput = CreateGroupBody;
export interface WhatsAppSendGroupMessageInput {
  readonly groupId: string;
  readonly text: string;
  readonly previewUrl?: boolean;
  readonly replyToMessageId?: string;
}
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
export type WhatsAppSendMarketingTemplateInput = GraphMessagesSendMarketingTemplateInput;
export type WhatsAppMarketingTemplateResponse = GraphMessagesMarketingTemplateResponse;

export interface WhatsAppSentWaitOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Waiter methods attached to a sent-result. Extracted from
 * `WhatsAppWaitableSentResult` so the facade can attach the same
 * waiters to response supertypes (e.g.
 * `GraphMessagesMarketingTemplateResponse`) without losing their
 * type-specific fields.
 */
export interface WhatsAppSentResultWaiters {
  waitForReply(options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate>;
  waitUntilDelivered(options?: WhatsAppSentWaitOptions): Promise<TypedStatusUpdate>;
  waitUntilRead(options?: WhatsAppSentWaitOptions): Promise<TypedStatusUpdate>;
  waitUntilFailed(options?: WhatsAppSentWaitOptions): Promise<TypedStatusUpdate>;
  /**
   * WATS-158: resolves on an inbound interactive `button_reply` OR a
   * quick-reply `button` message from the same recipient whose
   * `context.messageId` matches the sent message id. Closes the pywa
   * parity gap where sent button prompts could not await their click
   * callback. Reuses the existing bounded listener substrate — no
   * polling, no persistence, no extra process-global state.
   */
  waitForClick(options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate>;
  /**
   * WATS-158: resolves on an inbound interactive `list_reply` from the
   * same recipient whose `context.messageId` matches the sent message
   * id. Parity with pywa `SentMessage.wait_for_selection()`.
   */
  waitForSelection(options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate>;
  /**
   * WATS-158: resolves on an inbound interactive `nfm_reply` (Flow
   * completion) from the same recipient whose `context.messageId`
   * matches the sent message id. Parity with pywa
   * `SentMessage.wait_for_flow_completion()`.
   */
  waitForFlowCompletion(options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate>;
}

export interface WhatsAppWaitableSentResult extends GraphMessagesSendResponse, WhatsAppSentResultWaiters {}

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
  | "invalid_listener_registry_options"
  | "invalid_access_token"
  | "invalid_api_version"
  | "invalid_base_url"
  | "invalid_transport";

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

// ---- WATS-172 createWhatsApp factory validation -------------------

const DEFAULT_WHATSAPP_API_VERSION = "v25.0";
const FACTORY_ACCESS_TOKEN_MAX_LEN = 4096;
const FACTORY_API_VERSION_REGEXP = /^v\d+(?:\.\d+)?$/;

/**
 * Validate an accessToken at the factory boundary. The token flows
 * into the Authorization header, so non-string / empty / whitespace /
 * control-char / over-length values throw before any client is built.
 * The token value is NEVER placed in the error message — callers that
 * log the error cannot leak it.
 */
function validateFactoryAccessToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new WhatsAppFacadeConfigError(
      "invalid_access_token",
      "createWhatsApp: accessToken must be a non-empty string."
    );
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new WhatsAppFacadeConfigError(
      "invalid_access_token",
      "createWhatsApp: accessToken must be a non-empty string."
    );
  }
  if (value.length > FACTORY_ACCESS_TOKEN_MAX_LEN) {
    throw new WhatsAppFacadeConfigError(
      "invalid_access_token",
      `createWhatsApp: accessToken exceeds ${FACTORY_ACCESS_TOKEN_MAX_LEN}-character bound.`
    );
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new WhatsAppFacadeConfigError(
        "invalid_access_token",
        "createWhatsApp: accessToken must not contain control characters (CR/LF/NUL/etc.)."
      );
    }
  }
  return value;
}

function validateFactoryApiVersion(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WhatsAppFacadeConfigError(
      "invalid_api_version",
      "createWhatsApp: apiVersion must be a non-empty string matching /^v\\d+(\\.\\d+)?$/."
    );
  }
  if (!FACTORY_API_VERSION_REGEXP.test(value)) {
    throw new WhatsAppFacadeConfigError(
      "invalid_api_version",
      `createWhatsApp: apiVersion ${JSON.stringify(value)} does not match /^v\\d+(\\.\\d+)?$/.`
    );
  }
  return value;
}

function validateFactoryBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WhatsAppFacadeConfigError(
      "invalid_base_url",
      "createWhatsApp: baseUrl must be a non-empty string URL."
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WhatsAppFacadeConfigError(
      "invalid_base_url",
      `createWhatsApp: baseUrl ${JSON.stringify(value)} is not a valid URL.`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WhatsAppFacadeConfigError(
      "invalid_base_url",
      `createWhatsApp: baseUrl protocol must be http: or https: (got ${JSON.stringify(url.protocol)}).`
    );
  }
  return value;
}

function validateFactoryTransport(value: unknown): Transport {
  if (!hasRequestMethod(value)) {
    throw new WhatsAppFacadeConfigError(
      "invalid_transport",
      "createWhatsApp: transport must expose a request() method if provided."
    );
  }
  // Structural check (object with a request function) passed; the
  // full Transport contract (Promise<TransportResponse> return) is
  // enforced by GraphClient at request time.
  return value as Transport;
}

/**
 * WATS-172 factory. Constructs a `GraphClient` internally (transport
 * defaults to `createFetchTransport()`, apiVersion defaults to
 * `"v25.0"`) and returns a fully-wired `WhatsApp` instance. The only
 * required option is `accessToken`; `phoneNumberId` / `wabaId` /
 * router / listener options pass through unchanged.
 *
 * Throws `WhatsAppFacadeConfigError` for malformed `accessToken` /
 * `apiVersion` / `baseUrl` / `transport` before any client is built.
 * The remaining config (phoneNumberId, wabaId, router, observer,
 * listenerRegistry, listenerRegistryOptions) is validated by the
 * `WhatsApp` constructor itself.
 */
export function createWhatsApp(options: CreateWhatsAppOptions): WhatsApp {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new WhatsAppFacadeConfigError(
      "invalid_config",
      "createWhatsApp: options must be an options object."
    );
  }

  const accessToken = validateFactoryAccessToken(options.accessToken);
  const apiVersion = options.apiVersion === undefined
    ? DEFAULT_WHATSAPP_API_VERSION
    : validateFactoryApiVersion(options.apiVersion);
  const baseUrl = options.baseUrl === undefined ? undefined : validateFactoryBaseUrl(options.baseUrl);
  const transport = options.transport === undefined
    ? createFetchTransport()
    : validateFactoryTransport(options.transport);

  const graphClient = new GraphClient({
    accessToken,
    apiVersion,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    transport
  });

  return new WhatsApp({
    graphClient,
    ...(options.phoneNumberId !== undefined ? { phoneNumberId: options.phoneNumberId } : {}),
    ...(options.wabaId !== undefined ? { wabaId: options.wabaId } : {}),
    ...(options.router !== undefined ? { router: options.router } : {}),
    ...(options.observer !== undefined ? { observer: options.observer } : {}),
    ...(options.routerOptions !== undefined ? { routerOptions: options.routerOptions } : {}),
    ...(options.listenerRegistry !== undefined ? { listenerRegistry: options.listenerRegistry } : {}),
    ...(options.listenerRegistryOptions !== undefined ? { listenerRegistryOptions: options.listenerRegistryOptions } : {})
  });
}

// ---- kind → base filter dispatch ----------------------------------

const groupLifecycleFilter = createTypedFilter<TypedGroupLifecycleUpdate>(
  (u): u is TypedGroupLifecycleUpdate => u.kind === "groupLifecycle",
  () => "groupLifecycle"
);
const groupParticipantsFilter = createTypedFilter<TypedGroupParticipantsUpdate>(
  (u): u is TypedGroupParticipantsUpdate => u.kind === "groupParticipants",
  () => "groupParticipants"
);
const groupSettingsFilter = createTypedFilter<TypedGroupSettingsUpdate>(
  (u): u is TypedGroupSettingsUpdate => u.kind === "groupSettings",
  () => "groupSettings"
);
const groupStatusFilter = createTypedFilter<TypedGroupStatusUpdate>(
  (u): u is TypedGroupStatusUpdate => u.kind === "groupStatus",
  () => "groupStatus"
);

const KIND_FILTERS: {
  readonly message: TypedFilter<TypedMessageUpdate>;
  readonly status: TypedFilter<TypedStatusUpdate>;
  readonly account: TypedFilter<TypedAccountUpdate>;
  readonly unknown: TypedFilter<TypedUnknownUpdate>;
  readonly callConnect: TypedFilter<TypedCallUpdate>;
  readonly callTerminate: TypedFilter<TypedCallUpdate>;
  readonly callStatus: TypedFilter<TypedCallStatusUpdate>;
  readonly groupLifecycle: TypedFilter<TypedGroupLifecycleUpdate>;
  readonly groupParticipants: TypedFilter<TypedGroupParticipantsUpdate>;
  readonly groupSettings: TypedFilter<TypedGroupSettingsUpdate>;
  readonly groupStatus: TypedFilter<TypedGroupStatusUpdate>;
  readonly userPreferences: TypedFilter<TypedUserPreferencesUpdate>;
  readonly system: TypedFilter<TypedSystemUpdate>;
  readonly chatOpened: TypedFilter<TypedChatOpenedUpdate>;
} = {
  message: messageFilter,
  status: statusFilter,
  account: accountFilter,
  unknown: unknownFilter,
  callConnect: callFilter.connect(),
  callTerminate: callFilter.terminate(),
  callStatus: callFilter.status(),
  groupLifecycle: groupLifecycleFilter,
  groupParticipants: groupParticipantsFilter,
  groupSettings: groupSettingsFilter,
  groupStatus: groupStatusFilter,
  userPreferences: userPreferencesFilter,
  system: systemFilter,
  chatOpened: chatOpenedFilter
};

const VALID_KINDS: readonly TypedUpdate["kind"][] = [
  "message",
  "status",
  "account",
  "unknown",
  "callConnect",
  "callTerminate",
  "callStatus",
  "groupLifecycle",
  "groupParticipants",
  "groupSettings",
  "groupStatus",
  "userPreferences",
  "system",
  "chatOpened"
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
  if (options.groupId !== undefined) {
    parts.push(groupFilter.fromGroup(options.groupId) as TypedFilter<Extract<TypedUpdate, { kind: TKind }>>);
  }
  if (options.filter !== undefined) {
    parts.push(options.filter);
  }
  if (parts.length === 1) return parts[0]!;
  return and(...parts) as TypedFilter<Extract<TypedUpdate, { kind: TKind }>>;
}

function firstSentMessageId(response: GraphMessagesSendResponse): string | undefined {
  const first = response.messages?.[0];
  return typeof first?.id === "string" && first.id.length > 0 ? first.id : undefined;
}

function firstRecipientId(response: GraphMessagesSendResponse): string | undefined {
  const first = response.contacts?.[0];
  return typeof first?.wa_id === "string" && first.wa_id.length > 0 ? first.wa_id : undefined;
}

function listenerOptionsFromSentWaitOptions(options: WhatsAppSentWaitOptions | undefined): ListenerOptions {
  const out: ListenerOptions = {};
  if (options?.timeoutMs !== undefined) (out as { timeoutMs?: number }).timeoutMs = options.timeoutMs;
  if (options?.signal !== undefined) (out as { signal?: AbortSignal }).signal = options.signal;
  return out;
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
   * WATS-172 ergonomic handler sugar: registers a handler that fires
   * on any inbound message update. Equivalent to
   * `wa.on(filtersTyped.message, handler)` — the broadest message kind
   * filter. Returns the same `RegistrationHandle` as `on`, so
   * `.unregister()` works identically.
   */
  onMessage(handler: Handler<TypedMessageUpdate>): RegistrationHandle {
    return this.#router.on(messageFilter, handler);
  }

  /**
   * WATS-172 ergonomic handler sugar: registers a handler that fires
   * on any inbound status update. Equivalent to
   * `wa.on(filtersTyped.status, handler)` — the broadest status kind
   * filter. Returns the same `RegistrationHandle` as `on`.
   */
  onStatus(handler: Handler<TypedStatusUpdate>): RegistrationHandle {
    return this.#router.on(statusFilter, handler);
  }

  #toWaitableSentResult<T extends GraphMessagesSendResponse>(
    response: T,
    sentRecipientId?: string
  ): T & WhatsAppSentResultWaiters {
    const sentMessageId = firstSentMessageId(response);
    const recipientId = firstRecipientId(response) ?? sentRecipientId;
    const matchesSentMessage = (u: TypedMessageUpdate): boolean => {
      if (sentMessageId === undefined) return false;
      const contextValue = (u.message as unknown as { context?: { messageId?: unknown } }).context;
      const contextMessageId = contextValue?.messageId;
      if (contextMessageId !== sentMessageId) return false;
      if (recipientId !== undefined && u.message.from !== recipientId) return false;
      return true;
    };
    const waitForMessage = (
      label: string,
      predicate: (u: TypedMessageUpdate) => boolean,
      options?: WhatsAppSentWaitOptions
    ): Promise<TypedMessageUpdate> => {
      const filter = createTypedFilter<TypedMessageUpdate>(
        (u): u is TypedMessageUpdate => u.kind === "message" && matchesSentMessage(u) && predicate(u),
        () => `sent.${label}(${sentMessageId ?? "missing"})`
      );
      return this.#registerSentWaiter("message", filter, options).promise;
    };
    const waitForReply = (options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate> =>
      waitForMessage("waitForReply", () => true, options);
    const waitForClick = (options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate> =>
      waitForMessage(
        "waitForClick",
        (u) => {
          const message = u.message;
          if (message.type === "button") return true;
          return message.type === "interactive" && message.interactive.type === "button_reply";
        },
        options
      );
    const waitForSelection = (options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate> =>
      waitForMessage(
        "waitForSelection",
        (u) => u.message.type === "interactive" && u.message.interactive.type === "list_reply",
        options
      );
    const waitForFlowCompletion = (options?: WhatsAppSentWaitOptions): Promise<TypedMessageUpdate> =>
      waitForMessage(
        "waitForFlowCompletion",
        (u) => u.message.type === "interactive" && u.message.interactive.type === "nfm_reply",
        options
      );
    const waitForStatus = (
      expected: "delivered" | "read" | "failed",
      options?: WhatsAppSentWaitOptions
    ): Promise<TypedStatusUpdate> => {
      const filter = createTypedFilter<TypedStatusUpdate>(
        (u): u is TypedStatusUpdate => {
          if (u.kind !== "status") return false;
          if (sentMessageId === undefined) return false;
          if (u.status.id !== sentMessageId) return false;
          if (u.status.status !== expected) return false;
          const statusRecipientId = (u.status as { recipientId?: unknown; recipient_id?: unknown }).recipientId ??
            (u.status as { recipientId?: unknown; recipient_id?: unknown }).recipient_id;
          if (recipientId !== undefined && statusRecipientId !== recipientId) return false;
          return true;
        },
        () => `sent.waitUntil${expected[0]?.toUpperCase() ?? ""}${expected.slice(1)}(${sentMessageId ?? "missing"})`
      );
      return this.#registerSentWaiter("status", filter, options).promise;
    };
    return Object.assign({}, response, {
      waitForReply,
      waitForClick,
      waitForSelection,
      waitForFlowCompletion,
      waitUntilDelivered: (options?: WhatsAppSentWaitOptions): Promise<TypedStatusUpdate> => waitForStatus("delivered", options),
      waitUntilRead: (options?: WhatsAppSentWaitOptions): Promise<TypedStatusUpdate> => waitForStatus("read", options),
      waitUntilFailed: (options?: WhatsAppSentWaitOptions): Promise<TypedStatusUpdate> => waitForStatus("failed", options)
    });
  }

  #registerSentWaiter<TKind extends "message" | "status">(
    type: TKind,
    filter: TypedFilter<Extract<TypedUpdate, { kind: TKind }>>,
    options: WhatsAppSentWaitOptions | undefined
  ): ListenerHandle<Extract<TypedUpdate, { kind: TKind }>> {
    if (this.#listenerRegistry === undefined) {
      this.#listenerRegistry = createListenerRegistry(
        this.#listenerRegistryOptions
      );
    }
    return this.#listenerRegistry.register(filter, listenerOptionsFromSentWaitOptions(options));
  }

  /**
   * WATS-30 ergonomic text conversation starter. The facade must be
   * constructed with a `phoneNumberId`; recipient `to` is intentionally
   * not checked against contacts, so callers can start chats with any
   * valid phone-number-like recipient allowed by the Graph API.
   *
   * WATS-172: `sendText` is the documented primary name for plain
   * text sends. `startChat` remains public as a back-compat alias and
   * delegates to the same code path; both return a waitable
   * sent-result.
   */
  async startChat(
    input: WhatsAppStartChatInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.startChat requires a phoneNumberId-bound facade."
      );
    }
    const response = await this.#phoneNumberClient.sendText(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  /**
   * WATS-172 primary text-send name. Behaves identically to
   * `startChat` — same code path, same waitable sent-result. Prefer
   * `sendText` in new code; `startChat` is retained as an alias.
   */
  async sendText(
    input: WhatsAppStartChatInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendText requires a phoneNumberId-bound facade."
      );
    }
    const response = await this.#phoneNumberClient.sendText(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  group(groupId: string): GroupClient {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.group requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.group(groupId);
  }

  async createGroup(
    input: WhatsAppCreateGroupInput
  ): Promise<GroupMutationResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.createGroup requires a phoneNumberId-bound facade.");
    }
    return this.#phoneNumberClient.createGroup(input);
  }

  async sendGroupMessage(
    input: WhatsAppSendGroupMessageInput
  ): Promise<GraphMessagesSendResponse> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendGroupMessage requires a phoneNumberId-bound facade.");
    }
    if (typeof input !== "object" || input === null) {
      throw new GraphRequestValidationError("Invalid WhatsApp.sendGroupMessage input: expected an options object.");
    }
    const record = input as unknown as Record<string, unknown>;
    if (typeof record.groupId !== "string" || record.groupId.trim().length === 0) {
      throw new GraphRequestValidationError("Invalid WhatsApp.sendGroupMessage input: groupId must be a non-empty string.");
    }
    // Reuse the scoped GroupClient constructor path sanitizer so the group id
    // follows the same Graph path-segment rules as all other Groups helpers.
    this.#phoneNumberClient.group(record.groupId);
    if (typeof record.text !== "string" || record.text.length === 0) {
      throw new GraphRequestValidationError("Invalid WhatsApp.sendGroupMessage input: text must be a non-empty string.");
    }
    if (record.previewUrl !== undefined && typeof record.previewUrl !== "boolean") {
      throw new GraphRequestValidationError("Invalid WhatsApp.sendGroupMessage input: previewUrl must be a boolean when provided.");
    }
    if (record.replyToMessageId !== undefined && (typeof record.replyToMessageId !== "string" || record.replyToMessageId.length === 0)) {
      throw new GraphRequestValidationError("Invalid WhatsApp.sendGroupMessage input: replyToMessageId must be a non-empty string when provided.");
    }
    // WATS-176: build the send body as a typed `GraphMessagesTextPayload`
    // (a member of `GraphMessagesSendBody`) instead of an untyped
    // `Record<string, unknown>` cast through `as never`. The `group`
    // recipient_type is a valid `GraphMessagesRecipientType`, and the
    // text-payload shape already covers `recipient_type`, `to`, `text`
    // (with optional `preview_url`), and optional `context` — so no
    // type widening or escape is needed. Behavior is unchanged: the
    // endpoint-registry `sendMessage` callable still re-validates the
    // group recipient + body shape at the Graph boundary.
    const text: GraphMessagesTextPayload["text"] = { body: record.text };
    if (record.previewUrl !== undefined) {
      text.preview_url = record.previewUrl;
    }
    const body: GraphMessagesTextPayload = {
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: record.groupId,
      type: "text",
      text
    };
    if (record.replyToMessageId !== undefined) {
      body.context = { message_id: record.replyToMessageId };
    }
    return this.#phoneNumberClient.sendMessage(body);
  }

  async sendImage(
    input: WhatsAppSendImageInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendImage requires a phoneNumberId-bound facade."
      );
    }
    const response = await this.#phoneNumberClient.sendImage(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendVideo(
    input: WhatsAppSendVideoInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendVideo requires a phoneNumberId-bound facade."
      );
    }
    const response = await this.#phoneNumberClient.sendVideo(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendAudio(
    input: WhatsAppSendAudioInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendAudio requires a phoneNumberId-bound facade."
      );
    }
    const response = await this.#phoneNumberClient.sendAudio(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendDocument(
    input: WhatsAppSendDocumentInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendDocument requires a phoneNumberId-bound facade."
      );
    }
    const response = await this.#phoneNumberClient.sendDocument(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendSticker(
    input: WhatsAppSendStickerInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError(
        "WhatsApp.sendSticker requires a phoneNumberId-bound facade."
      );
    }
    const response = await this.#phoneNumberClient.sendSticker(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendLocation(
    input: WhatsAppSendLocationInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendLocation requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendLocation(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendContacts(
    input: WhatsAppSendContactsInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendContacts requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendContacts(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendReaction(
    input: WhatsAppSendReactionInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendReaction requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendReaction(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async removeReaction(
    input: WhatsAppRemoveReactionInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.removeReaction requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.removeReaction(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendButtons(
    input: WhatsAppSendButtonsInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendButtons requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendButtons(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendList(
    input: WhatsAppSendListInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendList requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendList(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendCtaUrl(
    input: WhatsAppSendCtaUrlInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendCtaUrl requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendCtaUrl(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendProduct(
    input: WhatsAppSendProductInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendProduct requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendProduct(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendProducts(
    input: WhatsAppSendProductsInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendProducts requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendProducts(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendCatalog(
    input: WhatsAppSendCatalogInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendCatalog requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendCatalog(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async requestLocation(
    input: WhatsAppRequestLocationInput
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.requestLocation requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.requestLocation(input);
    return this.#toWaitableSentResult(response, input.to);
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
  ): Promise<WhatsAppWaitableSentResult> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendTemplate requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendTemplate(input);
    return this.#toWaitableSentResult(response, input.to);
  }

  async sendMarketingTemplate(
    input: WhatsAppSendMarketingTemplateInput
  ): Promise<GraphMessagesMarketingTemplateResponse & WhatsAppSentResultWaiters> {
    if (this.#phoneNumberClient === undefined) {
      throw new GraphRequestValidationError("WhatsApp.sendMarketingTemplate requires a phoneNumberId-bound facade.");
    }
    const response = await this.#phoneNumberClient.sendMarketingTemplate(input);
    return this.#toWaitableSentResult(response, input.to);
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
    if (options.groupId !== undefined) {
      if (typeof options.groupId !== "string" || options.groupId.length === 0) {
        throw new WhatsAppListenOptionsError(
          "invalid_listen_from",
          "WhatsApp.listen: options.groupId must be a non-empty string if provided."
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
