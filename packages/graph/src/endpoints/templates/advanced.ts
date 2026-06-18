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
// Slice 1 scope: compare + unpause ONLY. migrate/archive/upsert/library
// land in subsequent WATS-153 slices.

import { defineEndpoint } from "../../endpoint.js";
import type { EndpointInvokeOptions } from "../../endpoint.js";
import type { GraphClient } from "../../client.js";
import { assertArray, assertPlainRecord, assertString } from "./shared.js";

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
