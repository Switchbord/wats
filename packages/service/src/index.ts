import type { WatsProfileConfig } from "@wats/config";
import { WhatsApp, filtersTyped } from "@wats/core";
import {
  buildSendAudioPayload,
  buildSendDocumentPayload,
  buildRemoveReactionPayload,
  buildSendImagePayload,
  buildSendButtonsPayload,
  buildSendCallPermissionRequestPayload,
  buildSendContactsPayload,
  buildSendCtaUrlPayload,
  buildSendListPayload,
  buildSendProductPayload,
  buildSendProductsPayload,
  buildSendCatalogPayload,
  buildRequestLocationPayload,
  buildSendLocationPayload,
  buildSendReactionPayload,
  buildSendStickerPayload,
  buildSendVideoPayload,
  GraphApiError,
  GraphClient,
  GraphRequestValidationError,
  type GraphMessagesSendBody,
  type Transport
} from "@wats/graph";
import type { CryptoProvider } from "@wats/crypto";
import type { PersistenceStore } from "@wats/persistence";
import {
  createFetchWebhookHandler,
  createWebhookAdapter,
  type WebhookFacadeLike
} from "@wats/http";

export interface WatsServiceSecrets {
  readonly accessToken: string;
  readonly webhookVerifyToken: string;
  readonly webhookAppSecret: string;
  readonly serviceBearerToken: string;
}

export interface WatsServiceConfig {
  readonly profile: WatsProfileConfig;
  readonly secrets: WatsServiceSecrets;
  readonly transport?: Transport;
  readonly cryptoProvider?: CryptoProvider;
  readonly whatsapp?: WebhookFacadeLike;
  readonly persistence?: PersistenceStore;
}

export type WatsServiceErrorCode =
  | "invalid_config"
  | "invalid_profile"
  | "invalid_secrets"
  | "invalid_secret"
  | "invalid_path"
  | "invalid_transport"
  | "invalid_crypto_provider"
  | "invalid_whatsapp"
  | "invalid_persistence";

export class WatsServiceError extends Error {
  readonly code: WatsServiceErrorCode;

  constructor(code: WatsServiceErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WatsServiceError";
    this.code = code;
  }
}

export interface WatsServiceApp {
  fetch(request: Request): Promise<Response>;
}

export interface WatsServiceOpenApiOptions {
  readonly serverUrl?: string;
  readonly title?: string;
  readonly version?: string;
}

export interface WatsServiceOpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: ReadonlyArray<{ readonly url: string }>;
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: {
    readonly securitySchemes: {
      readonly serviceBearerAuth: {
        readonly type: "http";
        readonly scheme: "bearer";
        readonly bearerFormat: "opaque";
      };
    };
    readonly schemas: Record<string, Record<string, unknown>>;
  };
}

interface RuntimeConfig {
  readonly profile: WatsProfileConfig;
  readonly secrets: WatsServiceSecrets;
  readonly graphClient: GraphClient;
  readonly whatsapp: WebhookFacadeLike;
  readonly cryptoProvider?: CryptoProvider;
  readonly persistence?: PersistenceStore;
  readonly webhookHandler: (request: Request) => Promise<Response>;
  readonly webhookPath: string;
  readonly apiPrefix: string;
  readonly textPath: string;
  readonly messagesPath: string;
}

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SERVICE_NAME = "wats";
const OPENAPI_PATH = "/openapi.json";
const DEFAULT_OPENAPI_TITLE = "WATS Service API";
const DEFAULT_OPENAPI_VERSION = "0.3.17";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function containsUnsafePathSegment(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    hasControlChars(path) ||
    path.split("/").some((segment) => segment === ".." || segment === ".") ||
    lower.includes("%2e%2e") ||
    lower.includes("%252e%252e") ||
    lower.includes("%2f") ||
    lower.includes("%5c")
  );
}

function validateSafeAbsolutePath(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new WatsServiceError("invalid_path", `${field} must be a non-empty absolute path.`);
  }
  if (!value.startsWith("/") || value === "/" || containsUnsafePathSegment(value)) {
    throw new WatsServiceError("invalid_path", `${field} must be an absolute safe path with at least one segment.`);
  }
  return value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value;
}

function validateSecret(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0 || hasControlChars(value)) {
    throw new WatsServiceError("invalid_secret", `${field} must be a non-empty string without control characters.`);
  }
  return value;
}

function validateSecrets(value: unknown): WatsServiceSecrets {
  if (!isRecord(value)) {
    throw new WatsServiceError("invalid_secrets", "secrets must be an object.");
  }
  return {
    accessToken: validateSecret(value.accessToken, "accessToken"),
    webhookVerifyToken: validateSecret(value.webhookVerifyToken, "webhookVerifyToken"),
    webhookAppSecret: validateSecret(value.webhookAppSecret, "webhookAppSecret"),
    serviceBearerToken: validateSecret(value.serviceBearerToken, "serviceBearerToken")
  };
}

function validateProfile(value: unknown): WatsProfileConfig {
  if (!isRecord(value)) {
    throw new WatsServiceError("invalid_profile", "profile must be an already-validated WatsProfileConfig object.");
  }
  const profile = value as Partial<WatsProfileConfig>;
  if (!isRecord(profile.graph) || !isRecord(profile.whatsapp) || !isRecord(profile.webhook) || !isRecord(profile.service)) {
    throw new WatsServiceError("invalid_profile", "profile is missing graph, whatsapp, webhook, or service config.");
  }
  return profile as WatsProfileConfig;
}

function validateTransport(value: unknown): Transport | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.request !== "function") {
    throw new WatsServiceError("invalid_transport", "transport must expose request().");
  }
  return value as unknown as Transport;
}

function validateCryptoProvider(value: unknown): CryptoProvider | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.hmacSha256 !== "function" || typeof value.timingSafeEqual !== "function") {
    throw new WatsServiceError("invalid_crypto_provider", "cryptoProvider must be a CryptoProvider.");
  }
  return value as unknown as CryptoProvider;
}

function validateWhatsapp(value: unknown): WebhookFacadeLike | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.dispatch !== "function") {
    throw new WatsServiceError("invalid_whatsapp", "whatsapp must expose dispatch().");
  }
  return value as unknown as WebhookFacadeLike;
}

function validatePersistence(value: unknown): PersistenceStore | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.migrate !== "function" ||
    typeof value.health !== "function" ||
    typeof value.recordWebhookEvent !== "function" ||
    typeof value.getServiceRequest !== "function" ||
    typeof value.recordServiceRequest !== "function" ||
    typeof value.close !== "function"
  ) {
    throw new WatsServiceError("invalid_persistence", "persistence must be a PersistenceStore.");
  }
  return value as unknown as PersistenceStore;
}

function jsonResponse(status: number, payload: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, ...(headers ?? {}) }
  });
}

function errorResponse(status: number, code: string, message?: string, headers?: HeadersInit): Response {
  return jsonResponse(status, { error: { code, ...(message ? { message } : {}) } }, headers);
}

