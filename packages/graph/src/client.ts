import {
  createGraphApiError,
  GraphNetworkError,
  GraphRequestValidationError,
  GraphSerializationError,
  isGraphApiErrorPayload,
  isGraphErrorEnvelope,
  type GraphApiErrorPayload
} from "./errors";
import { GraphMessagesEndpoint } from "./endpoints/messages";
import { createFetchTransport } from "./createFetchTransport";
import type {
  Transport,
  TransportHttpMethod,
  TransportRequest,
  TransportResponse
} from "./transport";

export const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com/";

export interface GraphClientConfig {
  accessToken: string;
  apiVersion: string;
  baseUrl?: string;
  transport?: Transport;
}

export type GraphQueryValue = string | number | boolean | null | undefined;

export type GraphQueryParams = Record<string, GraphQueryValue>;

export interface GraphRequestOptions {
  method: string;
  path: string;
  query?: GraphQueryParams;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface GraphRawRequestOptions {
  method: string;
  url: string;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

// --- validation ---------------------------------------------------------

const ACCESS_TOKEN_MAX_LEN = 4096;
const API_VERSION_REGEXP = /^v\d+(?:\.\d+)?$/;

function hasForbiddenControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function validateAccessToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new GraphRequestValidationError(
      "Invalid GraphClient config: accessToken must be a non-empty string."
    );
  }
  if (value.length === 0) {
    throw new GraphRequestValidationError(
      "Invalid GraphClient config: accessToken must be a non-empty string."
    );
  }
  if (value.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid GraphClient config: accessToken must not be whitespace-only."
    );
  }
  if (value.length > ACCESS_TOKEN_MAX_LEN) {
    throw new GraphRequestValidationError(
      `Invalid GraphClient config: accessToken exceeds ${ACCESS_TOKEN_MAX_LEN}-character bound.`
    );
  }
  if (hasForbiddenControlChar(value)) {
    throw new GraphRequestValidationError(
      "Invalid GraphClient config: accessToken must not contain control characters (CR/LF/NUL/etc.)."
    );
  }
  return value;
}

function validateApiVersion(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GraphRequestValidationError(
      "Invalid GraphClient config: apiVersion must be a non-empty string matching /^v\\d+(\\.\\d+)?$/."
    );
  }
  if (!API_VERSION_REGEXP.test(value)) {
    throw new GraphRequestValidationError(
      `Invalid GraphClient config: apiVersion ${JSON.stringify(value)} does not match /^v\\d+(\\.\\d+)?$/.`
    );
  }
  return value;
}

function validateBaseUrl(value: unknown): URL {
  if (value === undefined) {
    return new URL(DEFAULT_GRAPH_BASE_URL);
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new GraphRequestValidationError(
      "Invalid GraphClient config: baseUrl must be a non-empty string URL."
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new GraphRequestValidationError(
      `Invalid GraphClient config: baseUrl ${JSON.stringify(value)} is not a valid URL.`,
      error
    );
  }
  // F-4 remediation: reject any non-http(s) scheme. Without this guard,
  // `javascript:`, `file:`, `data:`, `ftp:`, `about:`, `blob:`, etc. all
  // parse successfully and become arbitrary-URL emitters via fetch.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GraphRequestValidationError(
      `Invalid GraphClient config: baseUrl protocol must be http: or https: (got ${JSON.stringify(url.protocol)}).`
    );
  }
  return url;
}

// --- path sanitization --------------------------------------------------

const MAX_GRAPH_PATH_DECODE_ROUNDS = 5;

function assertSafeGraphPathSegment(segment: string): void {
  if (segment === "." || segment === "..") {
    throw new GraphRequestValidationError(
      "Invalid Graph request path. Dot-segments are not allowed."
    );
  }
  if (segment.includes("/") || segment.includes("\\")) {
    throw new GraphRequestValidationError(
      "Invalid Graph request path. Path traversal patterns are not allowed."
    );
  }
  if (segment.includes("?") || segment.includes("#")) {
    throw new GraphRequestValidationError(
      "Invalid Graph request path. Query strings and fragments are not allowed in path."
    );
  }
  // F-4 WATS-8 L1: reject ASCII control chars (U+0000..U+001F, U+007F).
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new GraphRequestValidationError(
        "Invalid Graph request path. Control characters are not allowed in path segments."
      );
    }
  }
}

