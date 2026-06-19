// WATS-153 advanced message-template helpers (slice 1: compare + unpause).
//
// These callables mirror pywa's `WhatsApp.compare_templates` and
// `WhatsApp.unpause_template`. Both are template-id scoped Graph edges
// (no WABA path prefix), layered on `defineEndpoint` so they inherit the
// F-6 path-param sanitizer (dot-segment / slash / control-char rejection)
// and the F-4 MockTransport testability contract.
//
// Reference notes (see REFERENCE-153.md):
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
import type { GraphClient } from "../../client.js";
import { assertArray, assertPlainRecord, assertString, validationError } from "./shared.js";

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