function graphFailureResponse(error: unknown): Response {
  const payload: Record<string, unknown> = {
    code: "graph_request_failed",
    message: "Graph request failed."
  };
  if (error instanceof GraphApiError) {
    if (error.code !== undefined) payload.metaCode = error.code;
    if (error.errorSubcode !== undefined) payload.metaSubcode = error.errorSubcode;
    if (error.type !== undefined) payload.metaType = error.type;
    if (error.fbtraceId !== undefined) payload.fbtraceId = error.fbtraceId;
  }
  return jsonResponse(502, { error: payload });
}

function methodNotAllowed(allow: string): Response {
  return errorResponse(405, "method_not_allowed", "Method not allowed.", { Allow: allow });
}

function unauthorized(): Response {
  return errorResponse(401, "unauthorized", "Missing or invalid bearer token.");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const max = Math.max(left.byteLength, right.byteLength);
  let diff = left.byteLength ^ right.byteLength;
  for (let i = 0; i < max; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function isAuthorized(request: Request, expected: string): boolean {
  const raw = request.headers.get("authorization");
  if (raw === null) return false;
  const prefix = "Bearer ";
  if (!raw.startsWith(prefix)) return false;
  const token = raw.slice(prefix.length);
  if (token.length === 0) return false;
  return timingSafeStringEqual(token, expected);
}

async function parseJsonRequest(request: Request): Promise<unknown | "malformed"> {
  try {
    return await request.json();
  } catch {
    return "malformed";
  }
}

async function readRequestText(request: Request): Promise<string | "malformed"> {
  try {
    return await request.text();
  } catch {
    return "malformed";
  }
}

function parseJsonText(source: string): unknown | "malformed" {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return "malformed";
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeIdempotencyKey(request: Request): string | null | "invalid" {
  const raw = request.headers.get("idempotency-key");
  if (raw === null) return null;
  if (raw.trim().length === 0 || raw.length > 256 || hasControlChars(raw)) return "invalid";
  return raw;
}

function responseToJsonText(payload: unknown): string | null {
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

function jsonTextResponse(status: number, payloadText: string): Response {
  return new Response(payloadText, { status, headers: { "content-type": JSON_CONTENT_TYPE } });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim().length > 0 && !hasControlChars(value);
}

function validateOpenApiOptions(value: unknown): WatsServiceOpenApiOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new WatsServiceError("invalid_config", "OpenAPI options must be an object.");
  }
  const options = value as Partial<WatsServiceOpenApiOptions>;
  if (options.title !== undefined && !isNonEmptyString(options.title)) {
    throw new WatsServiceError("invalid_config", "OpenAPI title must be a non-empty string.");
  }
  if (options.version !== undefined && !isNonEmptyString(options.version)) {
    throw new WatsServiceError("invalid_config", "OpenAPI version must be a non-empty string.");
  }
  if (options.serverUrl !== undefined) {
    validateOpenApiServerUrl(options.serverUrl);
  }
  return options as WatsServiceOpenApiOptions;
}

function validateOpenApiServerUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0 || hasControlChars(value)) {
    throw new WatsServiceError("invalid_path", "OpenAPI serverUrl must be a non-empty http(s) URL.");
  }
  if (value.includes("\\")) {
    throw new WatsServiceError("invalid_path", "OpenAPI serverUrl must not contain backslashes.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WatsServiceError("invalid_path", "OpenAPI serverUrl must be a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WatsServiceError("invalid_path", "OpenAPI serverUrl must use http or https.");
  }
  const path = url.pathname === "/" ? "" : validateSafeAbsolutePath(url.pathname, "serverUrl.pathname");
  return `${url.origin}${path}`;
}

function assertNoRouteCollisions(webhookPath: string, apiPrefix: string): void {
  const textPath = `${apiPrefix}/messages/text`;
  const messagesPath = `${apiPrefix}/messages`;
  const reservedStaticPaths = new Set(["/healthz", "/readyz", OPENAPI_PATH]);
  if (reservedStaticPaths.has(webhookPath) || webhookPath === textPath || webhookPath === messagesPath) {
    throw new WatsServiceError("invalid_path", "profile.webhook.path must not collide with service routes.");
  }
  if (reservedStaticPaths.has(apiPrefix) || apiPrefix === webhookPath) {
    throw new WatsServiceError("invalid_path", "profile.service.apiPrefix must not collide with service routes.");
  }
}

function defaultServerUrl(profile: WatsProfileConfig): string {
  const host = profile.service.host.trim();
  const port = profile.service.port;
  const hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return validateOpenApiServerUrl(`http://${hostname}:${port}`);
}

function schemaRef(name: string): Record<string, string> {
  return { "$ref": `#/components/schemas/${name}` };
}

function jsonContentSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return {
    content: {
      "application/json": { schema }
    }
  };
}

function errorResponseSpec(description: string): Record<string, unknown> {
  return {
    description,
    ...jsonContentSchema(schemaRef("ErrorEnvelope"))
  };
}

function okResponseSpec(description: string, schemaName: string): Record<string, unknown> {
  return {
    description,
    ...jsonContentSchema(schemaRef(schemaName))
  };
}

function messageOperation(summary: string, schemaName: string): Record<string, unknown> {
  return {
    tags: ["messages"],
    summary,
    security: [{ serviceBearerAuth: [] }],
    parameters: [{
      name: "Idempotency-Key",
      in: "header",
      required: false,
      schema: { type: "string", minLength: 1, maxLength: 256 },
      description: "Optional local service idempotency key when a PersistenceStore is injected. Same key and same body hash replays the stored response; same key with a different body returns 409."
    }],
    requestBody: {
      required: true,
      ...jsonContentSchema(schemaRef(schemaName))
    },
    responses: {
      "200": okResponseSpec("Graph response passthrough or idempotency replay.", "GraphResponsePassthrough"),
      "400": errorResponseSpec("Malformed JSON, unsupported body, or invalid Idempotency-Key."),
      "401": errorResponseSpec("Missing or invalid service bearer token."),
      "405": errorResponseSpec("Method not allowed."),
      "409": errorResponseSpec("Idempotency-Key conflicts with a different request body."),
      "502": errorResponseSpec("Graph request failed.")
    }
  };
}

