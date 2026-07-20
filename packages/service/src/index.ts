import type { WatsProfileConfig } from "@wats/config";
import { WhatsApp, filtersTyped } from "@wats/core";
import {
  approveGroupJoinRequests,
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
  buildSendPinPayload,
  createGroup,
  buildSendReactionPayload,
  buildSendStickerPayload,
  buildSendVideoPayload,
  deleteGroup,
  getGroup,
  getGroupInviteLink,
  GraphApiError,
  GraphRateLimitError,
  GraphClient,
  GraphRequestValidationError,
  listGroupJoinRequests,
  listGroups,
  rejectGroupJoinRequests,
  removeGroupParticipants,
  resetGroupInviteLink,
  updateGroup,
  type GraphMessagesSendBody,
  type Transport
} from "@wats/graph";
import type { CryptoProvider } from "@wats/crypto";
import type { PersistenceStore } from "@wats/persistence";
import {
  getConversationWindowState,
  type ConversationWindowState
} from "@wats/persistence";
import {
  createFetchWebhookHandler,
  createWebhookAdapter,
  type WebhookFacadeLike
} from "@wats/http";
import {
  httpTelemetryAttributes,
  graphTelemetryAttributes,
  sendTelemetryAttributes,
  persistenceTelemetryAttributes,
  webhookTelemetryAttributes,
  type TelemetrySink,
  type TelemetryAttributes,
  type OtelMetricName,
  NOOP_TELEMETRY_SINK,
  OTEL_ATTR
} from "./telemetry.js";

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
  /**
   * Opt in to WhatsApp Groups management service routes under apiPrefix.
   * Defaults to false so non-group deployments keep the pre-Groups route set.
   */
  readonly enableGroupRoutes?: boolean;
  /**
   * Optional telemetry sink for OpenTelemetry-compatible exporters. When
   * omitted, internal /metrics exposition is still updated; no user-owned
   * collector receives telemetry.
   */
  readonly telemetrySink?: TelemetrySink;
  /**
   * Inject a pre-built MetricsRegistry to share between /metrics exposition
   * and an outbox metrics reporter. Must be created via createMetricsRegistry
   * (it declares every standard family); a bare MetricsRegistry would throw
   * on the first instrumentation call. When omitted the service creates and
   * owns its own registry.
   */
  readonly metricsRegistry?: MetricsRegistry;
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
  /**
   * Include opt-in Groups service routes in the generated document.
   */
  readonly enableGroupRoutes?: boolean;
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
  readonly conversationsPath: string;
  readonly enableGroupRoutes: boolean;
  readonly groupsPath: string;
  readonly metrics: MetricsRegistry;
  readonly telemetrySink: TelemetrySink;
  readonly errorLedger: ErrorLedger;
}

interface ServiceRouteMatch {
  readonly route: "groups" | "group" | "groupInviteLink" | "groupParticipants" | "groupJoinRequests";
  readonly groupId?: string;
}

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SERVICE_NAME = "wats";
const OPENAPI_PATH = "/openapi.json";
const STATUS_PATH = "/status";
const METRICS_PATH = "/metrics";
const DEBUG_DIAGNOSTICS_PATH = "/debug/diagnostics";
const SERVER_START_MS = Date.now();
const DEFAULT_OPENAPI_TITLE = "WATS Service API";
const DEFAULT_OPENAPI_VERSION = "0.3.30";

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
    typeof value.enqueueOutboxItem !== "function" ||
    typeof value.claimOutboxItems !== "function" ||
    typeof value.markOutboxItemFailed !== "function" ||
    typeof value.markOutboxItemSucceeded !== "function" ||
    typeof value.recordMessage !== "function" ||
    typeof value.appendMessageStatus !== "function" ||
    typeof value.getMessage !== "function" ||
    typeof value.listMessages !== "function" ||
    typeof value.getLatestInboundMessageAt !== "function" ||
    typeof value.countOutboxPending !== "function" ||
    typeof value.close !== "function"
  ) {
    throw new WatsServiceError("invalid_persistence", "persistence must be a PersistenceStore.");
  }
  return value as unknown as PersistenceStore;
}

// A MetricsRegistry is structurally validated by the methods /metrics and the
// outbox reporter call. The contract is: pass a registry from
// createMetricsRegistry(). A bare `new MetricsRegistry()` (without the
// standard declarations) is accepted structurally but would throw on the
// first instrumentation call — documented on WatsServiceConfig.metricsRegistry.
function validateMetricsRegistry(value: unknown): MetricsRegistry | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.declareCounter !== "function" ||
    typeof value.declareHistogram !== "function" ||
    typeof value.declareGauge !== "function" ||
    typeof value.incrementCounter !== "function" ||
    typeof value.observeHistogram !== "function" ||
    typeof value.setGauge !== "function" ||
    typeof value.render !== "function" ||
    typeof value.families !== "function"
  ) {
    throw new WatsServiceError("invalid_config", "metricsRegistry must be a MetricsRegistry (use createMetricsRegistry).");
  }
  return value as unknown as MetricsRegistry;
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

/**
 * Read a numeric diagnostic field from a (possibly hostile) error object,
 * failing closed: a throwing getter, wrong type, or non-finite value yields
 * undefined rather than crashing or forwarding junk. WATS-130 A1.2.
 */
