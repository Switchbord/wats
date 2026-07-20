// WATS-153 advanced message-template helpers (slice 1: compare + unpause).
//
// These callables mirror pywa's `WhatsApp.compare_templates` and
// `WhatsApp.unpause_template`. Both are template-id scoped Graph edges
// (no WABA path prefix), layered on `defineEndpoint` so they inherit the
// F-6 path-param sanitizer (dot-segment / slash / control-char rejection)
// and the F-4 MockTransport testability contract.
//
// Reference notes (see maintainers/template-management-reference.md):
//  - compare: pywa sends `template_ids` as a comma-joined string. Meta's
//    curl docs show a bracketed list; the accepted form is UNVERIFIED.
//    We follow pywa (comma-joined) and document the discrepancy.
//  - unpause: the `/unpause` edge is not listed in the Graph reference;
//    the response shape `{ success, reason? }` is inferred from pywa and
//    is UNVERIFIED. We preserve unknown fields via an index signature.
//
// Slice 1 scope: compare + unpause. WATS-160A adds migrateTemplates.
// archive/unarchive/upsert/library land in subsequent WATS-160 slices.

import { defineEndpoint } from "../../endpoint.js";
import type { EndpointInvokeOptions } from "../../endpoint.js";
import type { GraphClient, GraphRawRequestOptions } from "../../client.js";
import type { TransportResponse } from "../../transport.js";
import {
  createGraphApiError,
  isGraphApiErrorPayload,
  isGraphErrorEnvelope,
  type GraphApiErrorPayload
} from "../../errors.js";
import {
  assertArray,
  assertPlainRecord,
  assertString,
  hasControlChar,
  validationError,
  TEMPLATE_SHORT_TEXT_MAX_LENGTH
} from "./shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Canonical top-block-reason enum values documented by Meta and mirrored
 * by pywa's `TopBlockReasonType`. Unknown values are preserved as raw
 * strings (see {@link TemplatesCompareResult.topBlockReason}).
 */
export const KNOWN_TEMPLATE_TOP_BLOCK_REASONS = [
  "NO_LONGER_NEEDED",
  "NO_REASON",
  "NO_REASON_GIVEN",
  "NO_SIGN_UP",
  "OFFENSIVE_MESSAGES",
  "OTHER",
  "OTP_DID_NOT_REQUEST",
  "SPAM",
  "UNKNOWN_BLOCK_REASON",
  "UNKNOWN"
] as const;
export type TemplateTopBlockReason = (typeof KNOWN_TEMPLATE_TOP_BLOCK_REASONS)[number];

/**
 * Normalized result of `GET /{templateId}/compare`.
 *
 * Mirrors pywa's `TemplatesCompareResult`:
 *  - `blockRate`: template ids ordered by relative BLOCK_RATE metric.
 *  - `timesSent`: map of template id -> send count (MESSAGE_SENDS).
 *  - `topBlockReason`: map of template id -> top block reason string.
 *
 * Unknown response fields (and the raw `data` array) are preserved via the
 * index signature because the Meta response shape is only partially
 * documented and pywa's parsing has known discrepancies.
 */
export interface TemplatesCompareResult {
  readonly blockRate?: readonly string[];
  readonly timesSent?: Readonly<Record<string, number>>;
  readonly topBlockReason?: Readonly<Record<string, string>>;
  /** Raw Graph `data` array, preserved verbatim for forward-compat. */
  readonly data?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface CompareTemplatesInput {
  readonly templateId: string;
  /** One or more additional template ids to compare against. */
  readonly templateIds: readonly string[];
  /** Unix timestamp (seconds) as a string, per pywa. */
  readonly start: string;
  /** Unix timestamp (seconds) as a string, per pywa. */
  readonly end: string;
}

/**
 * Result of `POST /{templateId}/unpause`. The endpoint is UNVERIFIED and
 * the shape is inferred from pywa; unknown fields are preserved.
 */
export interface TemplateUnpauseResult {
  readonly success: boolean;
  readonly reason?: string;
  readonly [key: string]: unknown;
}

export interface UnpauseTemplateInput {
  readonly templateId: string;
}

// ---------------------------------------------------------------------------
// compareTemplates
// ---------------------------------------------------------------------------

/** Cap on the number of comparison template ids (defensive finite cap). */
export const COMPARE_TEMPLATES_MAX_IDS = 200;

function normalizeCompareParams(input: CompareTemplatesInput): Record<string, string> {
  const helperName = "compareTemplates";
  const record = assertPlainRecord(input, helperName);
  const templateId = assertString(record.templateId, "templateId", helperName);
  const idsArr = assertArray(record.templateIds, "templateIds", 1, COMPARE_TEMPLATES_MAX_IDS, helperName);
  const templateIds = idsArr.map((item, index) => assertString(item, `templateIds[${index}]`, helperName));
  const start = assertString(record.start, "start", helperName);
  const end = assertString(record.end, "end", helperName);
  // pywa sends template_ids as a comma-joined string. Meta's curl docs show
  // a bracketed list; the accepted form is UNVERIFIED. We follow pywa.
  return { templateId, template_ids: templateIds.join(","), start, end };
}

interface CompareRawResponse {
  readonly data?: readonly unknown[];
  readonly [key: string]: unknown;
}

/**
 * Parse the Graph `/{templateId}/compare` response into a typed
 * {@link TemplatesCompareResult}. Unknown fields and the raw `data` array
 * are preserved. Parsing is defensive: malformed metric entries are
 * skipped rather than throwing, because the Meta response shape is only
 * partially documented.
 */
function parseCompareResult(raw: CompareRawResponse): TemplatesCompareResult {
  const out: Record<string, unknown> = {};
  if (raw !== null && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key !== "data") out[key] = value;
    }
  }
  const data = (raw as CompareRawResponse | null | undefined)?.data;
  if (Array.isArray(data)) {
    out.data = data;
    for (const entry of data) {
      if (entry === null || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const metric = typeof rec.metric === "string" ? rec.metric : "";
      if (metric === "BLOCK_RATE") {
        const arr = rec.order_by_relative_metric;
        if (Array.isArray(arr)) {
          out.blockRate = arr.map((item) => (typeof item === "string" ? item : String(item)));
        }
      } else if (metric === "MESSAGE_SENDS") {
        const nv = rec.number_values;
        if (Array.isArray(nv)) {
          const map: Record<string, number> = {};
          for (const item of nv) {
            if (item === null || typeof item !== "object") continue;
            const r = item as Record<string, unknown>;
            if (typeof r.key === "string" && typeof r.value === "number" && Number.isFinite(r.value)) {
              map[r.key] = r.value;
            }
          }
          if (Object.keys(map).length > 0) out.timesSent = map;
        }
      } else if (metric === "TOP_BLOCK_REASON") {
        const sv = rec.string_values;
        if (Array.isArray(sv)) {
          const map: Record<string, string> = {};
          for (const item of sv) {
            if (item === null || typeof item !== "object") continue;
            const r = item as Record<string, unknown>;
            if (typeof r.key === "string" && typeof r.value === "string") {
              map[r.key] = r.value;
            }
          }
          if (Object.keys(map).length > 0) out.topBlockReason = map;
        }
      }
    }
  }
  return out as TemplatesCompareResult;
}

