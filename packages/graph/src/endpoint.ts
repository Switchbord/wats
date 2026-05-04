// F-6 defineEndpoint primitive (WATS-18 / Arch-D).
//
// defineEndpoint is the factory every Graph endpoint sits on. It validates
// the endpoint spec at DEFINE time (fail-early for authors) and produces
// a typed callable that, at call time:
//   - validates required/unknown params and that every value is a string,
//   - runs path param values through the F-4 sanitizer
//     (assertSafeGraphPathSegment semantics: no dot-segments, no slashes,
//     no query/fragment, no ASCII control chars),
//   - URL-encodes query param values via URLSearchParams and rejects
//     CR/LF/NUL in query keys and values,
//   - passes body through GraphClient.request WITHOUT re-serializing
//     (the client handles JSON/octet-stream/Blob/FormData/etc.),
//   - delegates error mapping to GraphClient.request, which routes Graph
//     error envelopes through the F-5 registry (createGraphApiError →
//     resolveRegisteredError → per-code subclass).
//
// Out of scope here (per F-6 ledger): scoped sub-clients (F-7),
// pagination/cursor handling (F-13), media endpoints (F-13), Zod response
// parsing (TResponse is a type-level hint only), endpoint middleware/
// interceptors (goes through Transport).

import type { GraphClient, GraphQueryValue } from "./client";
import { GraphRequestValidationError } from "./errors";

export type EndpointHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

const ALLOWED_METHODS: ReadonlySet<EndpointHttpMethod> = new Set<EndpointHttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
]);

export interface EndpointParamSpec {
  readonly in: "path" | "query";
  readonly required?: boolean;
}

export interface EndpointDefinition<
  TParams extends Record<string, string> = Record<string, string>,
  TBody = unknown,
  TResponse = unknown
> {
  readonly method: EndpointHttpMethod;
  readonly pathTemplate: string;
  readonly params: { readonly [K in keyof TParams]: EndpointParamSpec };
  readonly buildBody?: (body: TBody) => unknown;
  readonly bodyContentType?: string;
  // TResponse is a type-level hint only — no runtime enforcement.
  readonly __response?: TResponse;
}

export interface EndpointInvokeOptions {
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string> | Headers;
}

export interface EndpointCallable<
  TParams extends Record<string, string>,
  TBody,
  TResponse
> {
  (
    client: GraphClient,
    params: TParams,
    body?: TBody,
    opts?: EndpointInvokeOptions
  ): Promise<TResponse>;
  readonly definition: EndpointDefinition<TParams, TBody, TResponse>;
}

// --- define-time helpers ------------------------------------------------

const PLACEHOLDER_NAME_REGEXP = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PLACEHOLDER_SCAN_REGEXP = /\{([^{}]*)\}/g;

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function parsePathTemplate(template: string): readonly string[] {
  // Reject stray unmatched `{` or `}` outside of a well-formed `{name}`
  // placeholder. Strategy: strip balanced placeholders, then ensure no
  // brace chars remain.
  const placeholders: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const rx = new RegExp(PLACEHOLDER_SCAN_REGEXP.source, "g");
  while ((match = rx.exec(template)) !== null) {
    const name = match[1] ?? "";
    if (name.length === 0) {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint pathTemplate: empty placeholder '{}' in ${JSON.stringify(template)}.`
      );
    }
    if (!PLACEHOLDER_NAME_REGEXP.test(name)) {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint pathTemplate: placeholder name ${JSON.stringify(name)} must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`
      );
    }
    if (seen.has(name)) {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint pathTemplate: duplicate placeholder ${JSON.stringify(name)}.`
      );
    }
    seen.add(name);
    placeholders.push(name);
  }
  const stripped = template.replace(new RegExp(PLACEHOLDER_SCAN_REGEXP.source, "g"), "");
  if (stripped.includes("{") || stripped.includes("}")) {
    throw new GraphRequestValidationError(
      `Invalid defineEndpoint pathTemplate: unbalanced or malformed braces in ${JSON.stringify(template)}.`
    );
  }
  return placeholders;
}

function validateDefinition(def: EndpointDefinition<Record<string, string>, unknown, unknown>): readonly string[] {
  if (typeof def !== "object" || def === null) {
    throw new GraphRequestValidationError(
      "Invalid defineEndpoint spec: expected an options object."
    );
  }
  if (typeof def.method !== "string" || !ALLOWED_METHODS.has(def.method as EndpointHttpMethod)) {
    throw new GraphRequestValidationError(
      `Invalid defineEndpoint method: ${JSON.stringify(def.method)}. Expected one of GET|POST|PUT|PATCH|DELETE.`
    );
  }
  if (typeof def.pathTemplate !== "string" || def.pathTemplate.length === 0) {
    throw new GraphRequestValidationError(
      "Invalid defineEndpoint pathTemplate: expected a non-empty string."
    );
  }
  if (hasControlChar(def.pathTemplate)) {
    throw new GraphRequestValidationError(
      "Invalid defineEndpoint pathTemplate: control characters are not allowed."
    );
  }
  if (typeof def.params !== "object" || def.params === null) {
    throw new GraphRequestValidationError(
      "Invalid defineEndpoint params: expected an object keyed by parameter name."
    );
  }
  if (def.buildBody !== undefined && typeof def.buildBody !== "function") {
    throw new GraphRequestValidationError(
      "Invalid defineEndpoint buildBody: must be a function when provided."
    );
  }
  if (
    def.bodyContentType !== undefined &&
    (typeof def.bodyContentType !== "string" || def.bodyContentType.length === 0)
  ) {
    throw new GraphRequestValidationError(
      "Invalid defineEndpoint bodyContentType: must be a non-empty string when provided."
    );
  }

  const placeholders = parsePathTemplate(def.pathTemplate);
  const placeholderSet = new Set(placeholders);
  const paramKeys = Object.keys(def.params);

  for (const key of paramKeys) {
    // F-6 remediation (WATS-29): validate param-spec key names against
    // the same placeholder-name regex used for {foo} in pathTemplate.
    // Rejects '', 'bad name', leading-digit, etc. at DEFINE time so
    // authors get fail-early feedback rather than a silent mismatch.
    if (!PLACEHOLDER_NAME_REGEXP.test(key)) {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint params key ${JSON.stringify(key)}: must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`
      );
    }
    const spec = (def.params as Record<string, EndpointParamSpec>)[key];
    if (typeof spec !== "object" || spec === null) {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint params[${JSON.stringify(key)}]: expected an object.`
      );
    }
    if (spec.in !== "path" && spec.in !== "query") {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint params[${JSON.stringify(key)}].in: expected 'path' or 'query'.`
      );
    }
    if (spec.in === "path" && !placeholderSet.has(key)) {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint params[${JSON.stringify(key)}]: declared as path param but absent from pathTemplate ${JSON.stringify(def.pathTemplate)}.`
      );
    }
  }

  for (const name of placeholders) {
    const spec = (def.params as Record<string, EndpointParamSpec | undefined>)[name];
    if (spec === undefined || spec.in !== "path") {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint pathTemplate: placeholder ${JSON.stringify(name)} has no matching params entry with in:'path'.`
      );
    }
  }

  return placeholders;
}