function createOpenApiSchemas(): Record<string, Record<string, unknown>> {
  return {
    HealthResponse: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "service"],
      properties: {
        ok: { type: "boolean", const: true },
        service: { type: "string", const: SERVICE_NAME }
      }
    },
    ReadyResponse: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "service"],
      properties: {
        ok: { type: "boolean", const: true },
        service: { type: "string", const: SERVICE_NAME }
      }
    },
    ErrorEnvelope: {
      type: "object",
      additionalProperties: false,
      required: ["error"],
      properties: {
        error: {
          type: "object",
          additionalProperties: false,
          required: ["code"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            metaCode: { type: "integer", description: "Sanitized Meta Graph error code when available." },
            metaSubcode: { type: "integer", description: "Sanitized Meta Graph error subcode when available." },
            metaType: { type: "string", description: "Sanitized Meta Graph error type when available." },
            fbtraceId: { type: "string", description: "Meta trace id for support correlation when available." }
          }
        }
      }
    },
    TextMessageBody: {
      type: "object",
      additionalProperties: false,
      required: ["to", "text"],
      properties: {
        to: { type: "string", minLength: 1, description: "WhatsApp recipient phone number or wa_id." },
        text: { type: "string", minLength: 1 },
        previewUrl: { type: "boolean", description: "Maps to Graph text.preview_url when present." }
      }
    },
    GenericTextMessageBody: {
      type: "object",
      additionalProperties: true,
      required: ["messaging_product", "to", "type", "text"],
      properties: {
        messaging_product: { type: "string", const: "whatsapp" },
        to: { type: "string", minLength: 1 },
        type: { type: "string", const: "text" },
        text: {
          type: "object",
          additionalProperties: true,
          required: ["body"],
          properties: {
            body: { type: "string", minLength: 1 },
            preview_url: { type: "boolean" }
          }
        }
      }
    },
    MediaMessageBody: {
      type: "object",
      additionalProperties: false,
      required: ["type", "to"],
      properties: {
        type: { type: "string", enum: ["image", "video", "audio", "document", "sticker"] },
        to: { type: "string", minLength: 1, description: "WhatsApp recipient phone number or wa_id." },
        mediaId: { type: "string", minLength: 1, description: "Uploaded Graph media ID. Mutually exclusive with link." },
        link: { type: "string", minLength: 1, description: "HTTPS media URL. Mutually exclusive with mediaId." },
        caption: { type: "string", minLength: 1, description: "Allowed for image, video, and document bodies." },
        filename: { type: "string", minLength: 1, description: "Allowed for document bodies only." },
        replyToMessageId: { type: "string", minLength: 1, description: "Optional message ID to send as a reply context." },
        voice: { type: "boolean", description: "Audio-only Graph v24+ voice-message designation." }
      },
      oneOf: [
        { required: ["mediaId"], not: { required: ["link"] } },
        { required: ["link"], not: { required: ["mediaId"] } }
      ]
    },
    BasicInteractiveMessageBody: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "to", "bodyText"],
          properties: {
            type: { type: "string", const: "callPermissionRequest" },
            to: { type: "string", minLength: 1 },
            bodyText: { type: "string", minLength: 1 },
            footerText: { type: "string", minLength: 1 },
            replyToMessageId: { type: "string", minLength: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "to", "bodyText", "buttons"],
          properties: {
            type: { type: "string", const: "interactiveButtons" },
            to: { type: "string", minLength: 1 },
            bodyText: { type: "string", minLength: 1 },
            buttons: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
            headerText: { type: "string", minLength: 1 },
            footerText: { type: "string", minLength: 1 },
            replyToMessageId: { type: "string", minLength: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "to", "bodyText", "buttonText", "sections"],
          properties: {
            type: { type: "string", const: "interactiveList" },
            to: { type: "string", minLength: 1 },
            bodyText: { type: "string", minLength: 1 },
            buttonText: { type: "string", minLength: 1 },
            sections: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
            headerText: { type: "string", minLength: 1 },
            footerText: { type: "string", minLength: 1 },
            replyToMessageId: { type: "string", minLength: 1 }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "to", "bodyText", "displayText", "url"],
          properties: {
            type: { type: "string", const: "interactiveCtaUrl" },
            to: { type: "string", minLength: 1 },
            bodyText: { type: "string", minLength: 1 },
            displayText: { type: "string", minLength: 1 },
            url: { type: "string", minLength: 1 },
            footerText: { type: "string", minLength: 1 },
            replyToMessageId: { type: "string", minLength: 1 }
          }
        }
      ]
    },
    CommerceInteractiveMessageBody: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["type", "to", "catalogId", "productRetailerId"], properties: { type: { type: "string", const: "interactiveProduct" }, to: { type: "string", minLength: 1 }, catalogId: { type: "string", minLength: 1 }, productRetailerId: { type: "string", minLength: 1 }, bodyText: { type: "string", minLength: 1 }, footerText: { type: "string", minLength: 1 }, replyToMessageId: { type: "string", minLength: 1 } } },
        { type: "object", additionalProperties: false, required: ["type", "to", "catalogId", "headerText", "bodyText", "sections"], properties: { type: { type: "string", const: "interactiveProducts" }, to: { type: "string", minLength: 1 }, catalogId: { type: "string", minLength: 1 }, headerText: { type: "string", minLength: 1 }, bodyText: { type: "string", minLength: 1 }, sections: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } }, footerText: { type: "string", minLength: 1 }, replyToMessageId: { type: "string", minLength: 1 } } },
        { type: "object", additionalProperties: false, required: ["type", "to", "bodyText"], properties: { type: { type: "string", const: "interactiveCatalog" }, to: { type: "string", minLength: 1 }, bodyText: { type: "string", minLength: 1 }, thumbnailProductRetailerId: { type: "string", minLength: 1 }, headerText: { type: "string", minLength: 1 }, footerText: { type: "string", minLength: 1 }, replyToMessageId: { type: "string", minLength: 1 } } },
        { type: "object", additionalProperties: false, required: ["type", "to", "bodyText"], properties: { type: { type: "string", const: "interactiveLocationRequest" }, to: { type: "string", minLength: 1 }, bodyText: { type: "string", minLength: 1 }, replyToMessageId: { type: "string", minLength: 1 } } }
      ]
    },
    ContactsMessageBody: {
      type: "object",
      additionalProperties: false,
      required: ["type", "to", "contacts"],
      properties: {
        type: { type: "string", const: "contacts" },
        to: { type: "string", minLength: 1, description: "WhatsApp recipient phone number or wa_id." },
        contacts: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
        replyToMessageId: { type: "string", minLength: 1, description: "Optional message ID to send as a reply context." }
      }
    },
    LocationMessageBody: {
      type: "object",
      additionalProperties: false,
      required: ["type", "to", "latitude", "longitude"],
      properties: {
        type: { type: "string", const: "location" },
        to: { type: "string", minLength: 1, description: "WhatsApp recipient phone number or wa_id." },
        latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
        name: { type: "string", minLength: 1 },
        address: { type: "string", minLength: 1 },
        replyToMessageId: { type: "string", minLength: 1, description: "Optional message ID to send as a reply context." }
      }
    },
    ReactionMessageBody: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "to", "messageId", "emoji"],
          properties: {
            type: { type: "string", const: "reaction" },
            to: { type: "string", minLength: 1, description: "WhatsApp recipient phone number or wa_id." },
            messageId: { type: "string", minLength: 1, description: "Message ID to react to." },
            emoji: { type: "string", minLength: 1, description: "Emoji reaction to apply." }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["type", "to", "messageId"],
          properties: {
            type: { type: "string", const: "removeReaction" },
            to: { type: "string", minLength: 1, description: "WhatsApp recipient phone number or wa_id." },
            messageId: { type: "string", minLength: 1, description: "Message ID whose reaction should be removed." }
          }
        }
      ]
    },
    SupportedMessageBody: {
      oneOf: [
        schemaRef("GenericTextMessageBody"),
        schemaRef("MediaMessageBody"),
        schemaRef("LocationMessageBody"),
        schemaRef("ContactsMessageBody"),
        schemaRef("ReactionMessageBody"),
        schemaRef("BasicInteractiveMessageBody"),
        schemaRef("CommerceInteractiveMessageBody")
      ],
      description: "Supported POST /messages bodies: generic Graph-native text, WATS media composer, location, reaction, remove-reaction, contacts, basic interactive, or commerce interactive bodies."
    },
    GraphResponsePassthrough: {
      type: "object",
      additionalProperties: true,
      description: "Unmodified JSON object returned by the configured Graph transport."
    },
    WebhookVerificationResponse: {
      type: "string",
      description: "Meta webhook challenge string when verification succeeds."
    },
    WebhookDispatchResponse: {
      type: "object",
      additionalProperties: true,
      description: "Webhook adapter response envelope for accepted signed webhook payloads."
    }
  };
}