const compareTemplatesRaw = defineEndpoint<
  { templateId: string; template_ids: string; start: string; end: string },
  never,
  CompareRawResponse
>({
  method: "GET",
  pathTemplate: "/{templateId}/compare",
  params: {
    templateId: { in: "path", required: true },
    template_ids: { in: "query", required: true },
    start: { in: "query", required: true },
    end: { in: "query", required: true }
  }
});

export const compareTemplates = Object.assign(
  async function compareTemplates(
    client: GraphClient,
    params: CompareTemplatesInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<TemplatesCompareResult> {
    const normalized = normalizeCompareParams(params);
    const raw = await compareTemplatesRaw(
      client,
      normalized as Parameters<typeof compareTemplatesRaw>[1],
      body,
      opts
    );
    return parseCompareResult(raw);
  },
  { definition: compareTemplatesRaw.definition }
) as unknown as {
  (
    client: GraphClient,
    params: CompareTemplatesInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<TemplatesCompareResult>;
  readonly definition: typeof compareTemplatesRaw.definition;
};

// ---------------------------------------------------------------------------
// unpauseTemplate
// ---------------------------------------------------------------------------

function normalizeUnpauseParams(input: UnpauseTemplateInput): Record<string, string> {
  const helperName = "unpauseTemplate";
  const record = assertPlainRecord(input, helperName);
  const templateId = assertString(record.templateId, "templateId", helperName);
  return { templateId };
}

const unpauseTemplateRaw = defineEndpoint<
  { templateId: string },
  never,
  TemplateUnpauseResult
>({
  method: "POST",
  pathTemplate: "/{templateId}/unpause",
  params: { templateId: { in: "path", required: true } }
});

export const unpauseTemplate = Object.assign(
  async function unpauseTemplate(
    client: GraphClient,
    params: UnpauseTemplateInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateUnpauseResult> {
    const normalized = normalizeUnpauseParams(params);
    return unpauseTemplateRaw(
      client,
      normalized as Parameters<typeof unpauseTemplateRaw>[1],
      body,
      opts
    );
  },
  { definition: unpauseTemplateRaw.definition }
) as unknown as {
  (
    client: GraphClient,
    params: UnpauseTemplateInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateUnpauseResult>;
  readonly definition: typeof unpauseTemplateRaw.definition;
};

// ---------------------------------------------------------------------------
// migrateTemplates (WATS-160A)
// ---------------------------------------------------------------------------
//
// Mirrors pywa's `WhatsApp.migrate_templates(source_waba_id, page_number=None,
// *, destination_waba_id=None)`. Copies (not moves) message templates from a
// source WABA into the destination WABA.
//
// Wire (pywa parity):
//   POST /{destinationWabaId}/migrate_message_templates?source_waba_id={src}
//   optional &page_number={n}
//   No body.
//
// Meta also documents optional body params (`count`, `template_ids`) not
// exposed by pywa; this slice implements pywa parity only.
//
// Response discrepancy (see REFERENCE-160 / handoff): Meta returns
// `failed_templates` as a map `{ id: reason }`, while pywa parses a list
// `[{ id, reason }]`. WATS normalizes BOTH forms defensively into the
// camelCase `failedTemplates` array. `migrated_templates` entries may be
// bare strings (Meta) or objects (pywa); strings are converted to `{ id }`.
// Unknown top-level and per-entry fields are preserved.

const HELPER_MIGRATE_TEMPLATES = "migrateTemplates";

export interface MigrateTemplatesInput {
  readonly destinationWabaId: string;
  readonly sourceWabaId: string;
  /** Optional zero-based page number (Meta examples use `0`). */
  readonly pageNumber?: number;
}

/**
 * A successfully migrated template entry inside
 * {@link MigrateTemplatesResponse.migratedTemplates}. Meta returns bare id
 * strings; pywa returns objects. Unknown per-entry fields are preserved.
 */
export interface MigratedTemplateEntry {
  readonly id: string;
  readonly [key: string]: unknown;
}

/**
 * A failed migration entry inside
 * {@link MigrateTemplatesResponse.failedTemplates}. Normalized from both
 * Meta's map form (`{ id: reason }`) and pywa's list form
 * (`[{ id, reason }]`). Unknown per-entry fields are preserved.
 */
export interface FailedTemplateEntry {
  readonly id: string;
  readonly reason: string;
  readonly [key: string]: unknown;
}

/**
 * Normalized result of `POST /{destinationWabaId}/migrate_message_templates`.
 * Snake-case `migrated_templates` / `failed_templates` are camelCased; the
 * two `failed_templates` shapes (Meta map vs pywa list) are both normalized
 * into {@link failedTemplates}. Unknown response fields are preserved via
 * the index signature because the Meta response shape is only partially
 * documented.
 */
export interface MigrateTemplatesResponse {
  readonly migratedTemplates?: readonly MigratedTemplateEntry[];
  readonly failedTemplates?: readonly FailedTemplateEntry[];
  readonly [key: string]: unknown;
}

/**
 * Validate a WABA/template id for the migrate helper. Reuses the shared
 * `assertString` (type / non-empty / control-char / length) and additionally
 * rejects dot-segments and path/query/fragment separators so that ids cannot
 * escape the `{destinationWabaId}` path segment or smuggle query/fragment
 * data into `source_waba_id`. Mirrors the F-6 path-param taxonomy.
 */
function assertSafeMigrateId(
  value: unknown,
  fieldName: string,
  helperName: string
): string {
  const str = assertString(value, fieldName, helperName);
  if (str === "." || str === "..") {
    throw validationError(
      `Invalid ${helperName} input: ${fieldName} must not be a dot-segment.`
    );
  }
  if (
    str.includes("/") ||
    str.includes("\\") ||
    str.includes("?") ||
    str.includes("#")
  ) {
    throw validationError(
      `Invalid ${helperName} input: ${fieldName} must not contain path/query/fragment separators.`
    );
  }
  return str;
}

/**
 * Validate an optional `pageNumber`. Must be a finite, non-negative integer
 * when present (Meta examples use `0`). Rejects NaN, Infinity, negative,
 * and non-integer values.
 */
function assertPageNumber(
  value: unknown,
  helperName: string
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw validationError(
      `Invalid ${helperName} input: pageNumber must be a number.`
    );
  }
  if (!Number.isFinite(value)) {
    throw validationError(
      `Invalid ${helperName} input: pageNumber must be a finite number.`
    );
  }
  if (!Number.isInteger(value)) {
    throw validationError(
      `Invalid ${helperName} input: pageNumber must be an integer.`
    );
  }
  if (value < 0) {
    throw validationError(
      `Invalid ${helperName} input: pageNumber must be >= 0.`
    );
  }
  return value;
}

function normalizeMigrateTemplatesParams(
  input: MigrateTemplatesInput
): Record<string, string> {
  const record = assertPlainRecord(input, HELPER_MIGRATE_TEMPLATES);
  const destinationWabaId = assertSafeMigrateId(
    record.destinationWabaId,
    "destinationWabaId",
    HELPER_MIGRATE_TEMPLATES
  );
  const sourceWabaId = assertSafeMigrateId(
    record.sourceWabaId,
    "sourceWabaId",
    HELPER_MIGRATE_TEMPLATES
  );
  const pageNumber = assertPageNumber(record.pageNumber, HELPER_MIGRATE_TEMPLATES);
  const out: Record<string, string> = {
    destinationWabaId,
    source_waba_id: sourceWabaId
  };
  if (pageNumber !== undefined) {
    out.page_number = String(pageNumber);
  }
  return out;
}

interface MigrateTemplatesRawResponse {
  readonly migrated_templates?: readonly unknown[];
  readonly failed_templates?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Normalize a single `migrated_templates` entry. Bare strings (Meta form)
 * become `{ id }`; objects with a non-empty string `id` preserve their
 * unknown fields. Malformed entries (null, non-object, object without a
 * string id) are skipped rather than thrown, because the Meta response
 * shape is only partially documented.
 */
function normalizeMigratedTemplateEntry(
  entry: unknown
): MigratedTemplateEntry | null {
  if (typeof entry === "string") {
    if (entry.length === 0) return null;
    return { id: entry };
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const rec = entry as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  const out: Record<string, unknown> = { id: rec.id };
  for (const [key, value] of Object.entries(rec)) {
    if (key === "id") continue;
    out[key] = value;
  }
  return out as MigratedTemplateEntry;
}

/**
 * Normalize a single list-form `failed_templates` entry. Requires a
 * non-empty string `id` and a string `reason`; unknown fields are
 * preserved. Malformed entries are skipped rather than thrown.
 */
function normalizeFailedTemplateEntryList(
  entry: unknown
): FailedTemplateEntry | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const rec = entry as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  if (typeof rec.reason !== "string") return null;
  const out: Record<string, unknown> = { id: rec.id, reason: rec.reason };
  for (const [key, value] of Object.entries(rec)) {
    if (key === "id" || key === "reason") continue;
    out[key] = value;
  }
  return out as FailedTemplateEntry;
}

/**
 * Parse the raw Graph `POST /{destinationWabaId}/migrate_message_templates`
 * response into a typed {@link MigrateTemplatesResponse}. Snake-case fields
 * are camelCased. `failed_templates` is normalized from BOTH the Meta map
 * form (`{ id: reason }`) and the pywa list form (`[{ id, reason }]`).
 * `migrated_templates` strings are converted to `{ id }`. Unknown top-level
 * and per-entry fields are preserved; malformed entries are skipped.
 */
function parseMigrateTemplatesResponse(
  raw: MigrateTemplatesRawResponse
): MigrateTemplatesResponse {
  const out: Record<string, unknown> = {};
  if (raw !== null && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key !== "migrated_templates" && key !== "failed_templates") {
        out[key] = value;
      }
    }
  }
  const migrated = (raw as MigrateTemplatesRawResponse | null | undefined)
    ?.migrated_templates;
  if (Array.isArray(migrated)) {
    const entries: MigratedTemplateEntry[] = [];
    for (const entry of migrated) {
      const norm = normalizeMigratedTemplateEntry(entry);
      if (norm !== null) entries.push(norm);
    }
    out.migratedTemplates = entries;
  }
  const failed = (raw as MigrateTemplatesRawResponse | null | undefined)
    ?.failed_templates;
  if (Array.isArray(failed)) {
    // pywa list form.
    const entries: FailedTemplateEntry[] = [];
    for (const entry of failed) {
      const norm = normalizeFailedTemplateEntryList(entry);
      if (norm !== null) entries.push(norm);
    }
    out.failedTemplates = entries;
  } else if (failed !== null && typeof failed === "object") {
    // Meta map form: { id: reason }.
    const entries: FailedTemplateEntry[] = [];
    for (const [id, reason] of Object.entries(failed as Record<string, unknown>)) {
      if (id.length > 0 && typeof reason === "string") {
        entries.push({ id, reason });
      }
    }
    out.failedTemplates = entries;
  }
  return out as unknown as MigrateTemplatesResponse;
}

const migrateTemplatesRaw = defineEndpoint<
  { destinationWabaId: string; source_waba_id: string; page_number?: string },
  never,
  MigrateTemplatesRawResponse
>({
  method: "POST",
  pathTemplate: "/{destinationWabaId}/migrate_message_templates",
  params: {
    destinationWabaId: { in: "path", required: true },
    source_waba_id: { in: "query", required: true },
    page_number: { in: "query" }
  }
});

export const migrateTemplates = Object.assign(
  async function migrateTemplates(
    client: GraphClient,
    params: MigrateTemplatesInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<MigrateTemplatesResponse> {
    const normalized = normalizeMigrateTemplatesParams(params);
    const raw = await migrateTemplatesRaw(
      client,
      normalized as Parameters<typeof migrateTemplatesRaw>[1],
      body,
      opts
    );
    return parseMigrateTemplatesResponse(raw as unknown as MigrateTemplatesRawResponse);
  },
  { definition: migrateTemplatesRaw.definition }
) as unknown as {
  (
    client: GraphClient,
    params: MigrateTemplatesInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<MigrateTemplatesResponse>;
  readonly definition: typeof migrateTemplatesRaw.definition;
};

// ---------------------------------------------------------------------------
// archiveTemplates / unarchiveTemplates (WATS-160B)
// ---------------------------------------------------------------------------
//
// Mirrors pywa's `WhatsApp.archive_templates(template_ids, waba_id=None)` /
// `WhatsApp.unarchive_templates(template_ids, waba_id=None)`. Bulk archive or
// unarchive up to 100 message templates on a WABA.
//
// IMPORTANT: these endpoints live on the api.facebook.com host (NOT
// graph.facebook.com), so they CANNOT use `defineEndpoint` —
// `GraphClient.request` always prepends the configured graph base URL + api
// version to the path. Instead we call `GraphClient.requestRaw` with an
// absolute URL and parse the resulting `TransportResponse` ourselves,
// preserving the Graph error taxonomy (GraphApiError via createGraphApiError)
// on non-2xx responses. Auth (Bearer token) is still managed by
// `GraphClient.requestRaw`, which injects the access token and rejects
// caller-supplied `authorization` headers — tokens never leak through the
// body, URL, or error payload.
//
// Wire (see maintainers/template-management-reference.md §5):
//   POST https://api.facebook.com/{wabaId}/message_templates/archive
//   POST https://api.facebook.com/{wabaId}/message_templates/unarchive
//   Body: { hsm_ids: [id, ...] }  (JSON, content-type application/json)
//
// Body-shape decision: Meta's curl docs document `{ hsm_ids: [ids] }` (a JSON
// array). pywa instead sends `{ hsm_ids: "id1,id2" }` (a comma-joined
// string). The two forms are NOT wire-equivalent and the accepted form is
// UNVERIFIED. We follow Meta's documented array shape because (a) it is the
// documented contract and (b) a JSON array avoids ambiguity when a template
// id legitimately contains a comma. pywa parity is intentionally NOT mimicked
// here. See maintainers/template-management-reference.md §5.
//
// Response (Meta, see maintainers/template-management-reference.md §5):
//   archive   -> { archived_templates:  [id...], failed_templates: { id: reason } }
//   unarchive -> { unarchived_templates:[id...], failed_templates: { id: reason } }
// pywa may return `failed_templates` as a list `[{ id, reason }]`; both forms
// are normalized into a `Record<string, string>` map. `archived_templates` /
// `unarchived_templates` entries may be bare strings (Meta) or objects with a
// string `id` (pywa); both are normalized to bare id strings. Unknown
// top-level fields are preserved via the index signature.

const HELPER_ARCHIVE_TEMPLATES = "archiveTemplates";
const HELPER_UNARCHIVE_TEMPLATES = "unarchiveTemplates";

/** Base URL for the api.facebook.com host (NOT graph.facebook.com). */
const API_FACEBOOK_BASE = "https://api.facebook.com/";

/** Cap on the number of template ids per archive/unarchive call (Meta max). */
export const ARCHIVE_TEMPLATES_MAX_IDS = 100;

/** Per-template-id length cap (defensive finite bound). */
const TEMPLATE_ID_MAX_LENGTH = 256;

export interface ArchiveTemplatesInput {
  readonly wabaId: string;
  readonly templateIds: readonly string[];
}

export interface UnarchiveTemplatesInput {
  readonly wabaId: string;
  readonly templateIds: readonly string[];
}

/**
 * Normalized result of
 * `POST https://api.facebook.com/{wabaId}/message_templates/archive`.
 *
 * `archivedTemplates` is always present (possibly empty) and contains the
 * bare id strings of templates that were successfully archived. Meta returns
 * bare id strings; pywa returns objects — both are normalized to strings.
 *
 * `failedTemplates` is always present (possibly empty) and maps the id of
 * each template that failed to archive to a human-readable reason string.
 * Both the Meta map form (`{ id: reason }`) and the pywa list form
 * (`[{ id, reason }]`) are normalized into this map.
 *
 * Unknown top-level response fields are preserved via the index signature
 * because the Meta response shape is only partially documented.
 */
export interface ArchiveTemplatesResponse {
  readonly archivedTemplates: readonly string[];
  readonly failedTemplates: Record<string, string>;
  readonly [key: string]: unknown;
}

/**
 * Normalized result of
 * `POST https://api.facebook.com/{wabaId}/message_templates/unarchive`.
 * Shape mirrors {@link ArchiveTemplatesResponse} with `unarchivedTemplates`.
 */
export interface UnarchiveTemplatesResponse {
  readonly unarchivedTemplates: readonly string[];
  readonly failedTemplates: Record<string, string>;
  readonly [key: string]: unknown;
}

/**
 * Duck-type the GraphClient for the archive/unarchive helpers. These bypass
 * `defineEndpoint` (which only needs `request`) and call `requestRaw`
 * directly, so we require both methods to be present. Throws a
 * GraphRequestValidationError (part of the Graph error taxonomy) on a bad
 * client so callers never see a raw host TypeError.
 */
function assertArchiveClient(
  client: unknown,
  helperName: string
): asserts client is GraphClient {
  if (
    client === null ||
    typeof client !== "object" ||
    typeof (client as { requestRaw?: unknown }).requestRaw !== "function"
  ) {
    throw validationError(
      `Invalid ${helperName} client: expected a GraphClient-like object with requestRaw().`
    );
  }
}

/**
 * Validate a single template id destined for the JSON request body. Unlike
 * path-scoped ids (which use {@link assertSafeMigrateId} to reject slash /
 * `?` / `#` / dot-segments), body values are JSON-escaped and never
 * interpreted as URL structure, so slashes and commas are permitted (a
 * template id may legitimately contain either). We still reject control
 * characters and any whitespace (including internal whitespace) because
 * template ids are opaque numeric/name tokens and whitespace is never
 * meaningful. A finite length cap guards against unbounded input.
 */
function assertTemplateIdBodyValue(
  value: unknown,
  index: number,
  helperName: string
): string {
  if (typeof value !== "string") {
    throw validationError(
      `Invalid ${helperName} input: templateIds[${index}] must be a string.`
    );
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw validationError(
      `Invalid ${helperName} input: templateIds[${index}] must be non-empty.`
    );
  }
  if (hasControlChar(value)) {
    throw validationError(
      `Invalid ${helperName} input: templateIds[${index}] must not contain control characters (CR/LF/NUL/etc.).`
    );
  }
  if (/\s/.test(value)) {
    throw validationError(
      `Invalid ${helperName} input: templateIds[${index}] must not contain whitespace.`
    );
  }
  if (value.length > TEMPLATE_ID_MAX_LENGTH) {
    throw validationError(
      `Invalid ${helperName} input: templateIds[${index}] exceeds ${TEMPLATE_ID_MAX_LENGTH}-character limit.`
    );
  }
  return value;
}

function normalizeArchiveInput(
  input: ArchiveTemplatesInput | UnarchiveTemplatesInput,
  helperName: string
): { readonly wabaId: string; readonly templateIds: readonly string[] } {
  const record = assertPlainRecord(input, helperName);
  // wabaId goes into the URL path, so apply the full path-safe taxonomy
  // (no dot-segments / slash / ? / # / control chars).
  const wabaId = assertSafeMigrateId(record.wabaId, "wabaId", helperName);
  const idsArr = assertArray(
    record.templateIds,
    "templateIds",
    1,
    ARCHIVE_TEMPLATES_MAX_IDS,
    helperName
  );
  const templateIds = idsArr.map((item, index) =>
    assertTemplateIdBodyValue(item, index, helperName)
  );
  return { wabaId, templateIds };
}

interface ArchiveRawResponse {
  readonly archived_templates?: readonly unknown[];
  readonly unarchived_templates?: readonly unknown[];
  readonly failed_templates?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Normalize a single `archived_templates` / `unarchived_templates` entry.
 * Meta returns bare id strings; pywa returns objects with a string `id`.
 * Returns the bare id string, or null for malformed entries (null, non-object,
 * object without a non-empty string id) — malformed entries are skipped
 * rather than thrown because the Meta response shape is only partially
 * documented.
 */
function normalizeIdEntry(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry.length === 0 ? null : entry;
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const rec = entry as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  return rec.id;
}

/**
 * Normalize `failed_templates` into a `Record<string, string>` map of
 * `id -> reason`. Accepts BOTH the Meta map form (`{ id: reason }`) and the
 * pywa list form (`[{ id, reason }]`). Entries without a non-empty string id
 * and a string reason are skipped rather than thrown.
 */
function normalizeFailedMap(failed: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(failed)) {
    // pywa list form: [{ id, reason }]
    for (const entry of failed) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const rec = entry as Record<string, unknown>;
      if (typeof rec.id !== "string" || rec.id.length === 0) continue;
      if (typeof rec.reason !== "string") continue;
      out[rec.id] = rec.reason;
    }
  } else if (failed !== null && typeof failed === "object") {
    // Meta map form: { id: reason }
    for (const [id, reason] of Object.entries(failed as Record<string, unknown>)) {
      if (id.length === 0) continue;
      if (typeof reason !== "string") continue;
      out[id] = reason;
    }
  }
  return out;
}

/**
 * Parse the raw archive/unarchive response into a typed
 * {@link ArchiveTemplatesResponse} / {@link UnarchiveTemplatesResponse}.
 * Snake-case `archived_templates` / `unarchived_templates` are camelCased and
 * normalized to bare id strings; `failed_templates` is normalized from both
 * the Meta map and pywa list forms into a `Record<string, string>`. Unknown
 * top-level fields are preserved. `archivedTemplates` / `unarchivedTemplates`
 * and `failedTemplates` are always present (defaulting to empty) per the
 * WATS-160B type contract.
 */
function parseArchiveResponse(
  raw: ArchiveRawResponse,
  successKey: "archived_templates" | "unarchived_templates",
  successField: "archivedTemplates" | "unarchivedTemplates"
): ArchiveTemplatesResponse | UnarchiveTemplatesResponse {
  const out: Record<string, unknown> = {};
  if (raw !== null && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key !== successKey && key !== "failed_templates") {
        out[key] = value;
      }
    }
  }
  const successArr = (raw as ArchiveRawResponse | null | undefined)?.[successKey];
  const ids: string[] = [];
  if (Array.isArray(successArr)) {
    for (const entry of successArr) {
      const id = normalizeIdEntry(entry);
      if (id !== null) ids.push(id);
    }
  }
  out[successField] = ids;
  out.failedTemplates = normalizeFailedMap(
    (raw as ArchiveRawResponse | null | undefined)?.failed_templates
  );
  return out as ArchiveTemplatesResponse | UnarchiveTemplatesResponse;
}

/**
 * Parse a `TransportResponse` body into an unknown JSON value (or undefined).
 * Mirrors `GraphClient.parseResponseBody` but is kept local so the archive /
 * unarchive helpers do not depend on private client internals. JSON parse
 * failures on a 2xx response fall through to `undefined`; on an error
 * response the body is best-effort and a parse failure also yields
 * `undefined` (the caller will then synthesize a fallback GraphApiError).
 */
async function parseResponseBody(response: TransportResponse): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Shared core for {@link archiveTemplates} / {@link unarchiveTemplates}.
 * Validates input (no transport on bad input), builds the absolute
 * api.facebook.com URL, POSTs the `{ hsm_ids: [...] }` JSON body via
 * `GraphClient.requestRaw` (which manages the Bearer auth header and rejects
 * caller `authorization` overrides), and parses the `TransportResponse`.
 *
 * Non-2xx responses are classified through the normal Graph error taxonomy:
 * if the body is a `{ error: {...} }` envelope (or a bare payload), a
 * `GraphApiError` (or a registered subclass) is thrown via
 * {@link createGraphApiError} — mirroring `GraphClient.request`. Tokens are
 * never placed in the URL or body, and error payloads originate from Meta,
 * so no token leaks through the thrown error.
 */
async function invokeArchiveEndpoint(
  client: GraphClient,
  helperName: string,
  edge: "archive" | "unarchive",
  input: ArchiveTemplatesInput | UnarchiveTemplatesInput,
  opts: EndpointInvokeOptions | undefined,
  successKey: "archived_templates" | "unarchived_templates",
  successField: "archivedTemplates" | "unarchivedTemplates"
): Promise<ArchiveTemplatesResponse | UnarchiveTemplatesResponse> {
  assertArchiveClient(client, helperName);
  const { wabaId, templateIds } = normalizeArchiveInput(input, helperName);
  const url = `${API_FACEBOOK_BASE}${wabaId}/message_templates/${edge}`;
  // Build headers: default content-type, then merge caller-supplied
  // opts.headers (so requestRaw's assertNoAuthorizationOverride can reject
  // any caller attempt to set `authorization` — auth is managed by
  // GraphClient). Caller headers win over our content-type default so
  // consumers can override the content type if ever needed.
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (opts?.headers !== undefined) {
    if (opts.headers instanceof Headers) {
      opts.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, opts.headers);
    }
  }
  const rawOptions: GraphRawRequestOptions = {
    method: "POST",
    url,
    body: { hsm_ids: templateIds },
    headers
  };
  if (opts?.signal !== undefined) {
    rawOptions.signal = opts.signal;
  }
  const response = await client.requestRaw(rawOptions);
  const parsed = await parseResponseBody(response);
  if (response.status < 200 || response.status >= 300) {
    if (isGraphErrorEnvelope(parsed)) {
      throw createGraphApiError({
        status: response.status,
        payload: parsed.error,
        fallbackMessage: `Graph API request failed with status ${response.status}`,
        headers: response.headers
      });
    }
    const fallbackPayload = isGraphApiErrorPayload(parsed) ? parsed : undefined;
    const errorParams: {
      status: number;
      fallbackMessage: string;
      classify: boolean;
      payload?: GraphApiErrorPayload;
      headers: Headers;
    } = {
      status: response.status,
      fallbackMessage: `Graph API request failed with status ${response.status}`,
      classify: false,
      headers: response.headers
    };
    if (fallbackPayload !== undefined) {
      errorParams.payload = fallbackPayload;
    }
    throw createGraphApiError(errorParams);
  }
  return parseArchiveResponse(
    (parsed ?? {}) as ArchiveRawResponse,
    successKey,
    successField
  );
}