function safeFiniteNumber(source: unknown, key: string): number | undefined {
  try {
    const value = (source as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a short string diagnostic field from a (possibly hostile) error object,
 * failing closed and capping length so an oversize/poisoned value cannot bloat
 * the response or log line. WATS-130 A1.2 / R1.4.
 */
function safeShortString(source: unknown, key: string, maxLen = 256): string | undefined {
  try {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > maxLen) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

interface SanitizedGraphDiagnostics {
  metaCode?: number;
  metaSubcode?: number;
  metaType?: string;
  fbtraceId?: string;
}

/**
 * Extract the sanitized, structured Meta diagnostics from a Graph failure.
 * Only safe structured identifiers (code/subcode/type/fbtraceId) are surfaced;
 * Meta's free-form `message` text is intentionally NOT forwarded — it is the
 * primary vector for tokens/PII/phone numbers, so the redaction contract
 * (R1.4) is satisfied by omission rather than by scrubbing arbitrary text.
 */
function sanitizeGraphDiagnostics(error: unknown): SanitizedGraphDiagnostics {
  if (!(error instanceof GraphApiError)) {
    return {};
  }
  const out: SanitizedGraphDiagnostics = {};
  const code = safeFiniteNumber(error, "code");
  if (code !== undefined) out.metaCode = code;
  const subcode = safeFiniteNumber(error, "errorSubcode");
  if (subcode !== undefined) out.metaSubcode = subcode;
  const type = safeShortString(error, "type");
  if (type !== undefined) out.metaType = type;
  const fbtraceId = safeShortString(error, "fbtraceId");
  if (fbtraceId !== undefined) out.fbtraceId = fbtraceId;
  return out;
}

// WATS-162: derive a status_class-able HTTP status from a Graph failure for
// graph_operations_total. GraphApiError (and its subclasses, e.g.
// GraphRateLimitError) always carries the real upstream status. A
// GraphNetworkError (or anything else) never reached Meta at all — no HTTP
// status exists, so it is classified as 5xx (a service-side/network failure,
// not a client error), matching the existing graphFailureResponse's own
// treatment of network failures as 502-class outcomes.
function graphErrorStatus(error: unknown): number {
  if (error instanceof GraphApiError) return error.status;
  return 502;
}

function graphFailureResponse(error: unknown, errorLedger?: ErrorLedger): Response {
  errorLedger?.record(error);
  const diagnostics = sanitizeGraphDiagnostics(error);

  // Emit one warn-level JSON log line carrying only sanitized structured
  // diagnostics so container logs are diagnosable on their own (R1.3).
  // Logging must never throw, so the whole block is guarded.
  try {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({
      event: "wats.graph.failure",
      metaCode: diagnostics.metaCode ?? null,
      metaSubcode: diagnostics.metaSubcode ?? null,
      metaType: diagnostics.metaType ?? null,
      fbtraceId: diagnostics.fbtraceId ?? null,
      at: new Date().toISOString()
    }));
  } catch {
    // Never let logging affect the error path.
  }

  const payload: Record<string, unknown> = {
    code: "graph_request_failed",
    message: "Graph request failed.",
    ...diagnostics
  };

  // R1.2 status mapping: keep the 5xx boundary (the service did not receive a
  // bad request from its caller). Rate-limit class -> 503, echoing Meta's
  // Retry-After verbatim when present; auth class and everything else -> 502.
  if (error instanceof GraphRateLimitError) {
    const retryAfter = safeShortString(error, "retryAfter", 64);
    const headers = retryAfter !== undefined ? { "retry-after": retryAfter } : undefined;
    return jsonResponse(503, { error: payload }, headers);
  }
  return jsonResponse(502, { error: payload });
}

function methodNotAllowed(allow: string): Response {
  return errorResponse(405, "method_not_allowed", "Method not allowed.", { Allow: allow });
}

function unauthorized(): Response {
  return errorResponse(401, "unauthorized", "Missing or invalid bearer token.");
}

// The catch-all 404 for unknown routes. Telemetry endpoints fail closed to
// this exact response (byte-identical body + status) so a missing/mismatched
// bearer token is indistinguishable from a non-existent route — per the
// WATS-161 telemetry taxonomy "Endpoint protection" contract.
function notFound(): Response {
  return errorResponse(404, "not_found", "Route not found.");
}

// WATS-163: templated route inventory for the /status operator endpoint. Path
// parameters are rendered as :param tokens (never raw ids) and dynamic-id
// routes are only listed when their feature is enabled, so the inventory can
// never leak a WABA id, phone-number id, or message id.
function buildRouteInventory(ctx: RuntimeConfig): string[] {
  const routes = [
    "/healthz",
    "/readyz",
    OPENAPI_PATH,
    STATUS_PATH,
    METRICS_PATH,
    DEBUG_DIAGNOSTICS_PATH,
    ctx.webhookPath,
    ctx.textPath,
    ctx.messagesPath,
    `${ctx.messagesPath}/:id`,
    `${ctx.conversationsPath}/:phone/window`
  ];
  if (ctx.enableGroupRoutes) {
    routes.push(
      ctx.groupsPath,
      `${ctx.groupsPath}/:groupId`,
      `${ctx.groupsPath}/:groupId/invite-link`,
      `${ctx.groupsPath}/:groupId/participants`,
      `${ctx.groupsPath}/:groupId/join-requests`
    );
  }
  return routes;
}

// WATS-163: derive a coarse, low-cardinality service mode label. No PII, no
// ids — only the shape of what is enabled.
function deriveServiceMode(ctx: RuntimeConfig): string {
  const parts: string[] = ["webhook"];
  if (ctx.persistence !== undefined) parts.push("persistence");
  if (ctx.enableGroupRoutes) parts.push("groups");
  return parts.join("+");
}

// WATS-163: assemble the redacted /status payload. Only safe operator fields
// are included. The persistence summary reuses PersistenceHealth, which is
// already redaction-safe (ok / backend / currentVersion / redactedLocation).
//
// Defense in depth: an in-tree adapter always returns a bracketed
// `[REDACTED_*]` location constant, but a non-conforming custom adapter could
// resolve `health()` to a malformed object or a real filesystem path. We
// therefore coerce every field to its expected type and clamp any
// redactedLocation that is not already in the safe `[REDACTED...]` form, so a
// path can never leak through /status regardless of adapter behavior.
function sanitizePersistenceHealth(health: unknown): Record<string, unknown> {
  const record = (typeof health === "object" && health !== null ? health : {}) as Record<string, unknown>;
  const rawLocation = typeof record.redactedLocation === "string" ? record.redactedLocation : "";
  const safeLocation = /^\[REDACTED/u.test(rawLocation) ? rawLocation : "[REDACTED]";
  const rawBackend = typeof record.backend === "string" ? record.backend : "unknown";
  const safeBackend = /^\b(sqlite|postgres)\b$/iu.test(rawBackend) ? rawBackend.toLowerCase() : "unknown";
  return {
    ok: record.ok === true,
    backend: safeBackend,
    currentVersion: Number.isInteger(record.currentVersion) ? (record.currentVersion as number) : 0,
    redactedLocation: safeLocation
  };
}

async function buildStatusPayload(ctx: RuntimeConfig): Promise<Record<string, unknown>> {
  let persistence: Record<string, unknown> | null = null;
  if (ctx.persistence !== undefined) {
    try {
      persistence = sanitizePersistenceHealth(await ctx.persistence.health());
    } catch {
      // Never surface a persistence error body; report a redacted unhealthy
      // summary so /status stays diagnosable without leaking error detail.
      persistence = { ok: false, backend: "unknown", currentVersion: 0, redactedLocation: "[REDACTED]" };
    }
  }
  return {
    service: SERVICE_NAME,
    version: DEFAULT_OPENAPI_VERSION,
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - SERVER_START_MS) / 1000)),
    graphApiVersion: ctx.profile.graph.apiVersion,
    serviceMode: deriveServiceMode(ctx),
    routes: buildRouteInventory(ctx),
    featureFlags: {
      groupRoutes: ctx.enableGroupRoutes,
      persistence: ctx.persistence !== undefined
    },
    persistence
  };
}

// WATS-165: bounded, redacted support diagnostics payload. Never contains
// tokens, env values, stack traces, raw paths, phone numbers, ids, or message
// content — only structured runtime facts an operator needs for triage.
async function buildDiagnosticsPayload(ctx: RuntimeConfig): Promise<Record<string, unknown>> {
  let persistence: Record<string, unknown> = { ok: false, backend: "unknown", currentVersion: 0, redactedLocation: "[REDACTED]" };
  if (ctx.persistence !== undefined) {
    try {
      persistence = sanitizePersistenceHealth(await ctx.persistence.health());
    } catch {
      // Keep the default redacted unhealthy summary.
    }
  }
  return {
    service: SERVICE_NAME,
    version: DEFAULT_OPENAPI_VERSION,
    graphApiVersion: ctx.profile.graph.apiVersion,
    serviceMode: deriveServiceMode(ctx),
    runtime: typeof (globalThis as { Bun?: unknown }).Bun === "object" ? "bun" : "unknown",
    routes: buildRouteInventory(ctx),
    featureFlags: {
      groupRoutes: ctx.enableGroupRoutes,
      persistence: ctx.persistence !== undefined
    },
    persistence,
    metricFamilies: ctx.metrics.families(),
    recentErrors: ctx.errorLedger.snapshot(),
    configShape: redactedConfigShape(ctx.profile)
  };
}

function redactedConfigShape(profile: WatsProfileConfig): Record<string, unknown> {
  // Summarize the config shape with env-secret refs, never the values. Keys
  // here are the fields a support operator expects to see, plus runtime
  // feature flags. No file paths, no env values, no tokens.
  return {
    graph: { apiVersion: profile.graph.apiVersion },
    auth: { accessToken: envRef(profile.auth.accessToken) },
    service: { host: profile.service.host, port: profile.service.port, apiPrefix: profile.service.apiPrefix },
    webhook: {
      path: profile.webhook.path,
      verifyToken: envRef(profile.webhook.verifyToken),
      appSecret: envRef(profile.webhook.appSecret),
      maxBodyBytes: profile.webhook.maxBodyBytes
    }
  };
}

function envRef(value: { env: string } | string): string {
  return "[REDACTED]";
}

// ---------------------------------------------------------------------------
// WATS-162: Prometheus/OpenMetrics-compatible /metrics registry.
//
// A tiny in-memory counter/histogram registry, gated to exactly the metric
// families and label keys the WATS-161 taxonomy allows. The allowlists live
// here (not just in the doc) so an attempt to record an unlisted metric name
// or label key throws in development/tests rather than silently emitting an
// unreviewed series. Label values derived from untrusted input (update_kind,
// endpoint_family) are enum-clamped to "unknown" per the taxonomy's
// enum-clamping rule — this is enforced by the recording functions below,
// not by the caller.
//
// outbox_depth (gauge) is intentionally NOT implemented: PersistenceStore
// exposes no non-mutating outbox-count query, and adding one is out of scope
// for a metrics-endpoint slice. Revisit when persistence gains that query.
// ---------------------------------------------------------------------------

const METRIC_STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;
type MetricStatusClass = (typeof METRIC_STATUS_CLASSES)[number];

const METRIC_OUTCOMES = ["success", "error", "skipped", "deduped"] as const;
type MetricOutcome = (typeof METRIC_OUTCOMES)[number];

const METRIC_ENDPOINT_FAMILIES = ["messages", "media", "templates", "groups", "flows"] as const;
type MetricEndpointFamily = (typeof METRIC_ENDPOINT_FAMILIES)[number];

// Mirrors TypedUpdateKind in @wats/core (packages/core/src/webhookNormalizer.ts).
// Pinned here as a literal list (not imported) so a change to the upstream
// type is caught by the drift-guard test rather than silently widening what
// /metrics will accept as a label value.
const METRIC_UPDATE_KINDS = [
  "message", "status", "account", "unknown", "callConnect", "callTerminate",
  "callStatus", "groupLifecycle", "groupParticipants", "groupSettings",
  "groupStatus", "userPreferences", "system", "chatOpened"
] as const;
type MetricUpdateKind = (typeof METRIC_UPDATE_KINDS)[number];

function statusClassOf(status: number): MetricStatusClass | "unknown" {
  if (status >= 100 && status < 200) return "unknown";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "unknown";
}

// Enum-clamp an untrusted string against a fixed allowlist. Never forwards a
// raw, unbounded, or PII-bearing value into a metric label.
function clampToEnum<T extends string>(value: string, allowed: readonly T[]): T | "unknown" {
  return (allowed as readonly string[]).includes(value) ? (value as T) : "unknown";
}

interface HistogramState {
  readonly bucketCounts: number[];
  sum: number;
  count: number;
}

// A minimal Prometheus-compatible metrics registry. Each metric family is
// declared once at construction with its allowed label key set; recording a
// label key or value outside that declared shape throws (development/tests
// only ever exercise the allowlisted shape, so this never fires in normal
// operation and exists to catch drift at the source rather than at scrape
// time).
export class MetricsRegistry {
  readonly #counters = new Map<string, Map<string, number>>();
  readonly #histograms = new Map<string, Map<string, HistogramState>>();
  readonly #gauges = new Map<string, Map<string, number>>();
  readonly #counterHelp = new Map<string, string>();
  readonly #histogramHelp = new Map<string, string>();
  readonly #gaugeHelp = new Map<string, string>();
  readonly #gaugeLabelNames = new Map<string, ReadonlySet<string>>();
  readonly #histogramBuckets: readonly number[];

  constructor(histogramBucketsSeconds: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.#histogramBuckets = histogramBucketsSeconds;
  }

  declareCounter(name: string, help: string): void {
    if (!this.#counters.has(name)) this.#counters.set(name, new Map());
    this.#counterHelp.set(name, help);
  }

  declareHistogram(name: string, help: string): void {
    if (!this.#histograms.has(name)) this.#histograms.set(name, new Map());
    this.#histogramHelp.set(name, help);
  }

  // Gauges differ from counters: a setGauge call REPLACES the current value
  // for a label set rather than adding to it. The label-key allowlist is
  // declared up front so a caller cannot smuggle an unbounded or PII-bearing
  // label key past the taxonomy's allowlist (counters/histograms predate this
  // guard and remain open-shape; new gauge families pin their labels).
  declareGauge(name: string, help: string, labelNames: readonly string[] = []): void {
    if (!this.#gauges.has(name)) this.#gauges.set(name, new Map());
    this.#gaugeHelp.set(name, help);
    this.#gaugeLabelNames.set(name, new Set(labelNames));
  }

  incrementCounter(name: string, labels: Readonly<Record<string, string>>, value = 1): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`MetricsRegistry: counter increment value must be a non-negative finite number, received ${value}`);
    const series = this.#counters.get(name);
    if (series === undefined) throw new Error(`MetricsRegistry: counter "${name}" was not declared.`);
    const key = labelKey(labels);
    series.set(key, (series.get(key) ?? 0) + value);
  }

  observeHistogram(name: string, labels: Readonly<Record<string, string>>, valueSeconds: number): void {
    if (!Number.isFinite(valueSeconds) || valueSeconds < 0) throw new Error(`MetricsRegistry: histogram observation must be a non-negative finite number, received ${valueSeconds}`);
    const series = this.#histograms.get(name);
    if (series === undefined) throw new Error(`MetricsRegistry: histogram "${name}" was not declared.`);
    const key = labelKey(labels);
    let state = series.get(key);
    if (state === undefined) {
      state = { bucketCounts: new Array(this.#histogramBuckets.length).fill(0), sum: 0, count: 0 };
      series.set(key, state);
    }
    for (let i = 0; i < this.#histogramBuckets.length; i += 1) {
      if (valueSeconds <= this.#histogramBuckets[i]!) state.bucketCounts[i] += 1;
    }
    state.sum += valueSeconds;
    state.count += 1;
  }

  // Sets the current value of a gauge for a label set, replacing any prior
  // value. Value must be a finite, non-negative number — gauges here model
  // depths/counts, never signed deltas. Labels must exactly match the
  // declared label-key set (no missing, no extra) so the exposition cannot
  // sprout an unbounded label series.
  setGauge(name: string, value: number, labels: Readonly<Record<string, string>>): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`MetricsRegistry: gauge value must be a non-negative finite number, received ${value}`);
    const series = this.#gauges.get(name);
    if (series === undefined) throw new Error(`MetricsRegistry: gauge "${name}" was not declared.`);
    const allowed = this.#gaugeLabelNames.get(name);
    if (allowed !== undefined) {
      const keys = Object.keys(labels);
      if (keys.length !== allowed.size || keys.some((k) => !allowed.has(k))) {
        throw new Error(`MetricsRegistry: gauge "${name}" labels must be {${Array.from(allowed).sort().join(", ")}}, received {${keys.sort().join(", ")}}.`);
      }
    }
    series.set(labelKey(labels), value);
  }

  // Renders Prometheus text exposition format (version=0.0.4). Deterministic
  // ordering (declaration order, then insertion order of label combinations)
  // so output is stable across scrapes for the same traffic pattern.
  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.#counters) {
      if (series.size === 0) continue;
      lines.push(`# HELP ${name} ${this.#counterHelp.get(name) ?? ""}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [key, value] of series) {
        lines.push(`${name}${key} ${value}`);
      }
    }
    for (const [name, series] of this.#histograms) {
      if (series.size === 0) continue;
      lines.push(`# HELP ${name} ${this.#histogramHelp.get(name) ?? ""}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [key, state] of series) {
        const baseLabels = key.slice(1, -1); // strip surrounding { }
        for (let i = 0; i < this.#histogramBuckets.length; i += 1) {
          const bucketLabel = baseLabels.length > 0
            ? `{${baseLabels},le="${this.#histogramBuckets[i]}"}`
            : `{le="${this.#histogramBuckets[i]}"}`;
          // bucketCounts[i] already holds the cumulative count of
          // observations <= this threshold (incremented in observeHistogram),
          // matching Prometheus's own cumulative-bucket semantics directly.
          lines.push(`${name}_bucket${bucketLabel} ${state.bucketCounts[i]}`);
        }
        const infLabel = baseLabels.length > 0 ? `{${baseLabels},le="+Inf"}` : `{le="+Inf"}`;
        lines.push(`${name}_bucket${infLabel} ${state.count}`);
        lines.push(`${name}_sum${key} ${state.sum}`);
        lines.push(`${name}_count${key} ${state.count}`);
      }
    }
    for (const [name, series] of this.#gauges) {
      if (series.size === 0) continue;
      lines.push(`# HELP ${name} ${this.#gaugeHelp.get(name) ?? ""}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [key, value] of series) {
        lines.push(`${name}${key} ${value}`);
      }
    }
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  }

  // Names only — used by /debug/diagnostics. No values or label sets exposed.
  families(): readonly string[] {
    return Array.from(new Set([...this.#counters.keys(), ...this.#histograms.keys(), ...this.#gauges.keys()]));
  }
}

// WATS-165: bounded in-memory error-class ledger for /debug/diagnostics.
// Records only class names with counts — no messages, no stack traces, no
// PII, no env values. Bounded OOM defense: a single runaway error source can
// never grow the ledger beyond MAX_ERROR_CLASSES, and error names are capped at
// MAX_ERROR_NAME_LENGTH characters before counting. When the cap is exceeded
// the least-recently recorded class is evicted (Map insertion order), so a
// brand-new failure is always visible on its first occurrence.
export class ErrorLedger {
  readonly #counts = new Map<string, number>();
  static readonly MAX_ERROR_CLASSES = 10;
  static readonly MAX_ERROR_NAME_LENGTH = 80;

  record(error: unknown): void {
    const name = this.#classNameOf(error);
    const key = name.length > ErrorLedger.MAX_ERROR_NAME_LENGTH
      ? `${name.slice(0, ErrorLedger.MAX_ERROR_NAME_LENGTH)}...`
      : name;
    const current = this.#counts.get(key) ?? 0;
    this.#counts.set(key, current + 1);
    // Evict the oldest class when over capacity, preserving OOM defense and
    // ensuring the most recently seen class name is retained on first sight.
    if (this.#counts.size > ErrorLedger.MAX_ERROR_CLASSES) {
      const firstKey = this.#counts.keys().next().value;
      if (firstKey !== undefined) this.#counts.delete(firstKey);
    }
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.#counts);
  }

  #classNameOf(error: unknown): string {
    if (error === null || error === undefined) return "Error";
    if (typeof error === "string") return "Error";
    if (error instanceof Error) return error.constructor.name || "Error";
    if (typeof error === "object" && "constructor" in error && typeof (error as { constructor?: { name?: string } }).constructor?.name === "string") {
      return (error as { constructor: { name: string } }).constructor.name;
    }
    return "Error";
  }
}

function createErrorLedger(): ErrorLedger {
  return new ErrorLedger();
}

// Stable, sorted label-key serialization so the same label set always
// produces the same series key regardless of the order fields were passed.
//
// Escape a label value per the Prometheus text exposition format: backslash
// and double-quote must be escaped, and a literal newline must be escaped to
// \n. Defense in depth — every current label value flows from an enum-
// clamped or literal closed set, so this never fires in practice, but a
// future call site that passes an un-clamped string must not be able to
// corrupt the exposition format.
function escapeLabelValue(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
}

function labelKey(labels: Readonly<Record<string, string>>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const rendered = keys.map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`).join(",");
  return `{${rendered}}`;
}

export function createMetricsRegistry(): MetricsRegistry {
  const registry = new MetricsRegistry();
  registry.declareCounter("http_requests_total", "Inbound HTTP requests to the service.");
  registry.declareHistogram("http_request_duration_seconds", "Request duration in seconds.");
  registry.declareCounter("webhook_normalization_total", "Webhook envelopes normalized by update kind and outcome.");
  registry.declareCounter("graph_operations_total", "Outbound Graph API calls by endpoint family and status class.");
  registry.declareCounter("send_outcomes_total", "Message send attempts by outcome.");
  registry.declareCounter("persistence_operations_total", "Persistence store operations by adapter and outcome.");
  // Outbox worker metrics. The depth gauge partitions by adapter and state
  // (pending/processing/succeeded); the metrics reporter sets only the pending
  // state series from OutboxWorkerTickReport.pending — a store-query reporter
  // could populate the remaining states. The processed counter carries a
  // success/error outcome mirroring the rest of the outcome enum.
  registry.declareGauge(
    "outbox_depth",
    "Number of items in the persistence outbox, partitioned by adapter and state.",
    ["adapter", "state"]
  );
  registry.declareCounter(
    "outbox_processed_total",
    "Outbox worker items processed by outcome."
  );
  return registry;
}

// Shape of the tick report delivered to startOutboxWorker's onReport. Kept as
// a local structural type so @wats/service does not take a hard runtime import
// of @wats/persistence just for this wiring helper; the real
// OutboxWorkerTickReport from @wats/persistence is structurally compatible.
interface OutboxTickReport {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly pending: number;
}

interface OutboxMetricsReporter {
  /** Update outbox_depth + outbox_processed_total from a tick report. */
  readonly onReport: (report: OutboxTickReport) => void;
  /** Optional sink for loop infrastructure errors; not metric-emitting. */
  readonly onError?: (error: unknown) => void;
}

const OUTBOX_ADAPTERS = ["sqlite", "postgres"] as const;

function clampOutboxAdapter(adapter: unknown): string {
  return typeof adapter === "string" && (OUTBOX_ADAPTERS as readonly string[]).includes(adapter.toLowerCase())
    ? adapter.toLowerCase()
    : "unknown";
}

// Wiring helper: translate an OutboxWorkerTickReport into registry state so a
// long-running outbox worker's depth and throughput are visible from /metrics
// without the worker knowing about the MetricsRegistry shape. The returned
// { onReport, onError? } is structurally compatible with startOutboxWorker's
// StartOutboxWorkerOptions, so the caller can spread it directly:
//
//   const metrics = createMetricsRegistry();
//   const app = createWatsServiceApp({ ..., metricsRegistry: metrics });
//   const reporter = createOutboxMetricsReporter(metrics, { adapter: store.backend });
//   startOutboxWorker(store, { handler, ...reporter });
//
// onReport sets outbox_depth{adapter, state="pending"} = report.pending (the
// only state the worker's countOutboxPending observes) and increments
// outbox_processed_total{outcome="success"} by report.succeeded and
// {outcome="error"} by report.failed. The depth gauge is registry-only: the
// TelemetrySink seam has no setGauge, so user-owned OTel bridges do not
// receive gauge samples — only /metrics scrapes see them.
export function createOutboxMetricsReporter(
  registry: MetricsRegistry,
  options: { readonly adapter: string }
): OutboxMetricsReporter {
  if (registry === null || typeof registry !== "object" || typeof (registry as { setGauge?: unknown }).setGauge !== "function" || typeof (registry as { incrementCounter?: unknown }).incrementCounter !== "function") {
    throw new TypeError("createOutboxMetricsReporter: registry must be a MetricsRegistry.");
  }
  if (options === null || typeof options !== "object") {
    throw new TypeError("createOutboxMetricsReporter: options must be an object.");
  }
  if (typeof options.adapter !== "string" || options.adapter.length === 0) {
    throw new TypeError("createOutboxMetricsReporter: options.adapter must be a non-empty string.");
  }
  const adapter = clampOutboxAdapter(options.adapter);
  return {
    onReport(report: OutboxTickReport): void {
      // Defensive: a malformed report must not corrupt the registry. Non-finite
      // or negative counts are clamped to 0 rather than throwing — the worker
      // loop swallows onReport failures, so a throw here would be silent.
      const pending = Number.isFinite(report?.pending) && report.pending >= 0 ? Math.floor(report.pending) : 0;
      const succeeded = Number.isFinite(report?.succeeded) && report.succeeded >= 0 ? Math.floor(report.succeeded) : 0;
      const failed = Number.isFinite(report?.failed) && report.failed >= 0 ? Math.floor(report.failed) : 0;
      try {
        registry.setGauge("outbox_depth", pending, { adapter, state: "pending" });
      } catch {
        // setGauge only throws on a misconfigured registry (undeclared metric
        // or label drift) — surfacing that to the worker loop would be silent.
      }
      if (succeeded > 0) {
        try {
          registry.incrementCounter("outbox_processed_total", { outcome: "success" }, succeeded);
        } catch {
          // Same defensive swallow as setGauge.
        }
      }
      if (failed > 0) {
        try {
          registry.incrementCounter("outbox_processed_total", { outcome: "error" }, failed);
        } catch {
          // Same defensive swallow as setGauge.
        }
      }
    }
  };
}

// WATS-164 bridge: a TelemetrySink that forwards to the internal Prometheus
// MetricsRegistry so /metrics sees the same traffic as user sinks. OTel-style
// attribute keys are mapped back to the internal Prometheus label names.
class MetricsBridgeTelemetrySink implements TelemetrySink {
  readonly #metrics: MetricsRegistry;

  constructor(metrics: MetricsRegistry) {
    this.#metrics = metrics;
  }

  incrementCounter(name: OtelMetricName, value: number, attributes: TelemetryAttributes): void {
    if (name === "http_requests_total") {
      this.#metrics.incrementCounter(name, this.#httpLabels(attributes), value);
    } else if (name === "webhook_normalization_total") {
      this.#metrics.incrementCounter(name, this.#webhookLabels(attributes), value);
    } else if (name === "graph_operations_total") {
      this.#metrics.incrementCounter(name, this.#graphLabels(attributes), value);
    } else if (name === "send_outcomes_total") {
      this.#metrics.incrementCounter(name, this.#sendLabels(attributes), value);
    } else if (name === "persistence_operations_total") {
      this.#metrics.incrementCounter(name, this.#persistenceLabels(attributes), value);
    } else if (name === "outbox_processed_total") {
      this.#metrics.incrementCounter(name, this.#outboxLabels(attributes), value);
    }
  }

  recordHistogram(name: "http_request_duration_seconds", valueSeconds: number, attributes: TelemetryAttributes): void {
    if (name !== "http_request_duration_seconds") return;
    this.#metrics.observeHistogram(name, this.#httpHistogramLabels(attributes), valueSeconds);
  }

  #getString(attributes: TelemetryAttributes, key: string): string {
    const value = attributes[key];
    return typeof value === "string" ? value : String(value ?? "");
  }

  #httpLabels(attributes: TelemetryAttributes): Readonly<Record<string, string>> {
    return {
      route: this.#getString(attributes, OTEL_ATTR.httpRoute),
      method: this.#getString(attributes, OTEL_ATTR.httpMethod),
      status_class: this.#getString(attributes, OTEL_ATTR.httpStatusClass)
    };
  }

  #httpHistogramLabels(attributes: TelemetryAttributes): Readonly<Record<string, string>> {
    return {
      route: this.#getString(attributes, OTEL_ATTR.httpRoute),
      status_class: this.#getString(attributes, OTEL_ATTR.httpStatusClass)
    };
  }

  #webhookLabels(attributes: TelemetryAttributes): Readonly<Record<string, string>> {
    return {
      update_kind: this.#getString(attributes, OTEL_ATTR.webhookUpdateKind),
      outcome: this.#getString(attributes, OTEL_ATTR.operationOutcome)
    };
  }

  #graphLabels(attributes: TelemetryAttributes): Readonly<Record<string, string>> {
    return {
      endpoint_family: this.#getString(attributes, OTEL_ATTR.graphEndpointFamily),
      status_class: this.#getString(attributes, OTEL_ATTR.httpStatusClass),
      outcome: this.#getString(attributes, OTEL_ATTR.operationOutcome)
    };
  }

  #sendLabels(attributes: TelemetryAttributes): Readonly<Record<string, string>> {
    return {
      endpoint_family: this.#getString(attributes, OTEL_ATTR.graphEndpointFamily),
      outcome: this.#getString(attributes, OTEL_ATTR.operationOutcome)
    };
  }

  #persistenceLabels(attributes: TelemetryAttributes): Readonly<Record<string, string>> {
    return {
      adapter: this.#getString(attributes, OTEL_ATTR.persistenceAdapter),
      outcome: this.#getString(attributes, OTEL_ATTR.operationOutcome)
    };
  }

  #outboxLabels(attributes: TelemetryAttributes): Readonly<Record<string, string>> {
    return {
      outcome: this.#getString(attributes, OTEL_ATTR.operationOutcome)
    };
  }
}