export function createWatsServiceOpenApiDocument(
  profileInput: WatsProfileConfig,
  optionsInput?: WatsServiceOpenApiOptions
): WatsServiceOpenApiDocument {
  const profile = validateProfile(profileInput);
  const options = validateOpenApiOptions(optionsInput);
  const webhookPath = validateSafeAbsolutePath(profile.webhook.path, "profile.webhook.path");
  const apiPrefix = validateSafeAbsolutePath(profile.service.apiPrefix, "profile.service.apiPrefix");
  assertNoRouteCollisions(webhookPath, apiPrefix);
  const textPath = `${apiPrefix}/messages/text`;
  const messagesPath = `${apiPrefix}/messages`;
  const serverUrl = options.serverUrl === undefined
    ? defaultServerUrl(profile)
    : validateOpenApiServerUrl(options.serverUrl);

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? DEFAULT_OPENAPI_TITLE,
      version: options.version ?? DEFAULT_OPENAPI_VERSION,
      description: "Runtime-neutral OpenAPI description for the standalone WATS service routes currently implemented."
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/healthz": {
        get: {
          tags: ["status"],
          summary: "Health check",
          responses: {
            "200": okResponseSpec("Service process is alive.", "HealthResponse"),
            "405": errorResponseSpec("Method not allowed.")
          }
        }
      },
      "/readyz": {
        get: {
          tags: ["status"],
          summary: "Readiness check",
          responses: {
            "200": okResponseSpec("Service dependencies were constructed.", "ReadyResponse"),
            "405": errorResponseSpec("Method not allowed.")
          }
        }
      },
      [webhookPath]: {
        get: {
          tags: ["webhook"],
          summary: "Verify Meta webhook challenge",
          parameters: [
            { name: "hub.mode", in: "query", required: true, schema: { type: "string" } },
            { name: "hub.verify_token", in: "query", required: true, schema: { type: "string" } },
            { name: "hub.challenge", in: "query", required: true, schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Verification challenge.", content: { "text/plain": { schema: schemaRef("WebhookVerificationResponse") } } },
            "400": errorResponseSpec("Malformed verification query."),
            "401": errorResponseSpec("Verification token mismatch."),
            "405": errorResponseSpec("Method not allowed.")
          }
        },
        post: {
          tags: ["webhook"],
          summary: "Receive signed Meta webhook payload",
          parameters: [
            { name: "x-hub-signature-256", in: "header", required: true, schema: { type: "string" } }
          ],
          requestBody: {
            required: true,
            ...jsonContentSchema({ type: "object", additionalProperties: true })
          },
          responses: {
            "200": okResponseSpec("Webhook accepted and dispatched.", "WebhookDispatchResponse"),
            "400": errorResponseSpec("Malformed webhook body."),
            "401": errorResponseSpec("Missing or invalid signature."),
            "405": errorResponseSpec("Method not allowed."),
            "413": errorResponseSpec("Webhook body exceeds configured maxBodyBytes.")
          }
        }
      },
      [textPath]: {
        post: messageOperation("Send a text message", "TextMessageBody")
      },
      [messagesPath]: {
        post: messageOperation("Send a supported text, media, location, reaction, contacts, or interactive message body", "SupportedMessageBody")
      },
      [OPENAPI_PATH]: {
        get: {
          tags: ["openapi"],
          summary: "Fetch this OpenAPI document",
          responses: {
            "200": {
              description: "OpenAPI 3.1 document for this WATS service profile.",
              ...jsonContentSchema({ type: "object", additionalProperties: true })
            },
            "405": errorResponseSpec("Method not allowed.")
          }
        }
      }
    },
    components: {
      securitySchemes: {
        serviceBearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque"
        }
      },
      schemas: createOpenApiSchemas()
    }
  };
}

function validateTextBody(body: unknown): { to: string; text: string; previewUrl?: boolean } | null {
  if (!isRecord(body)) return null;
  if (!isNonEmptyString(body.to) || !isNonEmptyString(body.text)) return null;
  if (body.previewUrl !== undefined && typeof body.previewUrl !== "boolean") return null;
  const out: { to: string; text: string; previewUrl?: boolean } = {
    to: body.to,
    text: body.text
  };
  if (body.previewUrl !== undefined) out.previewUrl = body.previewUrl;
  return out;
}

type ServiceMediaMessageKind = "image" | "video" | "audio" | "document" | "sticker";
type ServiceLocationReactionMessageKind = "location" | "reaction" | "removeReaction";
type ServiceContactsMessageKind = "contacts";
type ServiceBasicInteractiveMessageKind = "interactiveButtons" | "interactiveList" | "interactiveCtaUrl" | "callPermissionRequest";
type ServiceCommerceInteractiveMessageKind = "interactiveProduct" | "interactiveProducts" | "interactiveCatalog" | "interactiveLocationRequest";

interface ServiceMediaMessageInput {
  readonly type: ServiceMediaMessageKind;
  readonly to: string;
  readonly mediaId?: string;
  readonly link?: string;
  readonly caption?: string;
  readonly filename?: string;
  readonly replyToMessageId?: string;
  readonly voice?: boolean;
}

interface ServiceLocationReactionMessageInput {
  readonly type: ServiceLocationReactionMessageKind;
  readonly to: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly name?: string;
  readonly address?: string;
  readonly messageId?: string;
  readonly emoji?: string;
  readonly replyToMessageId?: string;
}

interface ServiceContactsMessageInput {
  readonly type: ServiceContactsMessageKind;
  readonly to: string;
  readonly contacts: readonly Record<string, unknown>[];
  readonly replyToMessageId?: string;
}

type ServiceBasicInteractiveMessageInput = Record<string, unknown> & {
  readonly type: ServiceBasicInteractiveMessageKind;
  readonly to: string;
};

type ServiceCommerceInteractiveMessageInput = Record<string, unknown> & {
  readonly type: ServiceCommerceInteractiveMessageKind;
  readonly to: string;
};