/**
 * `POST https://api.facebook.com/{wabaId}/message_templates/archive`
 * (WATS-160B). Bulk-archive up to
 * {@link ARCHIVE_TEMPLATES_MAX_IDS} message templates on a WABA. Mirrors
 * pywa's `WhatsApp.archive_templates`. Uses `GraphClient.requestRaw` (not
 * `defineEndpoint`) because the endpoint lives on api.facebook.com, not
 * graph.facebook.com. See maintainers/template-management-reference.md §5.
 */
export async function archiveTemplates(
  client: GraphClient,
  params: ArchiveTemplatesInput,
  _body?: never,
  opts?: EndpointInvokeOptions
): Promise<ArchiveTemplatesResponse> {
  return invokeArchiveEndpoint(
    client,
    HELPER_ARCHIVE_TEMPLATES,
    "archive",
    params,
    opts,
    "archived_templates",
    "archivedTemplates"
  ) as Promise<ArchiveTemplatesResponse>;
}

/**
 * `POST https://api.facebook.com/{wabaId}/message_templates/unarchive`
 * (WATS-160B). Bulk-unarchive up to
 * {@link ARCHIVE_TEMPLATES_MAX_IDS} message templates on a WABA. Mirrors
 * pywa's `WhatsApp.unarchive_templates`. Uses `GraphClient.requestRaw` (not
 * `defineEndpoint`) because the endpoint lives on api.facebook.com, not
 * graph.facebook.com. See maintainers/template-management-reference.md §5.
 */