// Fan out metric, span, and event calls to multiple sinks. A downstream sink
// that throws is isolated from the others: the exception is swallowed and
// logged to stderr so a user exporter cannot break a successful request.
class ComposedTelemetrySink implements TelemetrySink {
  readonly #sinks: ReadonlyArray<TelemetrySink>;

  constructor(...sinks: TelemetrySink[]) {
    this.#sinks = sinks;
  }

  incrementCounter(name: string, value: number, attributes: TelemetryAttributes): void {
    for (const sink of this.#sinks) {
      try {
        sink.incrementCounter(name, value, attributes);
      } catch (error) {
        this.#logSinkError("incrementCounter", error);
      }
    }
  }

  recordHistogram(name: string, valueSeconds: number, attributes: TelemetryAttributes): void {
    for (const sink of this.#sinks) {
      try {
        sink.recordHistogram(name, valueSeconds, attributes);
      } catch (error) {
        this.#logSinkError("recordHistogram", error);
      }
    }
  }

  recordSpan(name: string, start: Date, end: Date, attributes: TelemetryAttributes): void {
    for (const sink of this.#sinks) {
      try {
        if (typeof sink.recordSpan === "function") sink.recordSpan(name, start, end, attributes);
      } catch (error) {
        this.#logSinkError("recordSpan", error);
      }
    }
  }

