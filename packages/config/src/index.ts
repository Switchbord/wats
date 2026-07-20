import { isRecord, containsUnsafePathSegment } from "@wats/internal-utils";

export const WATS_CONFIG_VERSION = 1 as const;
export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1_048_576 as const;
export const MAX_WEBHOOK_MAX_BODY_BYTES = 10_485_760 as const;
export const MIN_SERVICE_PORT = 1 as const;
export const MAX_SERVICE_PORT = 65_535 as const;
export const REDACTED_ENV_NAME = "[REDACTED]" as const;

export type ConfigErrorCode =
  | "invalid_config"
  | "invalid_source"
  | "parse_error"
  | "unsupported_format"
  | "file_read_error"
  | "invalid_version"
  | "missing_default_profile"
  | "invalid_profiles"
  | "invalid_profile"
  | "invalid_graph"
  | "invalid_api_version"
  | "invalid_base_url"
  | "invalid_whatsapp"
  | "invalid_env_ref"
  | "invalid_webhook"
  | "invalid_webhook_path"
  | "invalid_max_body_bytes"
  | "invalid_service"
  | "invalid_service_host"
  | "invalid_service_port"
  | "invalid_service_api_prefix";

export interface ConfigIssue {
  readonly code: ConfigErrorCode;
  readonly path: string;
  readonly message: string;
}

export interface EnvSecretRef {
  readonly env: string;
}

export interface GraphConfig {
  readonly apiVersion: string;
  readonly baseUrl: string;
}

export interface WhatsAppConfig {
  readonly wabaId: string;
  readonly phoneNumberId: string;
}

export interface AuthConfig {
  readonly accessToken: EnvSecretRef;
}

export interface WebhookConfig {
  readonly path: string;
  readonly verifyToken: EnvSecretRef;
  readonly appSecret: EnvSecretRef;
  readonly maxBodyBytes: number;
}

export interface ServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly apiPrefix: string;
  readonly bearerToken: EnvSecretRef;
}

export interface WatsProfileConfig {
  readonly graph: GraphConfig;
  readonly whatsapp: WhatsAppConfig;
  readonly auth: AuthConfig;
  readonly webhook: WebhookConfig;
  readonly service: ServiceConfig;
}

export interface WatsConfig {
  readonly version: typeof WATS_CONFIG_VERSION;
  readonly defaultProfile: string;
  readonly profiles: Readonly<Record<string, WatsProfileConfig>>;
}

export interface ParseConfigOptions {
  readonly format?: "json" | "yaml";
}

export interface LoadConfigOptions extends ParseConfigOptions {}

export class ConfigValidationError extends Error {
  readonly name = "ConfigValidationError";
  readonly code: ConfigErrorCode;
  readonly path: string;
  readonly issues: readonly ConfigIssue[];

  constructor(code: ConfigErrorCode, path: string, message: string, issues?: readonly ConfigIssue[]) {
    super(message);
    this.code = code;
    this.path = path;
    this.issues = Object.freeze(
      (issues ?? [{ code, path, message }]).map((issue) => Object.freeze({ ...issue }))
    );
  }
}