export async function unarchiveTemplates(
  client: GraphClient,
  params: UnarchiveTemplatesInput,
  _body?: never,
  opts?: EndpointInvokeOptions
): Promise<UnarchiveTemplatesResponse> {
  return invokeArchiveEndpoint(
    client,
    HELPER_UNARCHIVE_TEMPLATES,
    "unarchive",
    params,
    opts,
    "unarchived_templates",
    "unarchivedTemplates"
  ) as Promise<UnarchiveTemplatesResponse>;
}

// ---------------------------------------------------------------------------
// upsertAuthenticationTemplate (WATS-160C)
// ---------------------------------------------------------------------------
//
// Mirrors pywa's `WhatsApp.upsert_authentication_template` / Meta's
// `POST /{wabaId}/upsert_message_templates` with `category: AUTHENTICATION`.
// Unlike the generic create-template helper, auth upsert:
//   - sends `languages` (plural array) instead of a single `language`
//   - pins `category` to `AUTHENTICATION`
//   - builds a fixed component layout: BODY (with optional
//     `add_security_recommendation`), optional FOOTER (with
//     `code_expiration_minutes`), and a single BUTTONS component carrying
//     exactly one OTP button
//   - enforces stricter OTP-button rules than the generic builder:
//       * `text` / `autofillText` are rejected on the otpButton
//       * COPY_CODE does NOT require `supportedApps`
//       * ONE_TAP / ZERO_TAP REQUIRE `supportedApps`
//
// Wire (see Meta auth-template docs):
//   POST /{wabaId}/upsert_message_templates
//   Content-Type: application/json
//   Body: { name, languages, category:'AUTHENTICATION',
//           components:[BODY, FOOTER?, BUTTONS], message_send_ttl_seconds? }
//
// Response (CreatedTemplates-ish): a `data` array whose entries carry
// `id` / `status` / `language` plus any unknown fields Meta returns. The
// raw response is preserved verbatim via an index signature.