  recordEvent(name: string, attributes: TelemetryAttributes, timestamp?: Date): void {
    for (const sink of this.#sinks) {
      try {
        if (typeof sink.recordEvent === "function") sink.recordEvent(name, attributes, timestamp);
      } catch (error) {
        this.#logSinkError("recordEvent", error);
      }
    }
  }

  #logSinkError(method: string, error: unknown): void {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "wats.telemetry.sink.error", method, errorName: name, errorMessage: message, at: new Date().toISOString() }));
  }
}

function recordHttpRequest(sink: TelemetrySink, route: string, method: string, status: number, durationSeconds: number): void {
  const statusClass = statusClassOf(status);
  sink.incrementCounter("http_requests_total", 1, httpTelemetryAttributes(route, method, status, statusClass));
  sink.recordHistogram("http_request_duration_seconds", durationSeconds, httpTelemetryAttributes(route, method, status, statusClass));
}

function recordWebhookNormalization(sink: TelemetrySink, updateKind: string, outcome: MetricOutcome): void {
  const clampedKind = clampToEnum(updateKind, METRIC_UPDATE_KINDS);
  sink.incrementCounter("webhook_normalization_total", 1, webhookTelemetryAttributes(clampedKind, outcome));
}

function recordGraphOperation(sink: TelemetrySink, endpointFamily: MetricEndpointFamily, status: number, outcome: MetricOutcome): void {
  sink.incrementCounter("graph_operations_total", 1, graphTelemetryAttributes(endpointFamily, status, statusClassOf(status), outcome));
}

function recordSendOutcome(sink: TelemetrySink, endpointFamily: MetricEndpointFamily, outcome: MetricOutcome): void {
  sink.incrementCounter("send_outcomes_total", 1, sendTelemetryAttributes(endpointFamily, outcome));
}

function recordPersistenceOperation(sink: TelemetrySink, adapter: string, outcome: MetricOutcome): void {
  // Clamp to the same backend allowlist /status uses (sanitizePersistenceHealth)
  // so a custom adapter's raw backend string never becomes an unbounded label.
  const clampedAdapter = clampToEnum(adapter.toLowerCase(), ["sqlite", "postgres"] as const);
  sink.incrementCounter("persistence_operations_total", 1, persistenceTelemetryAttributes(clampedAdapter, outcome));
}