function fail(code: ConfigErrorCode, path: string, message: string): never {
  throw new ConfigValidationError(code, path, message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertNonEmptyString(
  value: unknown,
  code: ConfigErrorCode,
  path: string,
  label: string
): string {
  if (!isNonEmptyString(value)) {
    fail(code, path, `${label} must be a non-empty string`);
  }
  if (/[\r\n\0]/u.test(value)) {
    fail(code, path, `${label} must not contain CR, LF, or NUL`);
  }
  return value;
}

function assertRecord(value: unknown, code: ConfigErrorCode, path: string, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(code, path, `${label} must be an object`);
  }
  return value;
}

function validateEnvRef(value: unknown, path: string): EnvSecretRef {
  const record = assertRecord(value, "invalid_env_ref", path, `${path} secret reference`);
  const env = assertNonEmptyString(record.env, "invalid_env_ref", `${path}.env`, "secret env name");
  return deepFreeze({ env });
}

function validateApiVersion(value: unknown, path: string): string {
  const apiVersion = assertNonEmptyString(value, "invalid_api_version", path, "graph.apiVersion");
  if (!/^v\d+\.\d+$/u.test(apiVersion)) {
    fail("invalid_api_version", path, "graph.apiVersion must match vNN.N");
  }
  return apiVersion;
}

function validateBaseUrl(value: unknown, path: string): string {
  const raw = assertNonEmptyString(value, "invalid_base_url", path, "graph.baseUrl");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("invalid_base_url", path, "graph.baseUrl must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail("invalid_base_url", path, "graph.baseUrl must use http or https");
  }
  if (/[\r\n\0]/u.test(raw)) {
    fail("invalid_base_url", path, "graph.baseUrl must not contain CR, LF, or NUL");
  }
  return raw;
}

function validateAbsolutePath(value: unknown, code: ConfigErrorCode, path: string, label: string): string {
  const raw = assertNonEmptyString(value, code, path, label);
  if (!raw.startsWith("/") || raw === "/" || containsUnsafePathSegment(raw)) {
    fail(code, path, `${label} must be an absolute safe path with at least one segment`);
  }
  return raw;
}

function validateMaxBodyBytes(value: unknown, path: string): number {
  const maxBodyBytes = value ?? DEFAULT_WEBHOOK_MAX_BODY_BYTES;
  if (
    typeof maxBodyBytes !== "number" ||
    !Number.isInteger(maxBodyBytes) ||
    !Number.isFinite(maxBodyBytes) ||
    maxBodyBytes < 1 ||
    maxBodyBytes > MAX_WEBHOOK_MAX_BODY_BYTES
  ) {
    fail(
      "invalid_max_body_bytes",
      path,
      `webhook.maxBodyBytes must be an integer from 1 to ${MAX_WEBHOOK_MAX_BODY_BYTES}`
    );
  }
  return maxBodyBytes;
}

function validatePort(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value < MIN_SERVICE_PORT ||
    value > MAX_SERVICE_PORT
  ) {
    fail("invalid_service_port", path, "service.port must be an integer from 1 to 65535");
  }
  return value;
}

function validateGraph(value: unknown, path: string): GraphConfig {
  const graph = assertRecord(value, "invalid_graph", path, "profile.graph");
  return deepFreeze({
    apiVersion: validateApiVersion(graph.apiVersion, `${path}.apiVersion`),
    baseUrl: validateBaseUrl(graph.baseUrl, `${path}.baseUrl`)
  });
}

function validateWhatsapp(value: unknown, path: string): WhatsAppConfig {
  const whatsapp = assertRecord(value, "invalid_whatsapp", path, "profile.whatsapp");
  return deepFreeze({
    wabaId: assertNonEmptyString(whatsapp.wabaId, "invalid_whatsapp", `${path}.wabaId`, "whatsapp.wabaId"),
    phoneNumberId: assertNonEmptyString(
      whatsapp.phoneNumberId,
      "invalid_whatsapp",
      `${path}.phoneNumberId`,
      "whatsapp.phoneNumberId"
    )
  });
}

function validateAuth(value: unknown, path: string): AuthConfig {
  const auth = assertRecord(value, "invalid_env_ref", path, "profile.auth");
  return deepFreeze({
    accessToken: validateEnvRef(auth.accessToken, `${path}.accessToken`)
  });
}

function validateWebhook(value: unknown, path: string): WebhookConfig {
  const webhook = assertRecord(value, "invalid_webhook", path, "profile.webhook");
  return deepFreeze({
    path: validateAbsolutePath(webhook.path, "invalid_webhook_path", `${path}.path`, "webhook.path"),
    verifyToken: validateEnvRef(webhook.verifyToken, `${path}.verifyToken`),
    appSecret: validateEnvRef(webhook.appSecret, `${path}.appSecret`),
    maxBodyBytes: validateMaxBodyBytes(webhook.maxBodyBytes, `${path}.maxBodyBytes`)
  });
}