function normalizeGraphPathSegment(segment: string): string {
  let currentSegment = segment;
  assertSafeGraphPathSegment(currentSegment);

  for (let round = 0; round < MAX_GRAPH_PATH_DECODE_ROUNDS; round += 1) {
    let decodedSegment: string;
    try {
      decodedSegment = decodeURIComponent(currentSegment);
    } catch (error) {
      throw new GraphRequestValidationError(
        "Invalid Graph request path. Malformed percent-encoding.",
        error
      );
    }

    assertSafeGraphPathSegment(decodedSegment);

    if (decodedSegment === currentSegment) {
      return encodeURIComponent(decodedSegment);
    }

    currentSegment = decodedSegment;
  }

  throw new GraphRequestValidationError(
    "Invalid Graph request path. Excessive nested percent-encoding in path segment."
  );
}

function splitAndValidatePath(path: string): string[] {
  if (path.length > 0) {
    // Check raw path for control chars before any processing (they may
    // appear as top-level separators otherwise).
    for (let i = 0; i < path.length; i += 1) {
      const code = path.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) {
        throw new GraphRequestValidationError(
          "Invalid Graph request path. Control characters are not allowed."
        );
      }
    }
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedPath.includes("?") || normalizedPath.includes("#")) {
    throw new GraphRequestValidationError(
      "Invalid Graph request path. Query strings and fragments are not allowed in path."
    );
  }

  return normalizedPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => normalizeGraphPathSegment(segment));
}

// --- body serialization -------------------------------------------------

// F-4 remediation: runtime-safe ReadableStream brand check. Not every
// runtime exposes `ReadableStream` as a global with a standard name, so
// we feature-detect against both the global (if present) and the
// duck-typed getReader() method for portability.
function isReadableStreamLike(value: unknown): value is ReadableStream<Uint8Array> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const globalReadableStream =
    (globalThis as { ReadableStream?: unknown }).ReadableStream;
  if (
    typeof globalReadableStream === "function" &&
    value instanceof (globalReadableStream as new () => ReadableStream)
  ) {
    return true;
  }
  return typeof (value as { getReader?: unknown }).getReader === "function";
}

function isJsonLikeBody(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return false;
  }
  if (
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof URLSearchParams ||
    isReadableStreamLike(value)
  ) {
    return false;
  }
  return true;
}

function toBodyInit(body: unknown): BodyInit | null {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams ||
    isReadableStreamLike(body)
  ) {
    return body as BodyInit;
  }
  try {
    return JSON.stringify(body);
  } catch (error) {
    throw new GraphSerializationError(
      "Failed to serialize request body to JSON.",
      error
    );
  }
}

function getFallbackErrorMessage(status: number): string {
  return `Graph API request failed with status ${status}`;
}

function asTransportMethod(method: unknown): TransportHttpMethod {
  if (typeof method !== "string") {
    throw new GraphRequestValidationError(
      "Invalid Graph request method: expected a non-empty string."
    );
  }
  if (method.length === 0 || method.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid Graph request method: expected a non-empty string."
    );
  }
  if (hasForbiddenControlChar(method)) {
    throw new GraphRequestValidationError(
      "Invalid Graph request method: control characters are not allowed."
    );
  }

  const upper = method.toUpperCase();
  if (
    upper === "GET" ||
    upper === "POST" ||
    upper === "PUT" ||
    upper === "PATCH" ||
    upper === "DELETE"
  ) {
    return upper;
  }
  throw new GraphRequestValidationError(
    `Invalid Graph request method: ${JSON.stringify(method)}.`
  );
}

function validateAbortSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { aborted?: unknown }).aborted !== "boolean" ||
    typeof (value as { addEventListener?: unknown }).addEventListener !== "function" ||
    typeof (value as { removeEventListener?: unknown }).removeEventListener !== "function"
  ) {
    throw new GraphRequestValidationError(
      "Invalid Graph request signal: expected an AbortSignal-like object."
    );
  }
  return value as AbortSignal;
}