function validateGenericTextMessageBody(body: unknown): GraphMessagesSendBody | null {
  if (!isRecord(body)) return null;
  if (body.messaging_product !== "whatsapp") return null;
  if (!isNonEmptyString(body.to)) return null;
  if (body.type !== "text") return null;
  if (!isRecord(body.text) || !isNonEmptyString(body.text.body)) return null;
  if (body.text.preview_url !== undefined && typeof body.text.preview_url !== "boolean") return null;
  return body as unknown as GraphMessagesSendBody;
}

function validateServiceMediaMessageBody(body: unknown): ServiceMediaMessageInput | null {
  if (!isRecord(body)) return null;
  if (body.type !== "image" && body.type !== "video" && body.type !== "audio" && body.type !== "document" && body.type !== "sticker") return null;
  if (!isNonEmptyString(body.to)) return null;
  if (body.mediaId !== undefined && !isNonEmptyString(body.mediaId)) return null;
  if (body.link !== undefined && !isNonEmptyString(body.link)) return null;
  if ((body.mediaId === undefined) === (body.link === undefined)) return null;
  if (body.caption !== undefined && !isNonEmptyString(body.caption)) return null;
  if (body.filename !== undefined && !isNonEmptyString(body.filename)) return null;
  if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
  if (body.voice !== undefined && typeof body.voice !== "boolean") return null;
  if (body.type !== "audio" && body.voice !== undefined) return null;
  if ((body.type === "audio" || body.type === "sticker") && body.caption !== undefined) return null;
  if (body.type !== "document" && body.filename !== undefined) return null;
  const out: {
    type: ServiceMediaMessageKind;
    to: string;
    mediaId?: string;
    link?: string;
    caption?: string;
    filename?: string;
    replyToMessageId?: string;
    voice?: boolean;
  } = { type: body.type, to: body.to };
  if (body.mediaId !== undefined) out.mediaId = body.mediaId;
  if (body.link !== undefined) out.link = body.link;
  if (body.caption !== undefined) out.caption = body.caption;
  if (body.filename !== undefined) out.filename = body.filename;
  if (body.replyToMessageId !== undefined) out.replyToMessageId = body.replyToMessageId;
  if (body.voice !== undefined) out.voice = body.voice;
  return out;
}


function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key));
}

function validateServiceLocationReactionMessageBody(body: unknown): ServiceLocationReactionMessageInput | null {
  if (!isRecord(body)) return null;
  if (body.type !== "location" && body.type !== "reaction" && body.type !== "removeReaction") return null;
  if (!isNonEmptyString(body.to)) return null;

  if (body.type === "location") {
    if (!hasOnlyKeys(body, ["type", "to", "latitude", "longitude", "name", "address", "replyToMessageId"])) return null;
    if (typeof body.latitude !== "number" || !Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90) return null;
    if (typeof body.longitude !== "number" || !Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180) return null;
    if (body.name !== undefined && !isNonEmptyString(body.name)) return null;
    if (body.address !== undefined && !isNonEmptyString(body.address)) return null;
    if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
    const out: ServiceLocationReactionMessageInput = { type: "location", to: body.to, latitude: body.latitude, longitude: body.longitude };
    if (body.name !== undefined) (out as { name?: string }).name = body.name;
    if (body.address !== undefined) (out as { address?: string }).address = body.address;
    if (body.replyToMessageId !== undefined) (out as { replyToMessageId?: string }).replyToMessageId = body.replyToMessageId;
    return out;
  }

  if (!isNonEmptyString(body.messageId)) return null;
  if (body.type === "reaction") {
    if (!hasOnlyKeys(body, ["type", "to", "messageId", "emoji"])) return null;
    if (!isNonEmptyString(body.emoji)) return null;
    return { type: "reaction", to: body.to, messageId: body.messageId, emoji: body.emoji };
  }
  if (!hasOnlyKeys(body, ["type", "to", "messageId"])) return null;
  return { type: "removeReaction", to: body.to, messageId: body.messageId };
}

function validateServiceCommerceInteractiveMessageBody(body: unknown): ServiceCommerceInteractiveMessageInput | null {
  if (!isRecord(body)) return null;
  if (body.type !== "interactiveProduct" && body.type !== "interactiveProducts" && body.type !== "interactiveCatalog" && body.type !== "interactiveLocationRequest") return null;
  if (!isNonEmptyString(body.to)) return null;
  if (body.type === "interactiveProduct") {
    if (!hasOnlyKeys(body, ["type", "to", "catalogId", "productRetailerId", "bodyText", "footerText", "replyToMessageId"])) return null;
    if (!isNonEmptyString(body.catalogId) || !isNonEmptyString(body.productRetailerId)) return null;
    if (body.bodyText !== undefined && !isNonEmptyString(body.bodyText)) return null;
    if (body.footerText !== undefined && !isNonEmptyString(body.footerText)) return null;
    if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
    return body as ServiceCommerceInteractiveMessageInput;
  }
  if (body.type === "interactiveProducts") {
    if (!hasOnlyKeys(body, ["type", "to", "catalogId", "headerText", "bodyText", "sections", "footerText", "replyToMessageId"])) return null;
    if (!isNonEmptyString(body.catalogId) || !isNonEmptyString(body.headerText) || !isNonEmptyString(body.bodyText)) return null;
    if (!Array.isArray(body.sections) || body.sections.length === 0) return null;
    if (body.footerText !== undefined && !isNonEmptyString(body.footerText)) return null;
    if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
    return body as ServiceCommerceInteractiveMessageInput;
  }
  if (body.type === "interactiveCatalog") {
    if (!hasOnlyKeys(body, ["type", "to", "bodyText", "thumbnailProductRetailerId", "headerText", "footerText", "replyToMessageId"])) return null;
    if (!isNonEmptyString(body.bodyText)) return null;
    if (body.thumbnailProductRetailerId !== undefined && !isNonEmptyString(body.thumbnailProductRetailerId)) return null;
    if (body.headerText !== undefined && !isNonEmptyString(body.headerText)) return null;
    if (body.footerText !== undefined && !isNonEmptyString(body.footerText)) return null;
    if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
    return body as ServiceCommerceInteractiveMessageInput;
  }
  if (!hasOnlyKeys(body, ["type", "to", "bodyText", "replyToMessageId"])) return null;
  if (!isNonEmptyString(body.bodyText)) return null;
  if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
  return body as ServiceCommerceInteractiveMessageInput;
}