function validateService(value: unknown, path: string): ServiceConfig {
  const service = assertRecord(value, "invalid_service", path, "profile.service");
  return deepFreeze({
    host: assertNonEmptyString(service.host, "invalid_service_host", `${path}.host`, "service.host"),
    port: validatePort(service.port, `${path}.port`),
    apiPrefix: validateAbsolutePath(
      service.apiPrefix,
      "invalid_service_api_prefix",
      `${path}.apiPrefix`,
      "service.apiPrefix"
    ),
    bearerToken: validateEnvRef(service.bearerToken, `${path}.bearerToken`)
  });
}

function validateProfile(value: unknown, path: string): WatsProfileConfig {
  const profile = assertRecord(value, "invalid_profile", path, "profile");
  return deepFreeze({
    graph: validateGraph(profile.graph, `${path}.graph`),
    whatsapp: validateWhatsapp(profile.whatsapp, `${path}.whatsapp`),
    auth: validateAuth(profile.auth, `${path}.auth`),
    webhook: validateWebhook(profile.webhook, `${path}.webhook`),
    service: validateService(profile.service, `${path}.service`)
  });
}

export function validateConfig(value: unknown): WatsConfig {
  const root = assertRecord(value, "invalid_config", "$", "config");

  if (root.version !== WATS_CONFIG_VERSION) {
    fail("invalid_version", "$.version", "config.version must be 1");
  }

  const defaultProfile = assertNonEmptyString(
    root.defaultProfile,
    "missing_default_profile",
    "$.defaultProfile",
    "defaultProfile"
  );
  const profilesRecord = assertRecord(root.profiles, "invalid_profiles", "$.profiles", "profiles");

  if (!(defaultProfile in profilesRecord)) {
    fail("missing_default_profile", `$.profiles.${defaultProfile}`, "defaultProfile must reference an existing profile");
  }

  const profiles: Record<string, WatsProfileConfig> = {};
  for (const [profileName, profileValue] of Object.entries(profilesRecord)) {
    if (!isNonEmptyString(profileName)) {
      fail("invalid_profiles", "$.profiles", "profile names must be non-empty strings");
    }
    profiles[profileName] = validateProfile(profileValue, `$.profiles.${profileName}`);
  }

  return deepFreeze({
    version: WATS_CONFIG_VERSION,
    defaultProfile,
    profiles: deepFreeze(profiles)
  });
}

export function parseConfig(source: unknown, options: ParseConfigOptions = {}): WatsConfig {
  if (typeof source !== "string" || source.trim().length === 0) {
    fail("invalid_source", "$", "config source must be a non-empty string");
  }

  const format = options.format ?? inferFormatFromSource(source);
  let parsed: unknown;
  try {
    if (format === "json") {
      parsed = JSON.parse(source) as unknown;
    } else if (format === "yaml") {
      parsed = parseYamlObject(source);
    } else {
      fail("unsupported_format", "$", "config format must be json or yaml");
    }
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }
    fail("parse_error", "$", "config source could not be parsed");
  }

  return validateConfig(parsed);
}

export async function loadConfig(filePath: unknown, options: LoadConfigOptions = {}): Promise<WatsConfig> {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    fail("invalid_source", "$", "config file path must be a non-empty string");
  }

  const format = options.format ?? inferFormatFromPath(filePath);
  let source: string;
  try {
    const bunLike = (globalThis as { Bun?: { file(path: string): { text(): Promise<string> } } }).Bun;
    if (bunLike !== undefined) {
      source = await bunLike.file(filePath).text();
    } else {
      const nodeFsPromisesSpecifier = "node:fs/promises";
      const fs = (await import(
        /* @vite-ignore */ nodeFsPromisesSpecifier
      )) as { readFile(path: string, encoding: "utf8"): Promise<string> };
      source = await fs.readFile(filePath, "utf8");
    }
  } catch {
    fail("file_read_error", "$", `config file could not be read: ${filePath}`);
  }
  return parseConfig(source, { format });
}