function validateRequestOptionsObject(options: unknown): asserts options is GraphRequestOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new GraphRequestValidationError(
      "Invalid Graph request options: expected an options object."
    );
  }
}

function validateRequestPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid Graph request path: expected a non-empty string."
    );
  }
  return value;
}

// --- client -------------------------------------------------------------

export class GraphClient {
  private readonly baseUrl: URL;
  private readonly apiVersion: string;
  private readonly accessToken: string;
  private readonly transport: Transport;

  readonly messages: GraphMessagesEndpoint;

  constructor(config: GraphClientConfig) {
    if (typeof config !== "object" || config === null) {
      throw new GraphRequestValidationError(
        "Invalid GraphClient config: expected an options object."
      );
    }

    this.accessToken = validateAccessToken(config.accessToken);
    this.apiVersion = validateApiVersion(config.apiVersion);
    this.baseUrl = validateBaseUrl(config.baseUrl);
    this.transport = config.transport ?? createFetchTransport();
    this.messages = new GraphMessagesEndpoint(this);
  }

  async requestRaw(options: GraphRawRequestOptions): Promise<TransportResponse> {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new GraphRequestValidationError(
        "Invalid Graph raw request options: expected an options object."
      );
    }
    const method = asTransportMethod(options.method);
    const url = this.validateAbsoluteRequestUrl(options.url);
    const signal = validateAbortSignal(options.signal);

    this.assertNoAuthorizationOverride(options.headers);

    let headers: Headers;
    try {
      headers = new Headers(options.headers);
    } catch (error) {
      throw new GraphRequestValidationError(
        "Invalid request headers: CR, LF, NUL, or other forbidden control characters in header name or value are not allowed.",
        error
      );
    }
    headers.set("authorization", `Bearer ${this.accessToken}`);

    const transportReq: TransportRequest = {
      method,
      url,
      headers,
      body: toBodyInit(options.body)
    };