function validateServiceBasicInteractiveMessageBody(body: unknown): ServiceBasicInteractiveMessageInput | null {
  if (!isRecord(body)) return null;
  if (body.type !== "interactiveButtons" && body.type !== "interactiveList" && body.type !== "interactiveCtaUrl" && body.type !== "callPermissionRequest") return null;
  if (!isNonEmptyString(body.to)) return null;
  if (body.type === "callPermissionRequest") {
    if (!hasOnlyKeys(body, ["type", "to", "bodyText", "footerText", "replyToMessageId"])) return null;
    if (!isNonEmptyString(body.bodyText)) return null;
    if (body.footerText !== undefined && !isNonEmptyString(body.footerText)) return null;
    if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
    return body as ServiceBasicInteractiveMessageInput;
  }
  if (body.type === "interactiveButtons") {
    if (!hasOnlyKeys(body, ["type", "to", "bodyText", "buttons", "headerText", "footerText", "replyToMessageId"])) return null;
    if (!isNonEmptyString(body.bodyText) || !Array.isArray(body.buttons) || body.buttons.length === 0) return null;
    if (body.headerText !== undefined && !isNonEmptyString(body.headerText)) return null;
    if (body.footerText !== undefined && !isNonEmptyString(body.footerText)) return null;
    if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
    return body as ServiceBasicInteractiveMessageInput;
  }
  if (body.type === "interactiveList") {
    if (!hasOnlyKeys(body, ["type", "to", "bodyText", "buttonText", "sections", "headerText", "footerText", "replyToMessageId"])) return null;
    if (!isNonEmptyString(body.bodyText) || !isNonEmptyString(body.buttonText) || !Array.isArray(body.sections) || body.sections.length === 0) return null;
    if (body.headerText !== undefined && !isNonEmptyString(body.headerText)) return null;
    if (body.footerText !== undefined && !isNonEmptyString(body.footerText)) return null;
    if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
    return body as ServiceBasicInteractiveMessageInput;
  }
  if (!hasOnlyKeys(body, ["type", "to", "bodyText", "displayText", "url", "footerText", "replyToMessageId"])) return null;
  if (!isNonEmptyString(body.bodyText) || !isNonEmptyString(body.displayText) || !isNonEmptyString(body.url)) return null;
  if (body.footerText !== undefined && !isNonEmptyString(body.footerText)) return null;
  if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
  return body as ServiceBasicInteractiveMessageInput;
}

function validateServiceContactsMessageBody(body: unknown): ServiceContactsMessageInput | null {
  if (!isRecord(body)) return null;
  if (body.type !== "contacts") return null;
  if (!hasOnlyKeys(body, ["type", "to", "contacts", "replyToMessageId"])) return null;
  if (!isNonEmptyString(body.to)) return null;
  if (!Array.isArray(body.contacts) || body.contacts.length === 0) return null;
  if (body.replyToMessageId !== undefined && !isNonEmptyString(body.replyToMessageId)) return null;
  const out: { type: "contacts"; to: string; contacts: readonly Record<string, unknown>[]; replyToMessageId?: string } = {
    type: "contacts",
    to: body.to,
    contacts: body.contacts as readonly Record<string, unknown>[]
  };
  if (body.replyToMessageId !== undefined) out.replyToMessageId = body.replyToMessageId;
  return out;
}

function buildServiceMediaMessagePayload(input: ServiceMediaMessageInput): GraphMessagesSendBody {
  switch (input.type) {
    case "image":
      return buildSendImagePayload(input) as GraphMessagesSendBody;
    case "video":
      return buildSendVideoPayload(input) as GraphMessagesSendBody;
    case "audio":
      return buildSendAudioPayload(input) as GraphMessagesSendBody;
    case "document":
      return buildSendDocumentPayload(input) as GraphMessagesSendBody;
    case "sticker":
      return buildSendStickerPayload(input) as GraphMessagesSendBody;
  }
}

function buildServiceLocationReactionPayload(input: ServiceLocationReactionMessageInput): GraphMessagesSendBody {
  switch (input.type) {
    case "location":
      return buildSendLocationPayload(input as Parameters<typeof buildSendLocationPayload>[0]) as GraphMessagesSendBody;
    case "reaction":
      return buildSendReactionPayload(input as Parameters<typeof buildSendReactionPayload>[0]) as GraphMessagesSendBody;
    case "removeReaction":
      return buildRemoveReactionPayload(input as Parameters<typeof buildRemoveReactionPayload>[0]) as GraphMessagesSendBody;
  }
}

function buildServiceContactsPayload(input: ServiceContactsMessageInput): GraphMessagesSendBody {
  return buildSendContactsPayload(input as unknown as Parameters<typeof buildSendContactsPayload>[0]) as GraphMessagesSendBody;
}

function buildServiceBasicInteractivePayload(input: ServiceBasicInteractiveMessageInput): GraphMessagesSendBody {
  switch (input.type) {
    case "interactiveButtons":
      return buildSendButtonsPayload(input as unknown as Parameters<typeof buildSendButtonsPayload>[0]) as GraphMessagesSendBody;
    case "interactiveList":
      return buildSendListPayload(input as unknown as Parameters<typeof buildSendListPayload>[0]) as GraphMessagesSendBody;
    case "interactiveCtaUrl":
      return buildSendCtaUrlPayload(input as unknown as Parameters<typeof buildSendCtaUrlPayload>[0]) as GraphMessagesSendBody;
    case "callPermissionRequest":
      return buildSendCallPermissionRequestPayload({
        to: input.to,
        bodyText: input.bodyText as string,
        ...(typeof input.footerText === "string" ? { footerText: input.footerText } : {}),
        ...(typeof input.replyToMessageId === "string" ? { replyToMessageId: input.replyToMessageId } : {})
      }) as GraphMessagesSendBody;
  }
}

function buildServiceCommerceInteractivePayload(input: ServiceCommerceInteractiveMessageInput): GraphMessagesSendBody {
  switch (input.type) {
    case "interactiveProduct":
      return buildSendProductPayload(input as unknown as Parameters<typeof buildSendProductPayload>[0]) as GraphMessagesSendBody;
    case "interactiveProducts":
      return buildSendProductsPayload(input as unknown as Parameters<typeof buildSendProductsPayload>[0]) as GraphMessagesSendBody;
    case "interactiveCatalog":
      return buildSendCatalogPayload(input as unknown as Parameters<typeof buildSendCatalogPayload>[0]) as GraphMessagesSendBody;
    case "interactiveLocationRequest":
      return buildRequestLocationPayload(input as unknown as Parameters<typeof buildRequestLocationPayload>[0]) as GraphMessagesSendBody;
  }
}

function deepSortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => deepSortJson(item));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = deepSortJson(value[key]);
    return out;
  }
  return value;
}

async function persistedWebhookKey(ctx: RuntimeConfig, request: Request): Promise<{ eventKey: string; eventHash: string } | null> {
  if (ctx.persistence === undefined || request.method.toUpperCase() !== "POST") return null;
  const clone = request.clone();
  let envelope: unknown;
  try {
    envelope = JSON.parse(await clone.text()) as unknown;
  } catch {
    return null;
  }
  const eventKey = `webhook:${await sha256Hex(JSON.stringify(deepSortJson(envelope)))}`;
  return { eventKey, eventHash: eventKey.replace(/^webhook:/u, "sha256:") };
}