const HELPER_UPSERT_AUTH = "upsertAuthenticationTemplate";

/** Finite cap on the number of languages per upsert call (defensive bound). */
export const UPSERT_AUTH_LANGUAGES_MAX = 100;

/** Finite cap on supportedApps per OTP button (matches generic builder). */
export const UPSERT_AUTH_SUPPORTED_APPS_MAX = 10;

/** Allowed OTP button types for authentication template upsert. */
export type UpsertAuthOtpType = "COPY_CODE" | "ONE_TAP" | "ZERO_TAP";

export const KNOWN_UPSERT_AUTH_OTP_TYPES: readonly UpsertAuthOtpType[] = [
  "COPY_CODE",
  "ONE_TAP",
  "ZERO_TAP"
];

/**
 * A single supported-app entry on an OTP button. `packageName` /
 * `signatureHash` are mapped to the Graph wire fields `package_name` /
 * `signature_hash`. Unknown fields are not forwarded (stricter than the
 * generic OTP builder).
 */
export interface UpsertAuthSupportedAppInput {
  readonly packageName: string;
  readonly signatureHash: string;
}

/**
 * The OTP button descriptor for auth-template upsert. Stricter than the
 * generic {@link TemplateButtonInput} OTP variant: `text` and
 * `autofillText` are NOT permitted here (the upsert auth endpoint rejects
 * them), and `supportedApps` is required for ONE_TAP / ZERO_TAP but
 * optional for COPY_CODE.
 */