// --- call-time helpers --------------------------------------------------

// Mirrors packages/graph/src/client.ts assertSafeGraphPathSegment: dot-
// segments, '/', '\\', '?', '#', and ASCII control chars are rejected.
// We deliberately re-check here (rather than importing the private helper
// from client.ts) to keep endpoint.ts self-contained and to produce
// call-time error messages that point at the param name.
//
// F-7 (WATS-19) exports this internal helper so scoped sub-clients
// (PhoneNumberClient / WABAClient) can reuse the same sanitization at
// CONSTRUCTION time rather than re-implementing the rules. External
// consumers should not rely on this export — it is an internal seam.
export function assertSafePathParamValue(name: string, value: string): void {
  if (value.length === 0) {
    throw new GraphRequestValidationError(
      `Invalid defineEndpoint param ${JSON.stringify(name)}: path parameter value must be a non-empty string.`
    );
  }
  if (value === "." || value === "..") {
    throw new GraphRequestValidationError(
      `Invalid defineEndpoint param ${JSON.stringify(name)}: dot-segments are not allowed.`
    );
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new GraphRequestValidationError(
      `Invalid defineEndpoint param ${JSON.stringify(name)}: path traversal patterns are not allowed.`
    );
  }
  if (value.includes("?") || value.includes("#")) {
    throw new GraphRequestValidationError(
      `Invalid defineEndpoint param ${JSON.stringify(name)}: query strings and fragments are not allowed.`
    );
  }
  if (hasControlChar(value)) {
    throw new GraphRequestValidationError(
      `Invalid defineEndpoint param ${JSON.stringify(name)}: control characters are not allowed.`
    );
  }
}

function assertSafeQueryValue(name: string, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x00 || code === 0x0a || code === 0x0d) {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint query param ${JSON.stringify(name)}: CR, LF, and NUL are not allowed.`
      );
    }
  }
}

function resolvePath(
  template: string,
  params: Record<string, string>,
  pathParamNames: readonly string[]
): string {
  let resolved = template;
  for (const name of pathParamNames) {
    const value = params[name];
    if (typeof value !== "string") {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint call: missing required path param ${JSON.stringify(name)}.`
      );
    }
    assertSafePathParamValue(name, value);
    resolved = resolved.replace(`{${name}}`, value);
  }
  return resolved;
}

function buildQuery(
  params: Record<string, unknown>,
  spec: Record<string, EndpointParamSpec>
): Record<string, GraphQueryValue> | undefined {
  const out: Record<string, GraphQueryValue> = {};
  let any = false;
  for (const [name, s] of Object.entries(spec)) {
    if (s.in !== "query") {
      continue;
    }
    const raw = params[name];
    if (raw === undefined) {
      if (s.required === true) {
        throw new GraphRequestValidationError(
          `Invalid defineEndpoint call: missing required query param ${JSON.stringify(name)}.`
        );
      }
      continue;
    }
    if (typeof raw !== "string") {
      throw new GraphRequestValidationError(
        `Invalid defineEndpoint param ${JSON.stringify(name)}: must be a string (got ${typeof raw}).`
      );
    }
    assertSafeQueryValue(name, raw);
    out[name] = raw;
    any = true;
  }
  return any ? out : undefined;
}