export function redactConfig(value: unknown): WatsConfig {
  const config = validateConfig(value);
  const profiles: Record<string, WatsProfileConfig> = {};
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    profiles[profileName] = deepFreeze({
      graph: deepFreeze({ ...profile.graph }),
      whatsapp: deepFreeze({ ...profile.whatsapp }),
      auth: deepFreeze({ accessToken: redactedEnvRef() }),
      webhook: deepFreeze({
        path: profile.webhook.path,
        verifyToken: redactedEnvRef(),
        appSecret: redactedEnvRef(),
        maxBodyBytes: profile.webhook.maxBodyBytes
      }),
      service: deepFreeze({
        host: profile.service.host,
        port: profile.service.port,
        apiPrefix: profile.service.apiPrefix,
        bearerToken: redactedEnvRef()
      })
    });
  }
  return deepFreeze({
    version: config.version,
    defaultProfile: config.defaultProfile,
    profiles: deepFreeze(profiles)
  });
}

function redactedEnvRef(): EnvSecretRef {
  return deepFreeze({ env: REDACTED_ENV_NAME });
}

function inferFormatFromPath(filePath: string): "json" | "yaml" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }
  fail("unsupported_format", "$", "config file extension must be .json, .yaml, or .yml");
}

function inferFormatFromSource(source: string): "json" | "yaml" {
  const trimmed = source.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? "json" : "yaml";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

interface StackFrame {
  indent: number;
  object: Record<string, unknown>;
}

function parseYamlObject(source: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: StackFrame[] = [{ indent: -1, object: root }];
  const pendingNested = new Set<Record<string, unknown>>();
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const rawLine = lines[lineNumber];
    if (rawLine.trim().length === 0 || rawLine.trimStart().startsWith("#")) {
      continue;
    }
    if (rawLine.includes("\t")) {
      throw new Error(`YAML tabs are not supported at line ${lineNumber + 1}`);
    }
    const indent = rawLine.match(/^ */u)?.[0].length ?? 0;
    const trimmed = rawLine.trim();
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid YAML mapping at line ${lineNumber + 1}`);
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      const popped = stack.pop() as StackFrame;
      if (pendingNested.has(popped.object) && Object.keys(popped.object).length === 0) {
        throw new Error(`Empty YAML object near line ${lineNumber + 1}`);
      }
      pendingNested.delete(popped.object);
    }

    const parentFrame = stack[stack.length - 1];
    if (indent <= parentFrame.indent) {
      throw new Error(`Invalid YAML indentation at line ${lineNumber + 1}`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (key.length === 0) {
      throw new Error(`Invalid YAML key at line ${lineNumber + 1}`);
    }
    if (Object.prototype.hasOwnProperty.call(parentFrame.object, key)) {
      throw new Error(`Duplicate YAML key at line ${lineNumber + 1}`);
    }

    const rest = stripYamlComment(trimmed.slice(separatorIndex + 1).trim());
    if (rest.length === 0) {
      const nested: Record<string, unknown> = {};
      parentFrame.object[key] = nested;
      pendingNested.add(nested);
      stack.push({ indent, object: nested });
      continue;
    }
    parentFrame.object[key] = parseYamlScalar(rest);
  }

  while (stack.length > 1) {
    const popped = stack.pop() as StackFrame;
    if (pendingNested.has(popped.object) && Object.keys(popped.object).length === 0) {
      throw new Error("Empty YAML object");
    }
  }

  return root;
}

function stripYamlComment(value: string): string {
  if (value.startsWith('"') || value.startsWith("'")) {
    return value;
  }
  const hashIndex = value.indexOf(" #");
  return hashIndex === -1 ? value : value.slice(0, hashIndex).trimEnd();
}

function parseYamlScalar(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null" || value === "~") {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }
  if (value.startsWith("[") || value.startsWith("{") || value.includes(": ")) {
    throw new Error("Unsupported YAML scalar");
  }
  return value;
}