export interface UpsertAuthOtpButtonInput {
  readonly otpType: UpsertAuthOtpType;
  readonly supportedApps?: readonly UpsertAuthSupportedAppInput[];
}

/**
 * Public camelCase body for {@link upsertAuthenticationTemplate}. Stricter
 * than {@link CreateMessageTemplateBody}: `languages` is an array, the
 * OTP button is a single dedicated descriptor, and only the auth-specific
 * optional fields (`addSecurityRecommendation`, `codeExpirationMinutes`,
 * `messageSendTtlSeconds`) are exposed.
 */
export interface UpsertAuthenticationTemplateBody {
  readonly name: string;
  readonly languages: readonly string[];
  readonly otpButton: UpsertAuthOtpButtonInput;
  readonly addSecurityRecommendation?: boolean;
  readonly codeExpirationMinutes?: number;
  readonly messageSendTtlSeconds?: number;
}

/**
 * A single entry in the {@link UpsertAuthenticationTemplateResponse.data}
 * array. `id`, `status`, and `language` are typed; all other fields Meta
 * returns are preserved via the index signature.
 */
export interface UpsertedAuthTemplateEntry {
  readonly id?: string;
  readonly status?: string;
  readonly language?: string;
  readonly [key: string]: unknown;
}

/**
 * Response of `POST /{wabaId}/upsert_message_templates`. Mirrors the
 * CreatedTemplates-ish shape: a `data` array of per-language results plus
 * any unknown top-level fields Meta returns.
 */