    try {
      return await this.transport.request(
        transportReq,
        signal !== undefined ? { signal } : undefined
      );
    } catch (error) {
      if (error instanceof GraphNetworkError) {
        throw error;
      }
      throw new GraphNetworkError(
        "Graph request failed due to a network error",
        error
      );
    }
  }

  async request<TResponse>(options: GraphRequestOptions): Promise<TResponse> {
    validateRequestOptionsObject(options);
    const path = validateRequestPath(options.path);
    const signal = validateAbortSignal(options.signal);
    const url = this.buildUrl(path, options.query);
    const method = asTransportMethod(options.method);

    // F-4 remediation: block caller overrides of the managed Authorization
    // header before Headers construction (defense-in-depth against smuggling).
    this.assertNoAuthorizationOverride(options.headers);

    // F-4 remediation: `new Headers(init)` raises a bare TypeError when a
    // header name or value contains CR/LF/NUL. That leaks outside our typed
    // taxonomy. Wrap construction and rethrow as GraphRequestValidationError.
    let headers: Headers;
    try {
      headers = new Headers(options.headers);
    } catch (error) {
      throw new GraphRequestValidationError(
        "Invalid request headers: CR, LF, NUL, or other forbidden control characters in header name or value are not allowed.",
        error
      );
    }

    headers.set("authorization", `Bearer ${this.accessToken}`);

    const bodyIsStream = isReadableStreamLike(options.body);

    if (isJsonLikeBody(options.body) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    // F-4 remediation: ReadableStream bodies pass through unchanged. If the
    // caller did not supply a content-type, default to application/octet-stream
    // (the conservative BodyInit default for an opaque stream).
    if (bodyIsStream && !headers.has("content-type")) {
      headers.set("content-type", "application/octet-stream");
    }

    const body = toBodyInit(options.body);

    const transportReq: TransportRequest = {
      method,
      url,
      headers,
      body
    };

    let response: TransportResponse;
    try {
      response = await this.transport.request(
        transportReq,
        signal !== undefined ? { signal } : undefined
      );
    } catch (error) {
      if (error instanceof GraphNetworkError) {
        throw error;
      }
      throw new GraphNetworkError(
        "Graph request failed due to a network error",
        error
      );
    }

    const parsedBody = await this.parseResponseBody(response);

    if (response.status < 200 || response.status >= 300) {
      if (isGraphErrorEnvelope(parsedBody)) {
        throw createGraphApiError({
          status: response.status,
          payload: parsedBody.error,
          fallbackMessage: getFallbackErrorMessage(response.status)
        });
      }

      const fallbackPayload = this.extractFallbackGraphPayload(parsedBody);
      const params: {
        status: number;
        fallbackMessage: string;
        classify: boolean;
        payload?: GraphApiErrorPayload;
      } = {
        status: response.status,
        fallbackMessage: getFallbackErrorMessage(response.status),
        classify: false
      };
      if (fallbackPayload !== undefined) {
        params.payload = fallbackPayload;
      }
      throw createGraphApiError(params);
    }

    return parsedBody as TResponse;
  }

  private validateAbsoluteRequestUrl(value: string): string {
    if (typeof value !== "string" || value.trim().length === 0 || hasForbiddenControlChar(value)) {
      throw new GraphRequestValidationError(
        "Invalid Graph raw request URL: expected a non-empty http(s) URL without control characters."
      );
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      throw new GraphRequestValidationError(
        "Invalid Graph raw request URL: expected a valid absolute URL.",
        error
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new GraphRequestValidationError(
        `Invalid Graph raw request URL: protocol must be http: or https: (got ${JSON.stringify(url.protocol)}).`
      );
    }
    return url.toString();
  }

  // F-4 remediation: caller-supplied `authorization` (any casing) is
  // rejected before Headers construction. We walk the raw HeadersInit
  // rather than trusting a constructed Headers view because the `Headers`
  // constructor itself normalizes-and-throws on CR/LF/NUL, and because
  // we want the guard to fire even for otherwise-valid custom headers.
  private assertNoAuthorizationOverride(init: HeadersInit | undefined): void {
    if (init === undefined) {
      return;
    }
    const fail = (): never => {
      throw new GraphRequestValidationError(
        "Invalid request headers: authorization header is managed by the client; do not override."
      );
    };
    const isAuth = (name: string): boolean =>
      name.toLowerCase() === "authorization";

    if (init instanceof Headers) {
      if (init.has("authorization")) {
        fail();
      }
      return;
    }
    if (Array.isArray(init)) {
      for (const entry of init) {
        if (Array.isArray(entry) && entry.length > 0 && typeof entry[0] === "string") {
          if (isAuth(entry[0])) {
            fail();
          }
        }
      }
      return;
    }
    if (typeof init === "object" && init !== null) {
      for (const key of Object.keys(init as Record<string, unknown>)) {
        if (isAuth(key)) {
          fail();
        }
      }
    }
  }

  private buildUrl(path: string, query?: GraphQueryParams): string {
    const segments = splitAndValidatePath(path);

    // Preserve baseUrl.pathname (Open Question #11 default: preserve).
    const basePathname = this.baseUrl.pathname.endsWith("/")
      ? this.baseUrl.pathname
      : `${this.baseUrl.pathname}/`;

    const joined = [this.apiVersion, ...segments].join("/");
    const url = new URL(this.baseUrl.toString());
    url.pathname = `${basePathname}${joined}`;

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === null || value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private extractFallbackGraphPayload(value: unknown): GraphApiErrorPayload | undefined {
    if (!isGraphApiErrorPayload(value)) {
      return undefined;
    }
    return value;
  }

  private async parseResponseBody(response: TransportResponse): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        return (await response.json()) as unknown;
      } catch (error) {
        if (response.status >= 200 && response.status < 300) {
          throw new GraphSerializationError(
            "Failed to parse successful Graph response JSON.",
            error
          );
        }
        return undefined;
      }
    }

    const text = await response.text();
    if (text.length === 0) {
      return undefined;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}