export function defineEndpoint<
  TParams extends Record<string, string>,
  TBody = unknown,
  TResponse = unknown
>(
  def: EndpointDefinition<TParams, TBody, TResponse>
): EndpointCallable<TParams, TBody, TResponse> {
  const pathParamNames = validateDefinition(
    def as EndpointDefinition<Record<string, string>, unknown, unknown>
  );
  const paramsSpec = def.params as Record<string, EndpointParamSpec>;
  const knownParamNames = new Set(Object.keys(paramsSpec));

  // F-6 remediation (WATS-29): freeze the definition so the `readonly`
  // TS contract on EndpointCallable.definition is enforced at runtime.
  // External code attempting to mutate ep.definition.method or swap out
  // ep.definition.params is silently rejected (strict=false) or throws
  // (strict=true) but in both cases the callable's invoke closure keeps
  // the original frozen definition and its behaviour.
  const frozenDef: EndpointDefinition<TParams, TBody, TResponse> =
    Object.freeze({
      ...def,
      params: Object.freeze({ ...def.params }) as {
        readonly [K in keyof TParams]: EndpointParamSpec;
      }
    });

  const callable: EndpointCallable<TParams, TBody, TResponse> = Object.assign(
    async function invoke(
      client: GraphClient,
      params: TParams,
      body?: TBody,
      opts?: EndpointInvokeOptions
    ): Promise<TResponse> {
      if (typeof params !== "object" || params === null) {
        throw new GraphRequestValidationError(
          "Invalid defineEndpoint call: params must be an object."
        );
      }
      // Reject unknown params.
      const paramsRec = params as unknown as Record<string, unknown>;
      for (const key of Object.keys(paramsRec)) {
        if (!knownParamNames.has(key)) {
          throw new GraphRequestValidationError(
            `Invalid defineEndpoint call: unknown param ${JSON.stringify(key)}.`
          );
        }
      }
      // Path params all required.
      const pathValues: Record<string, string> = {};
      for (const name of pathParamNames) {
        const raw = paramsRec[name];
        if (raw === undefined) {
          throw new GraphRequestValidationError(
            `Invalid defineEndpoint call: missing required path param ${JSON.stringify(name)}.`
          );
        }
        if (typeof raw !== "string") {
          throw new GraphRequestValidationError(
            `Invalid defineEndpoint param ${JSON.stringify(name)}: must be a string (got ${typeof raw}).`
          );
        }
        pathValues[name] = raw;
      }

      const resolvedPath = resolvePath(def.pathTemplate, pathValues, pathParamNames);
      const resolvedQuery = buildQuery(paramsRec, paramsSpec);

      const resolvedBody =
        body === undefined
          ? undefined
          : def.buildBody !== undefined
            ? def.buildBody(body)
            : body;

      // F-6 remediation (WATS-29): build a plain-object HeadersInit and
      // hand it to GraphClient.request. The client's single existing
      // F-4 guard (new Headers(init) inside try/catch + authorization-
      // override walk over Record/Array/Headers) then produces the
      // typed GraphRequestValidationError for CR/LF/NUL and for
      // authorization-override attempts. Eagerly constructing `new
      // Headers(opts.headers)` here would raise a bare TypeError and
      // escape the taxonomy, diverging from the direct client.request
      // path for logically identical inputs.
      let headersInit: Record<string, string> | undefined;
      if (opts?.headers !== undefined || def.bodyContentType !== undefined) {
        const merged: Record<string, string> = {};
        if (def.bodyContentType !== undefined && resolvedBody !== undefined) {
          merged["content-type"] = def.bodyContentType;
        }
        if (opts?.headers !== undefined) {
          if (opts.headers instanceof Headers) {
            opts.headers.forEach((value, key) => {
              merged[key] = value;
            });
          } else {
            for (const [k, v] of Object.entries(opts.headers)) {
              merged[k] = v;
            }
          }
        }
        headersInit = merged;
      }

      const requestOptions: {
        method: string;
        path: string;
        body?: unknown;
        query?: Record<string, GraphQueryValue>;
        headers?: HeadersInit;
        signal?: AbortSignal;
      } = {
        method: def.method,
        path: resolvedPath
      };
      if (resolvedBody !== undefined) {
        requestOptions.body = resolvedBody;
      }
      if (resolvedQuery !== undefined) {
        requestOptions.query = resolvedQuery;
      }
      if (headersInit !== undefined) {
        requestOptions.headers = headersInit;
      }
      if (opts?.signal !== undefined) {
        requestOptions.signal = opts.signal;
      }

      return client.request<TResponse>(requestOptions);
    },
    { definition: frozenDef }
  );

  return callable;
}