export interface UpsertAuthenticationTemplateResponse {
  readonly data?: readonly UpsertedAuthTemplateEntry[];
  readonly [key: string]: unknown;
}

function assertUpsertAuthBoolean(
  value: unknown,
  fieldName: string
): boolean {
  if (typeof value !== "boolean") {
    throw validationError(
      `Invalid ${HELPER_UPSERT_AUTH} input: ${fieldName} must be a boolean.`
    );
  }
  return value;
}

/**
 * Validate `codeExpirationMinutes`: must be a finite integer in the
 * documented 1..90 range. Rejects NaN, Infinity, non-integers, and
 * out-of-range values.
 */
function assertCodeExpirationMinutes(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 90
  ) {
    throw validationError(
      `Invalid ${HELPER_UPSERT_AUTH} input: codeExpirationMinutes must be an integer between 1 and 90.`
    );
  }
  return value;
}

/**
 * Validate `messageSendTtlSeconds`: must be a finite non-negative integer.
 * Mirrors the shared `mapCommonBodyFields` check.
 */
function assertNonNegativeInteger(
  value: unknown,
  fieldName: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw validationError(
      `Invalid ${HELPER_UPSERT_AUTH} input: ${fieldName} must be a non-negative integer.`
    );
  }
  return value;
}

/**
 * Normalize `otpButton.supportedApps` into the Graph wire form
 * (`[{ package_name, signature_hash }]`). Reuses the shared
 * `assertArray` / `assertPlainRecord` / `assertString` validators so the
 * full F-6 descriptor-safe / control-char / length taxonomy applies.
 */
function normalizeUpsertAuthSupportedApps(
  value: unknown
): readonly Record<string, string>[] {
  const apps = assertArray(
    value,
    "otpButton.supportedApps",
    1,
    UPSERT_AUTH_SUPPORTED_APPS_MAX,
    HELPER_UPSERT_AUTH
  );
  return apps.map((entry, index) => {
    const record = assertPlainRecord(
      entry,
      HELPER_UPSERT_AUTH,
      `otpButton.supportedApps[${index}]`
    );
    return {
      package_name: assertString(
        record.packageName,
        `otpButton.supportedApps[${index}].packageName`,
        HELPER_UPSERT_AUTH,
        TEMPLATE_SHORT_TEXT_MAX_LENGTH
      ),
      signature_hash: assertString(
        record.signatureHash,
        `otpButton.supportedApps[${index}].signatureHash`,
        HELPER_UPSERT_AUTH,
        TEMPLATE_SHORT_TEXT_MAX_LENGTH
      )
    };
  });
}