async function handleWebhook(ctx: RuntimeConfig, request: Request): Promise<Response> {
  const event = await persistedWebhookKey(ctx, request);
  if (event === null || ctx.persistence === undefined) return ctx.webhookHandler(request);

  const dispatches: unknown[] = [];
  const facade: WebhookFacadeLike = {
    dispatch: (update: unknown) => {
      dispatches.push(update);
      return "wats:persistence-staged-dispatch";
    }
  };
  const webhookAdapter = createWebhookAdapter({
    verifyToken: ctx.secrets.webhookVerifyToken,
    appSecret: ctx.secrets.webhookAppSecret,
    whatsapp: facade,
    maxBodyBytes: ctx.profile.webhook.maxBodyBytes,
    ...(ctx.cryptoProvider !== undefined ? { cryptoProvider: ctx.cryptoProvider } : {})
  });
  const response = await createFetchWebhookHandler(webhookAdapter)(request);
  if (response.status !== 200 || dispatches.length === 0) return response;

  const record = await ctx.persistence.recordWebhookEvent({
    eventKey: event.eventKey,
    eventHash: event.eventHash,
    receivedAt: new Date().toISOString()
  });
  if (record === "duplicate") {
    return jsonResponse(200, { status: "ok", received: dispatches.length, dispatched: 0, skipped: dispatches.length });
  }

  let dispatched = 0;
  for (const update of dispatches) {
    try {
      await ctx.whatsapp.dispatch(update);
      dispatched += 1;
    } catch {
      // Preserve WebhookAdapter's acknowledge-on-handler-failure contract.
    }
  }
  return jsonResponse(200, { status: "ok", received: dispatches.length, dispatched, skipped: 0 });
}

function buildSupportedMessageBody(body: unknown): GraphMessagesSendBody | null {
  const text = validateGenericTextMessageBody(body);
  if (text !== null) return text;
  const media = validateServiceMediaMessageBody(body);
  const locationReaction = media === null ? validateServiceLocationReactionMessageBody(body) : null;
  const contacts = media === null && locationReaction === null ? validateServiceContactsMessageBody(body) : null;
  const interactive = media === null && locationReaction === null && contacts === null ? validateServiceBasicInteractiveMessageBody(body) : null;
  const commerceInteractive = media === null && locationReaction === null && contacts === null && interactive === null ? validateServiceCommerceInteractiveMessageBody(body) : null;
  if (media === null && locationReaction === null && contacts === null && interactive === null && commerceInteractive === null) return null;
  try {
    if (media !== null) return buildServiceMediaMessagePayload(media);
    if (locationReaction !== null) return buildServiceLocationReactionPayload(locationReaction);
    if (contacts !== null) return buildServiceContactsPayload(contacts);
    if (interactive !== null) return buildServiceBasicInteractivePayload(interactive);
    return buildServiceCommerceInteractivePayload(commerceInteractive as ServiceCommerceInteractiveMessageInput);
  } catch (error) {
    if (error instanceof GraphRequestValidationError) return null;
    throw error;
  }
}