// Renders the /status route-templating logic against an arbitrary matched
// path, for use as the http_requests_total / http_request_duration_seconds
// "route" label. Reuses the same "never a raw id" invariant as WATS-163: an
// unmatched path (one that fails the whole route cascade before reaching the
// 404 catch-all) reports "unmatched" instead of the raw pathname.
function templateRouteLabel(ctx: RuntimeConfig, path: string): string {
  if (path === "/healthz" || path === "/readyz" || path === OPENAPI_PATH || path === STATUS_PATH || path === METRICS_PATH || path === DEBUG_DIAGNOSTICS_PATH) return path;
  if (path === ctx.webhookPath) return ctx.webhookPath;
  if (path === ctx.textPath) return ctx.textPath;
  if (path === ctx.messagesPath) return ctx.messagesPath;
  if (path.startsWith(`${ctx.messagesPath}/`)) return `${ctx.messagesPath}/:id`;
  if (path.startsWith(`${ctx.conversationsPath}/`) && path.endsWith("/window")) return `${ctx.conversationsPath}/:phone/window`;
  if (ctx.enableGroupRoutes) {
    const match = matchGroupRoute(ctx, path);
    if (match !== null) {
      if (match.route === "groups") return ctx.groupsPath;
      if (match.route === "group") return `${ctx.groupsPath}/:groupId`;
      if (match.route === "groupInviteLink") return `${ctx.groupsPath}/:groupId/invite-link`;
      if (match.route === "groupParticipants") return `${ctx.groupsPath}/:groupId/participants`;
      return `${ctx.groupsPath}/:groupId/join-requests`;
    }
  }
  return "unmatched";
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

/**
 * Defensively read `result.messages[0].id` from a Graph send response. The
 * transport/mock result is `unknown`; this returns null on any shape miss so
 * projection can be skipped without affecting the send response.
 */
function extractGraphMessageId(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const messages = (result as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = messages[0];
  if (!isRecord(first)) return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Dependency-free caller-generated local row id. Prefers WebCrypto randomUUID
 * when available; falls back to a timestamp+random composite.
 */
function cryptoRandomId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  if (typeof uuid === "string" && uuid.length > 0) return uuid;
  return `wats-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  if (options.enableGroupRoutes !== undefined && typeof options.enableGroupRoutes !== "boolean") {
    throw new WatsServiceError("invalid_config", "OpenAPI enableGroupRoutes must be a boolean when provided.");
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

function assertNoRouteCollisions(webhookPath: string, apiPrefix: string, enableGroupRoutes = false): void {
  const textPath = `${apiPrefix}/messages/text`;
  const messagesPath = `${apiPrefix}/messages`;
  const groupsPath = `${apiPrefix}/groups`;
  const reservedStaticPaths = new Set(["/healthz", "/readyz", STATUS_PATH, METRICS_PATH, DEBUG_DIAGNOSTICS_PATH, OPENAPI_PATH]);
  const webhookCollidesWithGroups = enableGroupRoutes && (webhookPath === groupsPath || webhookPath.startsWith(`${groupsPath}/`));
  if (reservedStaticPaths.has(webhookPath) || webhookPath === textPath || webhookPath === messagesPath || webhookCollidesWithGroups) {
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
      "502": errorResponseSpec("Graph request failed (auth-class or uncategorized Meta error)."),
      "503": errorResponseSpec("Graph rate-limit failure; Retry-After echoed from Meta when supplied.")
    }
  };
}

function groupOperation(summary: string, schemaName?: string): Record<string, unknown> {
  return {
    tags: ["groups"],
    summary,
    security: [{ serviceBearerAuth: [] }],
    ...(schemaName === undefined ? {} : {
      requestBody: {
        required: true,
        ...jsonContentSchema(schemaRef(schemaName))
      }
    }),
    responses: {
      "200": okResponseSpec("Graph response passthrough.", "GraphResponsePassthrough"),
      "400": errorResponseSpec("Malformed JSON, unsupported body, or invalid route parameter."),
      "401": errorResponseSpec("Missing or invalid service bearer token."),
      "405": errorResponseSpec("Method not allowed."),
      "502": errorResponseSpec("Graph request failed (auth-class or uncategorized Meta error)."),
      "503": errorResponseSpec("Graph rate-limit failure; Retry-After echoed from Meta when supplied.")
    }
  };
}

function createOpenApiSchemas(enableGroupRoutes = false): Record<string, Record<string, unknown>> {
  const supportedMessageBodyOneOf = [
    schemaRef("GenericTextMessageBody"),
    schemaRef("MediaMessageBody"),
    schemaRef("LocationMessageBody"),
    schemaRef("ContactsMessageBody"),
    schemaRef("ReactionMessageBody"),
    ...(enableGroupRoutes ? [schemaRef("GroupPinMessageBody")] : []),
    schemaRef("BasicInteractiveMessageBody"),
    schemaRef("CommerceInteractiveMessageBody")
  ];
  const schemas: Record<string, Record<string, unknown>> = {
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
    StatusResponse: {
      type: "object",
      additionalProperties: false,
      required: ["service", "version", "uptimeSeconds", "graphApiVersion", "serviceMode", "routes", "featureFlags", "persistence"],
      properties: {
        service: { type: "string", const: SERVICE_NAME },
        version: { type: "string" },
        uptimeSeconds: { type: "integer", minimum: 0 },
        graphApiVersion: { type: "string" },
        serviceMode: { type: "string" },
        routes: { type: "array", items: { type: "string" } },
        featureFlags: {
          type: "object",
          additionalProperties: false,
          required: ["groupRoutes", "persistence"],
          properties: {
            groupRoutes: { type: "boolean" },
            persistence: { type: "boolean" }
          }
        },
        persistence: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["ok", "backend", "currentVersion", "redactedLocation"],
          properties: {
            ok: { type: "boolean" },
            backend: { type: "string" },
            currentVersion: { type: "integer" },
            redactedLocation: { type: "string" }
          }
        }
      }
    },
    DiagnosticsResponse: {
      type: "object",
      additionalProperties: false,
      required: ["service", "version", "graphApiVersion", "serviceMode", "runtime", "routes", "featureFlags", "persistence", "metricFamilies", "recentErrors", "configShape"],
      properties: {
        service: { type: "string", const: SERVICE_NAME },
        version: { type: "string" },
        graphApiVersion: { type: "string" },
        serviceMode: { type: "string" },
        runtime: { type: "string" },
        routes: { type: "array", items: { type: "string" } },
        featureFlags: {
          type: "object",
          additionalProperties: false,
          required: ["groupRoutes", "persistence"],
          properties: {
            groupRoutes: { type: "boolean" },
            persistence: { type: "boolean" }
          }
        },
        persistence: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "backend", "currentVersion", "redactedLocation"],
          properties: {
            ok: { type: "boolean" },
            backend: { type: "string" },
            currentVersion: { type: "integer" },
            redactedLocation: { type: "string" }
          }
        },
        metricFamilies: { type: "array", items: { type: "string" } },
        recentErrors: { type: "object", additionalProperties: { type: "integer", minimum: 1 } },
        configShape: {
          type: "object",
          additionalProperties: false,
          required: ["graph", "auth", "service", "webhook"],
          properties: {
            graph: {
              type: "object",
              additionalProperties: false,
              required: ["apiVersion"],
              properties: { apiVersion: { type: "string" } }
            },
            auth: {
              type: "object",
              additionalProperties: false,
              required: ["accessToken"],
              properties: { accessToken: { type: "string" } }
            },
            service: {
              type: "object",
              additionalProperties: false,
              required: ["host", "port", "apiPrefix"],
              properties: {
                host: { type: "string" },
                port: { type: "integer" },
                apiPrefix: { type: "string" }
              }
            },
            webhook: {
              type: "object",
              additionalProperties: false,
              required: ["path", "verifyToken", "appSecret", "maxBodyBytes"],
              properties: {
                path: { type: "string" },
                verifyToken: { type: "string" },
                appSecret: { type: "string" },
                maxBodyBytes: { type: "integer" }
              }
            }
          }
        }
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
    GroupPinMessageBody: {
      type: "object",
      additionalProperties: false,
      required: ["type", "to", "pinType", "messageId", "expirationDays"],
      properties: {
        type: { type: "string", const: "pin" },
        to: { type: "string", minLength: 1, description: "WhatsApp group id." },
        pinType: { type: "string", enum: ["pin", "unpin"] },
        messageId: { type: "string", minLength: 1 },
        expirationDays: { type: "integer", minimum: 1, maximum: 30 }
      }
    },
    CreateGroupBody: {
      type: "object",
      additionalProperties: false,
      required: ["subject"],
      properties: {
        subject: { type: "string", minLength: 1, maxLength: 128 },
        description: { type: "string", minLength: 1, maxLength: 2048 },
        joinApprovalMode: { type: "string", enum: ["auto_approve", "approval_required"] }
      }
    },
    UpdateGroupBody: {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string", minLength: 1, maxLength: 128 },
        description: { type: "string", minLength: 1, maxLength: 2048 },
        joinApprovalMode: { type: "string", enum: ["auto_approve", "approval_required"] }
      },
      anyOf: [{ required: ["subject"] }, { required: ["description"] }, { required: ["joinApprovalMode"] }]
    },
    RemoveGroupParticipantsBody: {
      type: "object",
      additionalProperties: false,
      required: ["waIds"],
      properties: { waIds: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1 } } }
    },
    ManageGroupJoinRequestsBody: {
      type: "object",
      additionalProperties: false,
      required: ["joinRequestIds"],
      properties: { joinRequestIds: { type: "array", minItems: 1, maxItems: 64, items: { type: "string", minLength: 1 } } }
    },
    SupportedMessageBody: {
      oneOf: supportedMessageBodyOneOf,
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
    },
    MessageRecord: {
      type: "object",
      additionalProperties: false,
      required: ["rowId", "waMessageId", "direction", "fromPhone", "toPhone", "type", "status", "graphMessageId", "createdAt", "updatedAt"],
      properties: {
        rowId: { type: "string", minLength: 1, description: "Caller-generated local row id." },
        waMessageId: { type: "string", minLength: 1, description: "WhatsApp message id (wamid.*) from the Graph response." },
        direction: { type: "string", enum: ["inbound", "outbound"] },
        fromPhone: { type: "string", nullable: true, description: "Sender phone or wa_id when known; null when absent." },
        toPhone: { type: "string", nullable: true, description: "Recipient phone or wa_id when known; null when absent." },
        type: { type: "string", description: "Graph message type (text, image, ...)." },
        status: { type: "string", description: "Last known status (sent, delivered, read, failed, ...)." },
        graphMessageId: { type: "string", nullable: true, description: "Same as waMessageId for outbound; null when absent." },
        createdAt: { type: "string", description: "ISO 8601 timestamp (ms precision)." },
        updatedAt: { type: "string", description: "ISO 8601 timestamp (ms precision)." }
      }
    },
    MessageListResponse: {
      type: "object",
      additionalProperties: false,
      required: ["items", "nextCursor"],
      properties: {
        items: { type: "array", items: schemaRef("MessageRecord") },
        nextCursor: { type: "string", nullable: true, description: "rowId of the last returned item when more rows may exist; null otherwise." }
      }
    },
    ConversationWindowState: {
      type: "object",
      additionalProperties: false,
      required: ["open", "lastInboundAt", "expiresAt", "remainingMs"],
      properties: {
        open: { type: "boolean", description: "True when the 24-hour customer-service window is open (a recent inbound message exists within windowMs)." },
        lastInboundAt: { type: "string", nullable: true, description: "ISO 8601 timestamp (ms precision) of the most recent inbound message from this phone; null when none." },
        expiresAt: { type: "string", nullable: true, description: "ISO 8601 timestamp (ms precision) when the window closes or closed (lastInboundAt + windowMs); null when no inbound message exists." },
        remainingMs: { type: "integer", minimum: 0, description: "Milliseconds remaining before the window closes; 0 when closed or unknown." }
      }
    },
    MessageStatusEvent: {
      type: "object",
      additionalProperties: false,
      required: ["id", "waMessageId", "status", "timestamp"],
      properties: {
        id: { type: "integer", description: "Autoincrement event id." },
        waMessageId: { type: "string", minLength: 1 },
        status: { type: "string" },
        timestamp: { type: "string", description: "ISO 8601 timestamp (ms precision)." }
      }
    }
  };
  if (!enableGroupRoutes) {
    delete schemas.GroupPinMessageBody;
    delete schemas.CreateGroupBody;
    delete schemas.UpdateGroupBody;
    delete schemas.RemoveGroupParticipantsBody;
    delete schemas.ManageGroupJoinRequestsBody;
  }
  return schemas;
}

export function createWatsServiceOpenApiDocument(
  profileInput: WatsProfileConfig,
  optionsInput?: WatsServiceOpenApiOptions
): WatsServiceOpenApiDocument {
  const profile = validateProfile(profileInput);
  const options = validateOpenApiOptions(optionsInput);
  const webhookPath = validateSafeAbsolutePath(profile.webhook.path, "profile.webhook.path");
  const apiPrefix = validateSafeAbsolutePath(profile.service.apiPrefix, "profile.service.apiPrefix");
  assertNoRouteCollisions(webhookPath, apiPrefix, options.enableGroupRoutes === true);
  const textPath = `${apiPrefix}/messages/text`;
  const messagesPath = `${apiPrefix}/messages`;
  const conversationsPath = `${apiPrefix}/conversations`;
  const groupsPath = `${apiPrefix}/groups`;
  const groupPath = `${groupsPath}/{groupId}`;
  const groupInvitePath = `${groupPath}/invite-link`;
  const groupParticipantsPath = `${groupPath}/participants`;
  const groupJoinRequestsPath = `${groupPath}/join-requests`;
  const includeGroupRoutes = options.enableGroupRoutes === true;
  const serverUrl = options.serverUrl === undefined
    ? defaultServerUrl(profile)
    : validateOpenApiServerUrl(options.serverUrl);

  const paths: Record<string, Record<string, unknown>> = {
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
    [STATUS_PATH]: {
      get: {
        tags: ["status"],
        summary: "Redacted operator status",
        description: "Returns a redacted operator status snapshot (version, uptime, Graph API version, service mode, templated route inventory, persistence health summary, feature flags). Requires the service bearer token. On a missing or mismatched token the service returns 404 (not 401) so the endpoint's existence is not leaked.",
        security: [{ serviceBearerAuth: [] }],
        responses: {
          "200": okResponseSpec("Redacted operator status snapshot.", "StatusResponse"),
          "404": errorResponseSpec("Route not found, or bearer token missing/invalid (existence hidden)."),
          "405": errorResponseSpec("Method not allowed.")
        }
      }
    },
    [METRICS_PATH]: {
      get: {
        tags: ["status"],
        summary: "Prometheus/OpenMetrics scrape endpoint",
        description: "Returns PII-safe counters and histograms in Prometheus text exposition format (version=0.0.4). Requires the service bearer token. On a missing or mismatched token the service returns 404 (not 401) so the endpoint's existence is not leaked, matching /status (WATS-163).",
        security: [{ serviceBearerAuth: [] }],
        responses: {
          "200": {
            description: "Prometheus text exposition format.",
            content: { "text/plain; version=0.0.4; charset=utf-8": { schema: { type: "string" } } }
          },
          "404": errorResponseSpec("Route not found, or bearer token missing/invalid (existence hidden)."),
          "405": errorResponseSpec("Method not allowed.")
        }
      }
    },
    [DEBUG_DIAGNOSTICS_PATH]: {
      get: {
        tags: ["status"],
        summary: "Redacted support diagnostics snapshot",
        description: "Returns a bounded, redacted JSON support snapshot (service metadata, templated route inventory, feature flags, persistence health summary, metric family names, recent error-class counts, config shape with env-secret refs). Requires the service bearer token. On a missing or mismatched token the service returns 404 (not 401) so the endpoint's existence is not leaked. This endpoint is intentionally not a pprof/heap endpoint: it returns structured runtime facts only and never emits raw logs, stack traces, env values, tokens, or message content.",
        security: [{ serviceBearerAuth: [] }],
        responses: {
          "200": okResponseSpec("Redacted support diagnostics snapshot.", "DiagnosticsResponse"),
          "404": errorResponseSpec("Route not found, or bearer token missing/invalid (existence hidden)."),
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
      post: messageOperation(
        includeGroupRoutes
          ? "Send a supported text, media, location, reaction, contacts, group pin, or interactive message body"
          : "Send a supported text, media, location, reaction, contacts, or interactive message body",
        "SupportedMessageBody"
      ),
      get: {
        tags: ["messages"],
        summary: "List projected outbound messages",
        security: [{ serviceBearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }, description: "Maximum number of items to return (1..100, default 50)." },
          { name: "cursor", in: "query", required: false, schema: { type: "string", minLength: 1 }, description: "Opaque cursor: the rowId of the last item from the previous page. Returns older rows." }
        ],
        responses: {
          "200": okResponseSpec("Newest-first projected message page.", "MessageListResponse"),
          "400": errorResponseSpec("Malformed limit or cursor query."),
          "401": errorResponseSpec("Missing or invalid service bearer token."),
          "405": errorResponseSpec("Method not allowed."),
          "503": errorResponseSpec("No persistence store configured (persistence_not_configured), or the configured store could not be reached (persistence_unavailable).")
        }
      }
    },
    [`${messagesPath}/{messageId}`]: {
      get: {
        tags: ["messages"],
        summary: "Get a single projected message",
        security: [{ serviceBearerAuth: [] }],
        parameters: [
          { name: "messageId", in: "path", required: true, schema: { type: "string", minLength: 1 }, description: "WhatsApp message id (wamid.*)." }
        ],
        responses: {
          "200": okResponseSpec("Projected message record.", "MessageRecord"),
          "400": errorResponseSpec("Malformed message id."),
          "401": errorResponseSpec("Missing or invalid service bearer token."),
          "404": errorResponseSpec("Message not found (record === null)."),
          "405": errorResponseSpec("Method not allowed."),
          "503": errorResponseSpec("No persistence store configured (persistence_not_configured), or the configured store could not be reached (persistence_unavailable).")
        }
      }
    },
    [`${conversationsPath}/{phone}/window`]: {
      get: {
        tags: ["conversations"],
        summary: "Get the 24-hour customer-service-window state for a phone number",
        description: "Returns the conversation-window state (open/closed, last inbound timestamp, expiry, remaining ms) computed from the injected persistence store via getConversationWindowState. Requires the service bearer token. A missing or mismatched token returns 401 unauthorized, matching the sibling /api/* operator routes (telemetry endpoints /metrics, /status, /debug/diagnostics keep the existence-hiding 404). Returns 503 persistence_not_configured when no persistence store is configured, or 503 persistence_unavailable when the configured store throws. The phone path param is validated strictly: an optional leading + followed by 1..15 digits.",
        security: [{ serviceBearerAuth: [] }],
        parameters: [
          { name: "phone", in: "path", required: true, schema: { type: "string", pattern: "^\\+?\\d{1,15}$", minLength: 1, maxLength: 16 }, description: "Customer phone number (E.164-ish: optional leading +, 1..15 digits)." }
        ],
        responses: {
          "200": okResponseSpec("Conversation window state.", "ConversationWindowState"),
          "400": errorResponseSpec("Malformed phone path param."),
          "401": errorResponseSpec("Missing or invalid service bearer token."),
          "404": errorResponseSpec("Route not found."),
          "405": errorResponseSpec("Method not allowed."),
          "503": errorResponseSpec("No persistence store configured (persistence_not_configured), or the configured store could not be reached (persistence_unavailable / conversation_window_unavailable).")
        }
      }
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
  };

  if (includeGroupRoutes) {
    paths[groupsPath] = {
      post: groupOperation("Create a WhatsApp group", "CreateGroupBody"),
      get: groupOperation("List WhatsApp groups for the configured business phone number")
    };
    paths[groupPath] = {
      get: groupOperation("Get WhatsApp group details"),
      post: groupOperation("Update WhatsApp group settings", "UpdateGroupBody"),
      delete: groupOperation("Delete a WhatsApp group")
    };
    paths[groupInvitePath] = {
      get: groupOperation("Get a WhatsApp group invite link"),
      post: groupOperation("Reset a WhatsApp group invite link")
    };
    paths[groupParticipantsPath] = {
      delete: groupOperation("Remove WhatsApp group participants", "RemoveGroupParticipantsBody")
    };
    paths[groupJoinRequestsPath] = {
      get: groupOperation("List WhatsApp group join requests"),
      post: groupOperation("Approve WhatsApp group join requests", "ManageGroupJoinRequestsBody"),
      delete: groupOperation("Reject WhatsApp group join requests", "ManageGroupJoinRequestsBody")
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? DEFAULT_OPENAPI_TITLE,
      version: options.version ?? DEFAULT_OPENAPI_VERSION,
      description: "Runtime-neutral OpenAPI description for the standalone WATS service routes currently implemented."
    },
    servers: [{ url: serverUrl }],
    paths,
    components: {
      securitySchemes: {
        serviceBearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "opaque"
        }
      },
      schemas: createOpenApiSchemas(includeGroupRoutes)
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
type ServiceGroupPinMessageKind = "pin";
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

interface ServiceGroupPinMessageInput {
  readonly type: ServiceGroupPinMessageKind;
  readonly to: string;
  readonly pinType: "pin" | "unpin";
  readonly messageId: string;
  readonly expirationDays: number;
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

function validateServiceGroupPinBody(body: unknown): ServiceGroupPinMessageInput | null {
  if (!isRecord(body)) return null;
  if (body.type !== "pin") return null;
  if (!hasOnlyKeys(body, ["type", "to", "pinType", "messageId", "expirationDays"])) return null;
  if (!isNonEmptyString(body.to) || !isNonEmptyString(body.messageId)) return null;
  if (body.pinType !== "pin" && body.pinType !== "unpin") return null;
  if (typeof body.expirationDays !== "number" || !Number.isInteger(body.expirationDays) || body.expirationDays < 1 || body.expirationDays > 30) return null;
  return {
    type: "pin",
    to: body.to,
    pinType: body.pinType,
    messageId: body.messageId,
    expirationDays: body.expirationDays
  };
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

function buildServiceGroupPinPayload(input: ServiceGroupPinMessageInput): GraphMessagesSendBody {
  return buildSendPinPayload(input) as GraphMessagesSendBody;
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

  let record: "recorded" | "duplicate";
  try {
    record = await ctx.persistence.recordWebhookEvent({
      eventKey: event.eventKey,
      eventHash: event.eventHash,
      receivedAt: new Date().toISOString()
    });
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
  } catch (error) {
    // Record the metric, then preserve the pre-instrumentation behavior
    // exactly: this call was never wrapped in a try/catch before, so a
    // thrown error propagated uncaught. Re-throw rather than failing open.
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
    throw error;
  }
  if (record === "duplicate") {
    // WATS-162: normalization already happened (the adapter parsed and
    // normalized every update into `dispatches`), but the update is not
    // re-dispatched. Record "deduped" per update so webhook_normalization_total
    // reflects that normalization occurred even though dispatch was skipped.
    for (const update of dispatches) {
      const kind = isRecord(update) && typeof update.kind === "string" ? update.kind : "unknown";
      recordWebhookNormalization(ctx.telemetrySink, kind, "deduped");
    }
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
    // WATS-175c: record an inbound projection for message-kind updates.
    // Isolated from dispatch — projection failures are swallowed inside
    // recordInboundProjection so they never break the ACK. Run after the
    // dispatch attempt so the projection reflects every normalized message
    // regardless of handler outcome.
    await recordInboundProjection(ctx, update);
  }
  return jsonResponse(200, { status: "ok", received: dispatches.length, dispatched, skipped: 0 });
}

function buildSupportedMessageBody(body: unknown, enableGroupRoutes = false): GraphMessagesSendBody | null {
  if (isRecord(body) && !enableGroupRoutes && (body.recipient_type === "group" || body.recipientType === "group" || body.type === "pin")) {
    return null;
  }
  const text = validateGenericTextMessageBody(body);
  if (text !== null) return text;
  const media = validateServiceMediaMessageBody(body);
  const locationReaction = media === null ? validateServiceLocationReactionMessageBody(body) : null;
  const contacts = media === null && locationReaction === null ? validateServiceContactsMessageBody(body) : null;
  const groupPin = media === null && locationReaction === null && contacts === null ? validateServiceGroupPinBody(body) : null;
  const interactive = media === null && locationReaction === null && contacts === null && groupPin === null ? validateServiceBasicInteractiveMessageBody(body) : null;
  const commerceInteractive = media === null && locationReaction === null && contacts === null && groupPin === null && interactive === null ? validateServiceCommerceInteractiveMessageBody(body) : null;
  if (media === null && locationReaction === null && contacts === null && groupPin === null && interactive === null && commerceInteractive === null) return null;
  try {
    if (media !== null) return buildServiceMediaMessagePayload(media);
    if (locationReaction !== null) return buildServiceLocationReactionPayload(locationReaction);
    if (contacts !== null) return buildServiceContactsPayload(contacts);
    if (groupPin !== null) return buildServiceGroupPinPayload(groupPin);
    if (interactive !== null) return buildServiceBasicInteractivePayload(interactive);
    return buildServiceCommerceInteractivePayload(commerceInteractive as ServiceCommerceInteractiveMessageInput);
  } catch (error) {
    if (error instanceof GraphRequestValidationError) return null;
    throw error;
  }
}

async function recordOutboundProjection(
  ctx: RuntimeConfig,
  result: unknown,
  toPhone: string | undefined,
  messageType: string
): Promise<void> {
  if (ctx.persistence === undefined) return;
  const waMessageId = extractGraphMessageId(result);
  if (waMessageId === null) return;
  const now = new Date().toISOString();
  const rowId = cryptoRandomId();
  try {
    await ctx.persistence.recordMessage({
      rowId,
      waMessageId,
      direction: "outbound",
      ...(toPhone !== undefined ? { toPhone } : {}),
      type: messageType,
      status: "sent",
      graphMessageId: waMessageId,
      createdAt: now,
      updatedAt: now
    });
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
  } catch {
    // Projection failure must not break the send response.
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
  }
  try {
    await ctx.persistence.appendMessageStatus({ waMessageId, status: "sent", timestamp: now });
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
  } catch {
    // Best-effort; projection failure must not break the send response.
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
  }
}

// WATS-175c: inbound message projection. Mirrors recordOutboundProjection but
// records the inbound half of a conversation. Called from the webhook
// dispatch loop only for `message`-kind normalized updates; status/account/
// other kinds are skipped. Persistence failure is isolated exactly like the
// outbound path: it records a persistence-operation error and returns — a
// projection failure must NEVER break the webhook ACK (the 200 is returned to
// Meta regardless).
async function recordInboundProjection(ctx: RuntimeConfig, update: unknown): Promise<void> {
  if (ctx.persistence === undefined) return;
  if (!isRecord(update)) return;
  const kind = typeof update.kind === "string" ? update.kind : null;
  if (kind !== "message") return;
  const message = (update as { message?: unknown }).message;
  if (!isRecord(message)) return;
  const waMessageId = typeof message.id === "string" ? message.id : null;
  if (waMessageId === null) return;
  const fromPhone = typeof message.from === "string" ? message.from : null;
  const messageType = typeof message.type === "string" ? message.type : null;
  if (messageType === null) return;
  const now = new Date().toISOString();
  const rowId = cryptoRandomId();
  try {
    await ctx.persistence.recordMessage({
      rowId,
      waMessageId,
      direction: "inbound",
      ...(fromPhone !== null ? { fromPhone } : {}),
      type: messageType,
      status: "received",
      createdAt: now,
      updatedAt: now
    });
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
  } catch {
    // Projection failure must not break the webhook ACK.
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
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
    let existing: Awaited<ReturnType<PersistenceStore["getServiceRequest"]>>;
    try {
      existing = await ctx.persistence.getServiceRequest({ idempotencyKey, requestHash });
      recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
    } catch (error) {
      recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
      throw error;
    }
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
    recordGraphOperation(ctx.telemetrySink, "messages", 200, "success");
    recordSendOutcome(ctx.telemetrySink, "messages", "success");
    if (idempotencyKey !== null && requestHash !== null && ctx.persistence !== undefined) {
      const responseJson = responseToJsonText(result);
      if (responseJson !== null) {
        // Note: a persistence failure here is caught by the outer catch below
        // and reported as a Graph-operation error too — a pre-existing
        // conflation in the original control flow, not introduced here.
        await ctx.persistence.recordServiceRequest({ idempotencyKey, requestHash, responseJson, createdAt: new Date().toISOString() });
        recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
      }
    }
    await recordOutboundProjection(ctx, result, input.to, "text");
    return jsonResponse(200, result);
  } catch (error) {
    recordGraphOperation(ctx.telemetrySink, "messages", graphErrorStatus(error), "error");
    recordSendOutcome(ctx.telemetrySink, "messages", "error");
    return graphFailureResponse(error, ctx.errorLedger);
  }
}

async function handleGenericMessage(ctx: RuntimeConfig, request: Request): Promise<Response> {
  const rawBody = await readRequestText(request);
  if (rawBody === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const parsed = parseJsonText(rawBody);
  if (parsed === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
  const body = buildSupportedMessageBody(parsed, ctx.enableGroupRoutes);
  if (body === null) return errorResponse(400, "malformed_body", "Message body is invalid or unsupported.");

  const idempotencyKey = safeIdempotencyKey(request);
  if (idempotencyKey === "invalid") return errorResponse(400, "invalid_idempotency_key", "Idempotency-Key is invalid.");
  const requestHash = idempotencyKey !== null && ctx.persistence !== undefined ? `sha256:${await sha256Hex(rawBody)}` : null;
  if (idempotencyKey !== null && requestHash !== null && ctx.persistence !== undefined) {
    let existing: Awaited<ReturnType<PersistenceStore["getServiceRequest"]>>;
    try {
      existing = await ctx.persistence.getServiceRequest({ idempotencyKey, requestHash });
      recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
    } catch (error) {
      recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
      throw error;
    }
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
    recordGraphOperation(ctx.telemetrySink, "messages", 200, "success");
    recordSendOutcome(ctx.telemetrySink, "messages", "success");
    if (idempotencyKey !== null && requestHash !== null && ctx.persistence !== undefined) {
      const responseJson = responseToJsonText(result);
      if (responseJson !== null) {
        // Note: a persistence failure here is caught by the outer catch below
        // and reported as a Graph-operation error too — a pre-existing
        // conflation in the original control flow, not introduced here.
        await ctx.persistence.recordServiceRequest({ idempotencyKey, requestHash, responseJson, createdAt: new Date().toISOString() });
        recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
      }
    }
    const genericTo = typeof (body as { to?: unknown }).to === "string" ? (body as { to: string }).to : undefined;
    const genericType = typeof (body as { type?: unknown }).type === "string" ? (body as { type: string }).type : "unknown";
    await recordOutboundProjection(ctx, result, genericTo, genericType);
    return jsonResponse(200, result);
  } catch (error) {
    recordGraphOperation(ctx.telemetrySink, "messages", graphErrorStatus(error), "error");
    recordSendOutcome(ctx.telemetrySink, "messages", "error");
    return graphFailureResponse(error, ctx.errorLedger);
  }
}

function readQueryString(url: URL, name: string, maxLength = 4096): string | undefined | "invalid" {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  if (!isNonEmptyString(value) || value.length > maxLength) return "invalid";
  return value;
}

function parseListLimit(url: URL): number | "invalid" {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return "invalid";
  return Math.min(100, Math.max(1, parsed));
}

async function handleListMessages(ctx: RuntimeConfig, request: Request, url: URL): Promise<Response> {
  if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return unauthorized();
  if (ctx.persistence === undefined) {
    return errorResponse(503, "persistence_not_configured", "Message projections require a persistence store.");
  }
  const limit = parseListLimit(url);
  if (limit === "invalid") return errorResponse(400, "malformed_query", "limit must be an integer from 1 to 100.");
  const cursorRaw = url.searchParams.get("cursor");
  let beforeRowId: string | undefined;
  if (cursorRaw !== null) {
    if (!isNonEmptyString(cursorRaw) || cursorRaw.length > 1024 || hasControlChars(cursorRaw)) {
      return errorResponse(400, "malformed_query", "cursor must be a safe non-empty string.");
    }
    beforeRowId = cursorRaw;
  }
  try {
    const result = await ctx.persistence.listMessages(
      beforeRowId === undefined ? { limit } : { limit, beforeRowId }
    );
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
    return jsonResponse(200, { items: result.items, nextCursor: result.nextCursor });
  } catch {
    // The store is configured but the call threw (DB outage, locked, etc.).
    // Surface 503 persistence_unavailable so an outage is not misreported as
    // "no store configured". 503 persistence_not_configured is reserved for
    // ctx.persistence === undefined (guarded above).
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
    return errorResponse(503, "persistence_unavailable", "Message projection store could not be reached.");
  }
}

async function handleGetMessage(ctx: RuntimeConfig, request: Request, path: string): Promise<Response> {
  if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return unauthorized();
  if (ctx.persistence === undefined) {
    return errorResponse(503, "persistence_not_configured", "Message projections require a persistence store.");
  }
  const segment = path.slice(ctx.messagesPath.length + 1);
  let waMessageId: string;
  try {
    waMessageId = decodeURIComponent(segment);
  } catch {
    return errorResponse(400, "malformed_path", "Message id segment is invalid.");
  }
  if (!isNonEmptyString(waMessageId) || waMessageId.length > 1024 || hasControlChars(waMessageId)) {
    return errorResponse(400, "malformed_path", "Message id must be a safe non-empty string.");
  }
  try {
    const record = await ctx.persistence.getMessage({ waMessageId });
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
    if (record === null) return errorResponse(404, "not_found", "Message not found.");
    return jsonResponse(200, record);
  } catch {
    // The store is configured but the call threw. Returning 404 here would
    // misreport a DB outage as a missing message. Reserve 404 not_found for
    // record === null (guarded above) and surface 503 persistence_unavailable
    // so operators can tell a store failure from an absent record.
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
    return errorResponse(503, "persistence_unavailable", "Message projection store could not be reached.");
  }
}

// WATS-175c: strict phone path-param validator. Reuses the same E.164-ish
// shape @wats/graph's assertValidRecipient enforces for outbound `to`
// recipients: an optional leading + followed by 1..15 digits. Bounded length
// keeps the route label low-cardinality and rejects path-traversal/CR-LF
// attempts in one shot.
const PHONE_PATH_RE = /^\+?\d{1,15}$/u;

// WATS-175c: GET /api/conversations/:phone/window. Returns the 24-hour
// customer-service-window state for a phone number, computed from the
// injected persistence store via getConversationWindowState. WATS-189:
// /api/* operator routes use the uniform 401 posture — a missing or
// mismatched bearer token returns 401 unauthorized, matching the sibling
// /api/messages routes. Telemetry endpoints (/metrics, /status,
// /debug/diagnostics) keep the existence-hiding 404 catch-all. Requires
// persistence (503 persistence_not_configured when absent, matching
// /api/messages).
async function handleConversationWindow(
  ctx: RuntimeConfig,
  request: Request,
  path: string
): Promise<Response> {
  if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return unauthorized();
  if (request.method.toUpperCase() !== "GET") return methodNotAllowed("GET");
  if (ctx.persistence === undefined) {
    return errorResponse(503, "persistence_not_configured", "Conversation window state requires a persistence store.");
  }
  const prefix = `${ctx.conversationsPath}/`;
  const suffix = "/window";
  if (!path.startsWith(prefix) || !path.endsWith(suffix) || path.length <= prefix.length + suffix.length) {
    return notFound();
  }
  const segment = path.slice(prefix.length, path.length - suffix.length);
  let phone: string;
  try {
    phone = decodeURIComponent(segment);
  } catch {
    return errorResponse(400, "malformed_path", "phone path segment is invalid.");
  }
  if (!PHONE_PATH_RE.test(phone)) {
    return errorResponse(400, "malformed_path", "phone must be digits with an optional leading +, 1..15 characters.");
  }
  // Meta's webhook payloads carry sender phones as bare digits (no +), and
  // recordInboundProjection stores message.from verbatim. Strip an optional
  // leading + before the store lookup so E.164-formatted queries
  // (/api/conversations/+15550001111/window) match the stored rows.
  const lookupPhone = phone.startsWith("+") ? phone.slice(1) : phone;
  try {
    const now = new Date().toISOString();
    const state: ConversationWindowState = await getConversationWindowState(ctx.persistence, { phone: lookupPhone, now });
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "success");
    return jsonResponse(200, state);
  } catch {
    recordPersistenceOperation(ctx.telemetrySink, ctx.persistence.backend, "error");
    return errorResponse(503, "conversation_window_unavailable", "Conversation window state could not be computed.");
  }
}

function matchGroupRoute(ctx: RuntimeConfig, path: string): ServiceRouteMatch | null {
  if (path === ctx.groupsPath) return { route: "groups" };
  if (!path.startsWith(`${ctx.groupsPath}/`)) return null;
  const rest = path.slice(ctx.groupsPath.length + 1);
  const parts = rest.split("/");
  if (parts.length === 0 || !isNonEmptyString(parts[0])) return null;
  let groupId: string;
  try {
    groupId = decodeURIComponent(parts[0]!);
  } catch {
    return null;
  }
  if (!isNonEmptyString(groupId) || groupId.includes("/") || groupId.includes("\\")) return null;
  if (parts.length === 1) return { route: "group", groupId };
  if (parts.length === 2 && parts[1] === "invite-link") return { route: "groupInviteLink", groupId };
  if (parts.length === 2 && parts[1] === "participants") return { route: "groupParticipants", groupId };
  if (parts.length === 2 && parts[1] === "join-requests") return { route: "groupJoinRequests", groupId };
  return null;
}

async function readGroupJsonBody(request: Request): Promise<unknown | "malformed"> {
  const rawBody = await readRequestText(request);
  if (rawBody === "malformed") return "malformed";
  return parseJsonText(rawBody);
}

async function handleGroupRoute(ctx: RuntimeConfig, request: Request, url: URL, match: ServiceRouteMatch): Promise<Response> {
  const method = request.method.toUpperCase();
  // WATS-162: every branch below performs exactly one outbound Graph call.
  // Wrapping each call site individually would be repetitive and error-prone
  // (9 call sites); instead this thin helper records graph_operations_total
  // around the await and rethrows on failure, so the existing outer catch
  // (GraphRequestValidationError special-case vs graphFailureResponse) is
  // completely unchanged.
  async function recordedGraphCall<T>(op: Promise<T>): Promise<T> {
    try {
      const result = await op;
      recordGraphOperation(ctx.telemetrySink, "groups", 200, "success");
      return result;
    } catch (error) {
      recordGraphOperation(ctx.telemetrySink, "groups", graphErrorStatus(error), "error");
      throw error;
    }
  }
  try {
    if (match.route === "groups") {
      if (method === "GET") {
        const params: Record<string, string> = { phoneNumberId: ctx.profile.whatsapp.phoneNumberId };
        for (const name of ["limit", "after", "before"] as const) {
          const value = readQueryString(url, name, name === "limit" ? 32 : 4096);
          if (value === "invalid") return errorResponse(400, "malformed_query", "Group query is invalid.");
          if (value !== undefined) params[name] = value;
        }
        return jsonResponse(200, await recordedGraphCall(listGroups(ctx.graphClient, params as never)));
      }
      if (method === "POST") {
        const body = await readGroupJsonBody(request);
        if (body === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
        return jsonResponse(200, await recordedGraphCall(createGroup(ctx.graphClient, { phoneNumberId: ctx.profile.whatsapp.phoneNumberId }, body as never)));
      }
      return methodNotAllowed("GET, POST");
    }

    const groupId = match.groupId;
    if (groupId === undefined) return errorResponse(404, "not_found", "Route not found.");
    if (match.route === "group") {
      if (method === "GET") {
        const fields = readQueryString(url, "fields");
        if (fields === "invalid") return errorResponse(400, "malformed_query", "Group query is invalid.");
        return jsonResponse(200, await recordedGraphCall(getGroup(ctx.graphClient, fields === undefined ? { groupId } : { groupId, fields })));
      }
      if (method === "POST") {
        const body = await readGroupJsonBody(request);
        if (body === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
        return jsonResponse(200, await recordedGraphCall(updateGroup(ctx.graphClient, { groupId }, body as never)));
      }
      if (method === "DELETE") return jsonResponse(200, await recordedGraphCall(deleteGroup(ctx.graphClient, { groupId })));
      return methodNotAllowed("GET, POST, DELETE");
    }

    if (match.route === "groupInviteLink") {
      if (method === "GET") return jsonResponse(200, await recordedGraphCall(getGroupInviteLink(ctx.graphClient, { groupId })));
      if (method === "POST") return jsonResponse(200, await recordedGraphCall(resetGroupInviteLink(ctx.graphClient, { groupId })));
      return methodNotAllowed("GET, POST");
    }

    if (match.route === "groupParticipants") {
      if (method !== "DELETE") return methodNotAllowed("DELETE");
      const body = await readGroupJsonBody(request);
      if (body === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
      return jsonResponse(200, await recordedGraphCall(removeGroupParticipants(ctx.graphClient, { groupId }, body as never)));
    }

    if (method === "GET") {
      const params: Record<string, string> = { groupId };
      for (const name of ["limit", "after"] as const) {
        const value = readQueryString(url, name, name === "limit" ? 32 : 4096);
        if (value === "invalid") return errorResponse(400, "malformed_query", "Group query is invalid.");
        if (value !== undefined) params[name] = value;
      }
      return jsonResponse(200, await recordedGraphCall(listGroupJoinRequests(ctx.graphClient, params as never)));
    }
    if (method === "POST" || method === "DELETE") {
      const body = await readGroupJsonBody(request);
      if (body === "malformed") return errorResponse(400, "malformed_json", "Request body must be valid JSON.");
      const fn = method === "POST" ? approveGroupJoinRequests : rejectGroupJoinRequests;
      return jsonResponse(200, await recordedGraphCall(fn(ctx.graphClient, { groupId }, body as never)));
    }
    return methodNotAllowed("GET, POST, DELETE");
  } catch (error) {
    if (error instanceof GraphRequestValidationError) return errorResponse(400, "malformed_body", "Group request body or route is invalid.");
    return graphFailureResponse(error, ctx.errorLedger);
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
  if (config.enableGroupRoutes !== undefined && typeof config.enableGroupRoutes !== "boolean") {
    throw new WatsServiceError("invalid_config", "enableGroupRoutes must be a boolean when provided.");
  }
  const enableGroupRoutes = config.enableGroupRoutes === true;
  assertNoRouteCollisions(webhookPath, apiPrefix, enableGroupRoutes);
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
  const metricsRegistry = validateMetricsRegistry(config.metricsRegistry) ?? createMetricsRegistry();
  const metricsBridge = new MetricsBridgeTelemetrySink(metricsRegistry);
  const userSink = config.telemetrySink;
  const telemetrySink: TelemetrySink = userSink !== undefined
    ? new ComposedTelemetrySink(metricsBridge, userSink)
    : metricsBridge;
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
            recordGraphOperation(telemetrySink, "messages", 200, "success");
            recordSendOutcome(telemetrySink, "messages", "success");
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
            recordGraphOperation(telemetrySink, "messages", graphErrorStatus(error), "error");
            recordSendOutcome(telemetrySink, "messages", "error");
            // Same ledger coverage as the message-route Graph failures: an
            // auto-reply send failure must be visible in /debug/diagnostics
            // recentErrors, not only in the stdout line below. (The closure
            // runs at webhook-dispatch time, after errorLedger is created.)
            errorLedger.record(error);
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
  const errorLedger = createErrorLedger();

  // WATS-162: webhook_normalization_total wraps the single choke point both
  // webhook-handling paths converge on. handleWebhook's persistence-staged
  // path calls ctx.whatsapp.dispatch() explicitly in its own loop; the
  // no-persistence path lets WebhookAdapter call whatsapp.dispatch()
  // internally. Wrapping here (once, before either path is constructed)
  // guarantees exactly one metric per dispatched update regardless of path,
  // without either handler needing to know about metrics.
  const instrumentedWhatsapp: WebhookFacadeLike = {
    dispatch: async (update: unknown) => {
      const kind = isRecord(update) && typeof update.kind === "string" ? update.kind : "unknown";
      try {
        const result = await whatsapp.dispatch(update);
        // The real WhatsApp facade's dispatch() always resolves (handler
        // throws are caught internally into a DispatchReport), so a thrown
        // exception alone would rarely fire for the default facade. Inspect
        // the report's `errors` array when present for a more accurate
        // success/error signal; fall back to "success" on resolve otherwise
        // (matching handleWebhook's own existing try/catch boundary below).
        const errors = isRecord(result) ? (result as { errors?: unknown }).errors : undefined;
        const outcome: MetricOutcome = Array.isArray(errors) && errors.length > 0 ? "error" : "success";
        if (outcome === "error") {
          // Record the first representative handler error so the ledger
          // reflects webhook-side failures, not only thrown exceptions.
          const firstError = Array.isArray(errors) ? errors[0] : undefined;
          errorLedger.record(firstError ?? new Error("webhook_handler_failure"));
        }
        recordWebhookNormalization(telemetrySink, kind, outcome);
        return result;
      } catch (error) {
        recordWebhookNormalization(telemetrySink, kind, "error");
        errorLedger.record(error);
        throw error;
      }
    }
  };
  const webhookAdapter = createWebhookAdapter({
    verifyToken: secrets.webhookVerifyToken,
    appSecret: secrets.webhookAppSecret,
    whatsapp: instrumentedWhatsapp,
    maxBodyBytes: profile.webhook.maxBodyBytes,
    ...(cryptoProvider !== undefined ? { cryptoProvider } : {})
  });

  return {
    profile,
    secrets,
    graphClient,
    whatsapp: instrumentedWhatsapp,
    ...(cryptoProvider !== undefined ? { cryptoProvider } : {}),
    ...(persistence !== undefined ? { persistence } : {}),
    webhookHandler: createFetchWebhookHandler(webhookAdapter),
    webhookPath,
    apiPrefix,
    textPath: `${apiPrefix}/messages/text`,
    messagesPath: `${apiPrefix}/messages`,
    conversationsPath: `${apiPrefix}/conversations`,
    enableGroupRoutes,
    groupsPath: `${apiPrefix}/groups`,
    metrics: metricsRegistry,
    telemetrySink,
    errorLedger
  };
}

export function createWatsServiceApp(config: WatsServiceConfig): WatsServiceApp {
  const ctx = makeRuntimeConfig(config);

  async function dispatchRoute(request: Request, url: URL, method: string, path: string): Promise<Response> {
    if (path === "/healthz") {
      if (method !== "GET") return methodNotAllowed("GET");
      return jsonResponse(200, { ok: true, service: SERVICE_NAME });
    }

    if (path === "/readyz") {
      if (method !== "GET") return methodNotAllowed("GET");
      return jsonResponse(200, { ok: true, service: SERVICE_NAME });
    }

    if (path === STATUS_PATH) {
      // Telemetry endpoints fail closed to the catch-all 404 on missing or
      // mismatched auth (and for any method) so their existence is not
      // leaked to anonymous callers — per the WATS-161 taxonomy. Auth is
      // checked before method so an unauthenticated POST is a 404, not a 405.
      if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return notFound();
      if (method !== "GET") return methodNotAllowed("GET");
      return jsonResponse(200, await buildStatusPayload(ctx));
    }

    if (path === METRICS_PATH) {
      // Same existence-hiding posture as /status (WATS-163): 404 on
      // missing/mismatched auth and on any non-GET method, checked before
      // the method branch.
      if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return notFound();
      if (method !== "GET") return methodNotAllowed("GET");
      return new Response(ctx.metrics.render(), {
        status: 200,
        headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" }
      });
    }

    if (path === DEBUG_DIAGNOSTICS_PATH) {
      // WATS-165: diagnostics shares the telemetry-endpoint existence-hiding
      // posture: 404 on missing/mismatched auth, 405 on non-GET after auth.
      if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return notFound();
      if (method !== "GET") return methodNotAllowed("GET");
      return jsonResponse(200, await buildDiagnosticsPayload(ctx));
    }

    if (path === OPENAPI_PATH) {
      if (method !== "GET") return methodNotAllowed("GET");
      return jsonResponse(200, createWatsServiceOpenApiDocument(ctx.profile, { serverUrl: url.origin, enableGroupRoutes: ctx.enableGroupRoutes }));
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
      if (method === "POST") {
        if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return unauthorized();
        return handleGenericMessage(ctx, request);
      }
      if (method === "GET") {
        return handleListMessages(ctx, request, url);
      }
      return methodNotAllowed("GET, POST");
    }

    if (ctx.enableGroupRoutes) {
      const groupMatch = matchGroupRoute(ctx, path);
      if (groupMatch !== null) {
        if (!isAuthorized(request, ctx.secrets.serviceBearerToken)) return unauthorized();
        return handleGroupRoute(ctx, request, url, groupMatch);
      }
    }

    if (path.startsWith(`${ctx.messagesPath}/`)) {
      if (method !== "GET") return methodNotAllowed("GET");
      return handleGetMessage(ctx, request, path);
    }

    // WATS-175c: GET /api/conversations/:phone/window. Auth is checked
    // inside the handler (existence-hiding 404, before method), mirroring
    // /metrics rather than the sibling /api/messages routes. Matched by
    // prefix + /window suffix so the handler can extract and validate the
    // phone segment.
    if (path.startsWith(`${ctx.conversationsPath}/`) && path.endsWith("/window")) {
      return handleConversationWindow(ctx, request, path);
    }

    return notFound();
  }

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

      // WATS-162: http_requests_total / http_request_duration_seconds wrap
      // every dispatched request. Timed and recorded here — the single
      // choke point all requests pass through — regardless of which route
      // (or the catch-all) produced the response, so route dispatch code
      // itself never needs to know about metrics.
      const startedAtMs = Date.now();
      const response = await dispatchRoute(request, url, method, path);
      const durationSeconds = Math.max(0, Date.now() - startedAtMs) / 1000;
      recordHttpRequest(ctx.telemetrySink, templateRouteLabel(ctx, path), method, response.status, durationSeconds);
      return response;
    }
  };
}

// WATS-164: telemetry sink seam exports for OpenTelemetry-compatible adapters.
export { NOOP_TELEMETRY_SINK, OTEL_ATTR, CapturingTelemetrySink } from "./telemetry.js";
export type { TelemetrySink, TelemetryAttributes, OtelMetricName } from "./telemetry.js";
export {
  httpTelemetryAttributes,
  graphTelemetryAttributes,
  sendTelemetryAttributes,
  persistenceTelemetryAttributes,
  webhookTelemetryAttributes
} from "./telemetry.js";

