import type { WatsProfileConfig } from "@switchbord/config";
import { WhatsApp } from "@switchbord/core";
import { GraphClient, type GraphMessagesSendBody, type Transport } from "@switchbord/graph";
import type { CryptoProvider } from "@switchbord/crypto";
import {
  createFetchWebhookHandler,
  createWebhookAdapter,
  type WebhookFacadeLike
} from "@switchbord/http";

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
}

export type WatsServiceErrorCode =
  | "invalid_config"
  | "invalid_profile"
  | "invalid_secrets"
  | "invalid_secret"
  | "invalid_path"
  | "invalid_transport"
  | "invalid_crypto_provider"
  | "invalid_whatsapp";

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
const DEFAULT_OPENAPI_VERSION = "0.2.0";

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

function jsonResponse(status: number, payload: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": JSON_CONTENT_TYPE, ...(headers ?? {}) }
  });
}

function errorResponse(status: number, code: string, message?: string, headers?: HeadersInit): Response {
  return jsonResponse(status, { error: { code, ...(message ? { message } : {}) } }, headers);
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
    requestBody: {
      required: true,
      ...jsonContentSchema(schemaRef(schemaName))
    },
    responses: {
      "200": okResponseSpec("Graph response passthrough.", "GraphResponsePassthrough"),
      "400": errorResponseSpec("Malformed JSON or unsupported body."),
      "401": errorResponseSpec("Missing or invalid service bearer token."),
      "405": errorResponseSpec("Method not allowed."),
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
            message: { type: "string" }
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
        post: messageOperation("Send a supported generic text message body", "GenericTextMessageBody")
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

function validateGenericMessageBody(body: unknown): GraphMessagesSendBody | null {
  if (!isRecord(body)) return null;
  if (body.messaging_product !== "whatsapp") return null;
  if (!isNonEmptyString(body.to)) return null;
  if (body.type !== "text") return null;
  if (!isRecord(body.text) || !isNonEmptyString(body.text.body)) return null;
  if (body.text.preview_url !== undefined && typeof body.text.preview_url !== "boolean") return null;
  return body as unknown as GraphMessagesSendBody;
}

async function handleTextMessage(ctx: RuntimeConfig, request: Request): Promise<Response> {
  const parsed = await parseJsonRequest(request);
  if (parsed === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const input = validateTextBody(parsed);
  if (input === null) return errorResponse(400, "malformed_body", "Text message body is invalid.");
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
    return jsonResponse(200, result);
  } catch {
    return errorResponse(502, "graph_request_failed", "Graph request failed.");
  }
}

async function handleGenericMessage(ctx: RuntimeConfig, request: Request): Promise<Response> {
  const parsed = await parseJsonRequest(request);
  if (parsed === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const body = validateGenericMessageBody(parsed);
  if (body === null) return errorResponse(400, "malformed_body", "Message body is invalid or unsupported.");
  try {
    const result = await ctx.graphClient.request({
      method: "POST",
      path: `/${ctx.profile.whatsapp.phoneNumberId}/messages`,
      body,
      headers: { "content-type": "application/json" }
    });
    return jsonResponse(200, result);
  } catch {
    return errorResponse(502, "graph_request_failed", "Graph request failed.");
  }
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

  const graphClient = new GraphClient({
    accessToken: secrets.accessToken,
    apiVersion: profile.graph.apiVersion,
    baseUrl: profile.graph.baseUrl,
    ...(transport !== undefined ? { transport } : {})
  });
  const whatsapp = suppliedWhatsapp ?? new WhatsApp({
    graphClient,
    phoneNumberId: profile.whatsapp.phoneNumberId,
    wabaId: profile.whatsapp.wabaId
  });
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
        return ctx.webhookHandler(request);
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