async function handleTextMessage(ctx: RuntimeConfig, request: Request): Promise<Response> {
  const rawBody = await readRequestText(request);
  if (rawBody === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const parsed = parseJsonText(rawBody);
  if (parsed === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const input = validateTextBody(parsed);
  if (input === null) return errorResponse(400, "malformed_body", "Text message body is invalid.");

  const idempotencyKey = safeIdempotencyKey(request);
  if (idempotencyKey === "invalid") return errorResponse(400, "invalid_idempotency_key", "Idempotency-Key is invalid.");
  const requestHash = idempotencyKey !== null && ctx.persistence !== undefined ? `sha256:${await sha256Hex(rawBody)}` : null;
  if (idempotencyKey !== null && requestHash !== null && ctx.persistence !== undefined) {
    const existing = await ctx.persistence.getServiceRequest({ idempotencyKey, requestHash });
    if (existing === "conflict") return errorResponse(409, "idempotency_conflict", "Idempotency-Key conflicts with a different request body.");
    if (existing !== null) return jsonTextResponse(200, existing.responseJson);
  }

  const payload: GraphMessagesSendBody = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "text",
    text: { body: input.text }
  };
  if (input.previewUrl !== undefined) payload.text.preview_url = input.previewUrl;
  try {
    const result = await ctx.graphClient.messages.sendMessage({
      phoneNumberId: ctx.profile.whatsapp.phoneNumberId,
      to: payload.to,
      text: payload.text.body,
      previewUrl: input.previewUrl
    });
    if (idempotencyKey !== null && requestHash !== null && ctx.persistence !== undefined) {
      const responseJson = responseToJsonText(result);
      if (responseJson !== null) {
        await ctx.persistence.recordServiceRequest({ idempotencyKey, requestHash, responseJson, createdAt: new Date().toISOString() });
      }
    }
    return jsonResponse(200, result);
  } catch (error) {
    return graphFailureResponse(error);
  }
}

async function handleGenericMessage(ctx: RuntimeConfig, request: Request): Promise<Response> {
  const rawBody = await readRequestText(request);
  if (rawBody === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const parsed = parseJsonText(rawBody);
  if (parsed === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const body = buildSupportedMessageBody(parsed);
  if (body === null) return errorResponse(400, "malformed_body", "Message body is invalid or unsupported.");

  const idempotencyKey = safeIdempotencyKey(request);
  if (idempotencyKey === "invalid") return errorResponse(400, "invalid_idempotency_key", "Idempotency-Key is invalid.");
  const requestHash = idempotencyKey !== null && ctx.persistence !== undefined ? `sha256:${await sha256Hex(rawBody)}` : null;
  if (idempotencyKey !== null && requestHash !== null && ctx.persistence !== undefined) {
    const existing = await ctx.persistence.getServiceRequest({ idempotencyKey, requestHash });
    if (existing === "conflict") return errorResponse(409, "idempotency_conflict", "Idempotency-Key conflicts with a different request body.");
    if (existing !== null) return jsonTextResponse(200, existing.responseJson);
  }

  try {
    const result = await ctx.graphClient.request({
      method: "POST",
      path: `/${ctx.profile.whatsapp.phoneNumberId}/messages`,
      body,
      headers: { "content-type": "application/json" }
    });
    if (idempotencyKey !== null && requestHash !== null && ctx.persistence !== undefined) {
      const responseJson = responseToJsonText(result);
      if (responseJson !== null) {
        await ctx.persistence.recordServiceRequest({ idempotencyKey, requestHash, responseJson, createdAt: new Date().toISOString() });
      }
    }
    return jsonResponse(200, result);
  } catch (error) {
    return graphFailureResponse(error);
  }
}

function readWebhookLogFlag(): boolean {
  // Single isolated env read for opt-in observability. Kept narrow on purpose:
  // the service is otherwise env-agnostic and takes resolved config/secrets.
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.WATS_LOG_WEBHOOK_EVENTS;
  return raw === "1" || raw === "true";
}

function readEchoReplyFlag(): boolean {
  // Opt-in demo auto-reply (WATS_ECHO_REPLY=1). When set, the service-built
  // facade replies to inbound text messages with a fixed acknowledgement,
  // exercising the dispatch -> outbound round-trip in a single process. Isolated
  // and fork-strippable; unset (default) registers no responder.
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.WATS_ECHO_REPLY;
  return raw === "1" || raw === "true";
}

function makeRuntimeConfig(config: WatsServiceConfig): RuntimeConfig {
  if (!isRecord(config)) {
    throw new WatsServiceError("invalid_config", "config must be an object.");
  }
  const profile = validateProfile(config.profile);
  const secrets = validateSecrets(config.secrets);
  const webhookPath = validateSafeAbsolutePath(profile.webhook.path, "profile.webhook.path");
  const apiPrefix = validateSafeAbsolutePath(profile.service.apiPrefix, "profile.service.apiPrefix");
  assertNoRouteCollisions(webhookPath, apiPrefix);
  const transport = validateTransport(config.transport);
  const cryptoProvider = validateCryptoProvider(config.cryptoProvider);
  const suppliedWhatsapp = validateWhatsapp(config.whatsapp);
  const persistence = validatePersistence(config.persistence);

  const graphClient = new GraphClient({
    accessToken: secrets.accessToken,
    apiVersion: profile.graph.apiVersion,
    baseUrl: profile.graph.baseUrl,
    ...(transport !== undefined ? { transport } : {})
  });
  let whatsapp: WebhookFacadeLike;
  if (suppliedWhatsapp !== undefined) {
    whatsapp = suppliedWhatsapp;
  } else {
    const facade = new WhatsApp({
      graphClient,
      phoneNumberId: profile.whatsapp.phoneNumberId,
      wabaId: profile.whatsapp.wabaId
    });
    // Opt-in inbound webhook observability (WATS_LOG_WEBHOOK_EVENTS=1). Logs a
    // compact, redaction-safe summary of every dispatched update to stdout so
    // operators can confirm live receipt of messages/statuses without exposing
    // message text or PII. Isolated and fork-strippable: when the flag is unset
    // (default) no handler is registered and behavior is unchanged.
    if (readWebhookLogFlag()) {
      facade.on(
        filtersTyped.custom((u): u is import("@wats/core").TypedUpdate => u !== undefined),
        (ctx) => {
          const update = ctx.update;
          try {
            // Derive a PII-safe detail: the discriminant of the normalized
            // message (text/image/reaction/interactive/...) or the status value
            // (sent/delivered/read/...). Never the message text or sender id.
            let detail: string | null = null;
            if (update.kind === "message") {
              const msg = (update as { message?: { type?: string } }).message;
              detail = typeof msg?.type === "string" ? msg.type : null;
            } else if (update.kind === "status") {
              const st = (update as { status?: { status?: string } }).status;
              detail = typeof st?.status === "string" ? st.status : null;
            }
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({
              event: "wats.webhook.update",
              kind: update.kind ?? "unknown",
              detail,
              updateId: (update as { updateId?: string }).updateId ?? null,
              wabaId: (update as { wabaId?: string }).wabaId ?? null,
              phoneNumberId: (update as { phoneNumberId?: string }).phoneNumberId ?? null,
              at: new Date().toISOString()
            }));
          } catch {
            // Never let logging affect dispatch.
          }
        }
      );
    }
    // Opt-in demo auto-reply (WATS_ECHO_REPLY=1). Replies to inbound text
    // messages with a fixed acknowledgement, exercising the dispatch -> send
    // round-trip in one process. Only the `message` kind with a text body and a
    // valid `from` triggers a reply; failures are swallowed so a send error can
    // never break webhook acknowledgement. Isolated and fork-strippable.
    if (readEchoReplyFlag()) {
      facade.on(
        filtersTyped.message.text(),
        async (ctx) => {
          const msg = (ctx.update as { message?: { from?: string } }).message;
          const from = typeof msg?.from === "string" ? msg.from : null;
          if (from === null) return;
          try {
            const result = await facade.startChat({
              to: from,
              text: "Received by WATS. (automated echo — live deployment test)"
            });
            const sentId = (result as { messages?: ReadonlyArray<{ id?: string }> }).messages?.[0]?.id;
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({
              event: "wats.echo.reply",
              outcome: "sent",
              sent: typeof sentId === "string",
              at: new Date().toISOString()
            }));
          } catch (error) {
            // Surface a PII-safe failure reason (Meta error code/subcode if the
            // SDK mapped one) so a failed auto-reply is observable instead of
            // silently swallowed. Never re-throw: a send failure must not break
            // webhook acknowledgement.
            const e = (error ?? undefined) as { code?: number; errorSubcode?: number } | undefined;
            const code = e?.code;
            const subcode = e?.errorSubcode;
            const name = error instanceof Error ? error.name : "Error";
            // eslint-disable-next-line no-console
            console.log(JSON.stringify({
              event: "wats.echo.reply",
              outcome: "failed",
              errorName: name,
              metaCode: typeof code === "number" ? code : null,
              metaSubcode: typeof subcode === "number" ? subcode : null,
              at: new Date().toISOString()
            }));
          }
        }
      );
    }
    whatsapp = facade;
  }
  const webhookAdapter = createWebhookAdapter({
    verifyToken: secrets.webhookVerifyToken,
    appSecret: secrets.webhookAppSecret,
    whatsapp,
    maxBodyBytes: profile.webhook.maxBodyBytes,
    ...(cryptoProvider !== undefined ? { cryptoProvider } : {})
  });

  return {
    profile,
    secrets,
    graphClient,
    whatsapp,
    ...(cryptoProvider !== undefined ? { cryptoProvider } : {}),
    ...(persistence !== undefined ? { persistence } : {}),
    webhookHandler: createFetchWebhookHandler(webhookAdapter),
    webhookPath,
    apiPrefix,
    textPath: `${apiPrefix}/messages/text`,
    messagesPath: `${apiPrefix}/messages`
  };
}

export function createWatsServiceApp(config: WatsServiceConfig): WatsServiceApp {
  const ctx = makeRuntimeConfig(config);

  return {
    async fetch(request: Request): Promise<Response> {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return errorResponse(400, "bad_request", "Request URL is invalid.");
      }
      const method = request.method.toUpperCase();
      const path = url.pathname;

      if (path === "/healthz") {
        if (method !== "GET") return methodNotAllowed("GET");
        return jsonResponse(200, { ok: true, service: SERVICE_NAME });
      }

      if (path === "/readyz") {
        if (method !== "GET") return methodNotAllowed("GET");
        return jsonResponse(200, { ok: true, service: SERVICE_NAME });
      }

      if (path === OPENAPI_PATH) {
        if (method !== "GET") return methodNotAllowed("GET");
        return jsonResponse(200, createWatsServiceOpenApiDocument(ctx.profile, { serverUrl: url.origin }));
      }

      if (path === ctx.webhookPath) {
        if (method !== "GET" && method !== "POST") return methodNotAllowed("GET, POST");
        return handleWebhook(ctx, request);
      }

      if (path === ctx.textPath) {
        if (method !== "POST") return methodNotAllowed("POST");
        if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return unauthorized();
        return handleTextMessage(ctx, request);
      }

      if (path === ctx.messagesPath) {
        if (method !== "POST") return methodNotAllowed("POST");
        if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return unauthorized();
        return handleGenericMessage(ctx, request);
      }

      return errorResponse(404, "not_found", "Route not found.");
    }
  };
}