/**
 * Build the Graph request body for auth-template upsert from the public
 * camelCase {@link UpsertAuthenticationTemplateBody}. Performs all
 * validation (descriptor-safe via `assertPlainRecord`, finite caps,
 * otpType enum, OTP-button strictness, codeExpirationMinutes range,
 * messageSendTtlSeconds non-negative integer) so bad input throws a
 * `GraphRequestValidationError` before any transport call.
 */
export function buildUpsertAuthenticationTemplateBody(
  input: UpsertAuthenticationTemplateBody
): Record<string, unknown> {
  const record = assertPlainRecord(input, HELPER_UPSERT_AUTH);

  const name = assertString(record.name, "name", HELPER_UPSERT_AUTH);

  const langsArr = assertArray(
    record.languages,
    "languages",
    1,
    UPSERT_AUTH_LANGUAGES_MAX,
    HELPER_UPSERT_AUTH
  );
  const languages = langsArr.map((item, index) =>
    assertString(item, `languages[${index}]`, HELPER_UPSERT_AUTH, 64)
  );

  const otpButtonRec = assertPlainRecord(
    record.otpButton,
    HELPER_UPSERT_AUTH,
    "otpButton"
  );
  const otpTypeRaw = assertString(
    otpButtonRec.otpType,
    "otpButton.otpType",
    HELPER_UPSERT_AUTH,
    32
  );
  const otpType = otpTypeRaw.toUpperCase();
  if (
    !KNOWN_UPSERT_AUTH_OTP_TYPES.includes(otpType as UpsertAuthOtpType)
  ) {
    throw validationError(
      `Invalid ${HELPER_UPSERT_AUTH} input: otpButton.otpType must be one of COPY_CODE, ONE_TAP, ZERO_TAP.`
    );
  }

  // Stricter than the generic OTP builder: text / autofillText are not
  // permitted on the auth-template upsert otpButton.
  if (otpButtonRec.text !== undefined) {
    throw validationError(
      `Invalid ${HELPER_UPSERT_AUTH} input: otpButton.text is not allowed for authentication templates.`
    );
  }
  if (otpButtonRec.autofillText !== undefined) {
    throw validationError(
      `Invalid ${HELPER_UPSERT_AUTH} input: otpButton.autofillText is not allowed for authentication templates.`
    );
  }

  const button: Record<string, unknown> = { type: "OTP", otp_type: otpType };
  if (otpType === "COPY_CODE") {
    // supportedApps is NOT required for COPY_CODE; include only if present.
    if (otpButtonRec.supportedApps !== undefined) {
      button.supported_apps = normalizeUpsertAuthSupportedApps(
        otpButtonRec.supportedApps
      );
    }
  } else {
    // ONE_TAP / ZERO_TAP require supportedApps.
    if (otpButtonRec.supportedApps === undefined) {
      throw validationError(
        `Invalid ${HELPER_UPSERT_AUTH} input: otpButton.supportedApps is required for ${otpType} buttons.`
      );
    }
    button.supported_apps = normalizeUpsertAuthSupportedApps(
      otpButtonRec.supportedApps
    );
  }

  // BODY component (always present) with optional add_security_recommendation.
  const bodyComponent: Record<string, unknown> = { type: "BODY" };
  if (record.addSecurityRecommendation !== undefined) {
    bodyComponent.add_security_recommendation = assertUpsertAuthBoolean(
      record.addSecurityRecommendation,
      "addSecurityRecommendation"
    );
  }

  const components: Record<string, unknown>[] = [bodyComponent];

  // Optional FOOTER component carrying code_expiration_minutes.
  if (record.codeExpirationMinutes !== undefined) {
    const cem = assertCodeExpirationMinutes(record.codeExpirationMinutes);
    components.push({ type: "FOOTER", code_expiration_minutes: cem });
  }

  // BUTTONS component (always present) carrying the single OTP button.
  components.push({ type: "BUTTONS", buttons: [button] });

  const out: Record<string, unknown> = {
    name,
    languages,
    category: "AUTHENTICATION",
    components
  };

  if (record.messageSendTtlSeconds !== undefined) {
    out.message_send_ttl_seconds = assertNonNegativeInteger(
      record.messageSendTtlSeconds,
      "messageSendTtlSeconds"
    );
  }

  return out;
}

const upsertAuthenticationTemplateRaw = defineEndpoint<
  { wabaId: string },
  UpsertAuthenticationTemplateBody,
  UpsertAuthenticationTemplateResponse
>({
  method: "POST",
  pathTemplate: "/{wabaId}/upsert_message_templates",
  params: { wabaId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUpsertAuthenticationTemplateBody
});

/**
 * `POST /{wabaId}/upsert_message_templates` (WATS-160C). Upserts an
 * authentication message template (one or more languages) on a WABA.
 * Mirrors pywa's `WhatsApp.upsert_authentication_template`. Stricter than
 * {@link createMessageTemplate}: the body is a fixed camelCase descriptor
 * that the helper translates into the Graph AUTHENTICATION component
 * layout (BODY + optional FOOTER + BUTTONS with a single OTP button).
 *
 * All validation (descriptor-safe params/body, finite caps, otpType enum,
 * OTP-button strictness, codeExpirationMinutes range, messageSendTtlSeconds
 * non-negative integer) throws a `GraphRequestValidationError` before any
 * transport call.
 */
export const upsertAuthenticationTemplate = Object.assign(
  async function upsertAuthenticationTemplate(
    client: GraphClient,
    params: { readonly wabaId: string },
    body: UpsertAuthenticationTemplateBody,
    opts?: EndpointInvokeOptions
  ): Promise<UpsertAuthenticationTemplateResponse> {
    const record = assertPlainRecord(params, HELPER_UPSERT_AUTH, "params");
    return upsertAuthenticationTemplateRaw(
      client,
      { wabaId: assertString(record.wabaId, "wabaId", HELPER_UPSERT_AUTH) },
      body,
      opts
    );
  },
  { definition: upsertAuthenticationTemplateRaw.definition }
) as unknown as {
  (
    client: GraphClient,
    params: { readonly wabaId: string },
    body: UpsertAuthenticationTemplateBody,
    opts?: EndpointInvokeOptions
  ): Promise<UpsertAuthenticationTemplateResponse>;
  readonly definition: typeof upsertAuthenticationTemplateRaw.definition;
};
