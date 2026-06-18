// WATS-154 WhatsApp Flow metrics & migration helpers (slice 1).
//
// These callables mirror pywa's `WhatsApp.get_flow_metric` /
// `WhatsApp.migrate_flows`. Both are layered on `defineEndpoint` so they
// inherit the F-6 path-param sanitizer (dot-segment / slash / control-char
// rejection) and the F-4 MockTransport testability contract.
//
// Reference notes (see REFERENCE-154.md):
//  - metrics: pywa calls get_flow(...fields=(metricField,)) and returns
//    response["metric"]. The field string is built as
//    `metric.name({NAME}).granularity({G}).since({S}).until({U})`.
//    WATS sends uppercase granularity values (pywa enum parity); Meta's
//    docs example uses lowercase and the case acceptance is UNVERIFIED.
//    The Metrics API is documented as deprecated 2026-04-30; whether a
//    replacement exists is UNVERIFIED.
//  - migrate: pywa sends source_flow_names as a comma-joined string.
//    Meta docs imply an array-ish form but we follow pywa parity. Names
//    may contain commas only as separators, so each name rejects commas
//    to keep the wire unambiguous.
//
// Slice 1 scope: metrics + migrate ONLY. clone / assets / health_status
// already landed in earlier slices.

import { defineEndpoint } from "../../endpoint.js";
import type { EndpointInvokeOptions } from "../../endpoint.js";
import type { GraphClient } from "../../client.js";
import type {
  FlowMetric,
  FlowMetricDataPoint,
  FlowMetricResponse,
  GetFlowMetricsInput,
  MigrateFlowsInput,
  MigrateFlowsResponse,
  MigratedFlow,
  MigratedFlowError
} from "./types.js";
import {
  KNOWN_FLOW_METRIC_GRANULARITIES,
  KNOWN_FLOW_METRIC_NAMES,
  MIGRATE_FLOWS_MAX_NAMES,
  MIGRATE_FLOWS_NAME_MAX_LENGTH
} from "./types.js";
import {
  flowArray,
  flowAssertPlainRecord,
  flowError,
  flowHasControlChar,
  flowString
} from "./shared.js";

// ---------------------------------------------------------------------------
// getFlowMetrics
// ---------------------------------------------------------------------------

const HELPER_METRICS = "getFlowMetrics";
const KNOWN_METRIC_NAME_SET: ReadonlySet<string> = new Set(
  KNOWN_FLOW_METRIC_NAMES
);
const KNOWN_GRANULARITY_SET: ReadonlySet<string> = new Set(
  KNOWN_FLOW_METRIC_GRANULARITIES
);

const DATE_REGEXP = /^\d{4}-\d{2}-\d{2}$/;

function assertKnownMetricName(value: string): void {
  if (!KNOWN_METRIC_NAME_SET.has(value)) {
    throw flowError(
      `Invalid ${HELPER_METRICS} input: name must be one of ${KNOWN_FLOW_METRIC_NAMES.join(", ")} (got ${JSON.stringify(value)}).`
    );
  }
}

function assertKnownGranularity(value: string): void {
  if (!KNOWN_GRANULARITY_SET.has(value)) {
    throw flowError(
      `Invalid ${HELPER_METRICS} input: granularity must be one of ${KNOWN_FLOW_METRIC_GRANULARITIES.join(", ")} (got ${JSON.stringify(value)}).`
    );
  }
}

function assertDateString(value: string, fieldName: "since" | "until"): void {
  if (!DATE_REGEXP.test(value)) {
    throw flowError(
      `Invalid ${HELPER_METRICS} input: ${fieldName} must be a YYYY-MM-DD string (got ${JSON.stringify(value)}).`
    );
  }
  if (flowHasControlChar(value)) {
    throw flowError(
      `Invalid ${HELPER_METRICS} input: ${fieldName} must not contain control characters.`
    );
  }
}

/**
 * Build the exact Graph `fields` string for a Flow metrics request:
 * `metric.name({NAME}).granularity({G}).since({S}).until({U})` with the
 * optional `.since(...)`/`.until(...)` segments omitted when not provided.
 *
 * Rejects unknown metric/granularity, malformed date strings, control
 * characters, and unsafe id values. Returns the assembled field string
 * ready to be sent as the `fields` query parameter.
 */
export function buildFlowMetricField(input: GetFlowMetricsInput): string {
  const record = flowAssertPlainRecord(input, HELPER_METRICS, "input");
  const name = flowString(record.name, "name", HELPER_METRICS, 128);
  assertKnownMetricName(name);
  const granularity = flowString(record.granularity, "granularity", HELPER_METRICS, 32);
  assertKnownGranularity(granularity);
  const since = record.since === undefined ? undefined : flowString(record.since, "since", HELPER_METRICS, 16);
  const until = record.until === undefined ? undefined : flowString(record.until, "until", HELPER_METRICS, 16);
  if (since !== undefined) assertDateString(since, "since");
  if (until !== undefined) assertDateString(until, "until");

  let field = `metric.name(${name}).granularity(${granularity})`;
  if (since !== undefined) field += `.since(${since})`;
  if (until !== undefined) field += `.until(${until})`;
  return field;
}

function normalizeFlowMetricsParams(input: GetFlowMetricsInput): Record<string, string> {
  const record = flowAssertPlainRecord(input, HELPER_METRICS, "params");
  const flowId = flowString(record.flowId, "flowId", HELPER_METRICS);
  const fields = buildFlowMetricField(input);
  return { flowId, fields };
}

interface MetricRawResponse {
  readonly metric?: FlowMetricResponse["metric"];
  readonly [key: string]: unknown;
}

/**
 * Parse the raw Graph `GET /{flowId}?fields=metric...` response into a typed
 * {@link FlowMetric}. The `data_points` array is camelCased to `dataPoints`;
 * unknown fields (including the top-level `id`) are preserved verbatim.
 * Malformed data point entries are preserved as raw objects rather than
 * thrown, because the Meta response shape is only partially documented.
 */
function parseFlowMetric(raw: MetricRawResponse): FlowMetric {
  const out: Record<string, unknown> = {};
  if (raw !== null && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key !== "metric") out[key] = value;
    }
  }
  const metric = (raw as MetricRawResponse | null | undefined)?.metric;
  if (metric !== null && typeof metric === "object" && metric !== undefined) {
    const metricRec = metric as Record<string, unknown>;
    if (typeof metricRec.name === "string") out.name = metricRec.name;
    if (typeof metricRec.granularity === "string") out.granularity = metricRec.granularity;
    const dataPoints = metricRec.data_points;
    if (Array.isArray(dataPoints)) {
      out.dataPoints = dataPoints.map((entry) => normalizeDataPoint(entry)) as readonly FlowMetricDataPoint[];
    }
    for (const [key, value] of Object.entries(metricRec)) {
      if (key === "name" || key === "granularity" || key === "data_points") continue;
      out[key] = value;
    }
  }
  return out as unknown as FlowMetric;
}

function normalizeDataPoint(entry: unknown): FlowMetricDataPoint {
  if (entry === null || typeof entry !== "object") return entry as FlowMetricDataPoint;
  const rec = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof rec.timestamp === "string") out.timestamp = rec.timestamp;
  if (Array.isArray(rec.data)) {
    out.data = rec.data.map((item) => item) as readonly { key?: string; value?: unknown }[];
  }
  for (const [key, value] of Object.entries(rec)) {
    if (key === "timestamp" || key === "data") continue;
    out[key] = value;
  }
  return out as FlowMetricDataPoint;
}

const getFlowMetricsRaw = defineEndpoint<
  { flowId: string; fields: string },
  never,
  FlowMetricResponse
>({
  method: "GET",
  pathTemplate: "/{flowId}",
  params: {
    flowId: { in: "path", required: true },
    fields: { in: "query", required: true }
  }
});

export const getFlowMetrics = Object.assign(
  async function getFlowMetrics(
    client: GraphClient,
    params: GetFlowMetricsInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<FlowMetric> {
    const normalized = normalizeFlowMetricsParams(params);
    const raw = await getFlowMetricsRaw(
      client,
      normalized as Parameters<typeof getFlowMetricsRaw>[1],
      body,
      opts
    );
    return parseFlowMetric(raw as unknown as MetricRawResponse);
  },
  { definition: getFlowMetricsRaw.definition }
) as unknown as {
  (client: GraphClient, params: GetFlowMetricsInput, body?: never, opts?: EndpointInvokeOptions): Promise<FlowMetric>;
  readonly definition: typeof getFlowMetricsRaw.definition;
};

// ---------------------------------------------------------------------------
// migrateFlows
// ---------------------------------------------------------------------------

const HELPER_MIGRATE = "migrateFlows";

function normalizeMigrateFlowsParams(input: MigrateFlowsInput): Record<string, string> {
  const record = flowAssertPlainRecord(input, HELPER_MIGRATE, "params");
  const destinationWabaId = flowString(record.destinationWabaId, "destinationWabaId", HELPER_MIGRATE);
  const sourceWabaId = flowString(record.sourceWabaId, "sourceWabaId", HELPER_MIGRATE);
  const namesArr = flowArray(
    record.sourceFlowNames,
    "sourceFlowNames",
    1,
    MIGRATE_FLOWS_MAX_NAMES,
    HELPER_MIGRATE
  );
  const names: string[] = [];
  for (let index = 0; index < namesArr.length; index += 1) {
    const raw = namesArr[index];
    const name = flowString(raw, `sourceFlowNames[${index}]`, HELPER_MIGRATE, MIGRATE_FLOWS_NAME_MAX_LENGTH);
    if (name.includes(",")) {
      throw flowError(
        `Invalid ${HELPER_MIGRATE} input: sourceFlowNames[${index}] must not contain a comma (comma is the wire separator).`
      );
    }
    names.push(name);
  }
  return {
    destinationWabaId,
    source_waba_id: sourceWabaId,
    source_flow_names: names.join(",")
  };
}

interface MigrateRawResponse {
  readonly migrated_flows?: readonly unknown[];
  readonly failed_flows?: readonly unknown[];
  readonly [key: string]: unknown;
}

/**
 * Parse the raw Graph `POST /{destinationWabaId}/migrate_flows` response
 * into a typed {@link MigrateFlowsResponse}. Snake-case `migrated_flows` /
 * `failed_flows` arrays are camelCased; unknown response fields are
 * preserved verbatim via the index signature. Each entry is normalized to
 * the {@link MigratedFlow} / {@link MigratedFlowError} shape with unknowns
 * preserved; malformed entries are still included as best-effort objects
 * (no throwing) because the Meta response shape is only partially
 * documented.
 */
function parseMigrateFlowsResponse(raw: MigrateRawResponse): MigrateFlowsResponse {
  const out: Record<string, unknown> = {};
  if (raw !== null && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key !== "migrated_flows" && key !== "failed_flows") out[key] = value;
    }
  }
  const migrated = (raw as MigrateRawResponse | null | undefined)?.migrated_flows;
  if (Array.isArray(migrated)) {
    out.migratedFlows = migrated.map((entry) => normalizeMigratedFlow(entry)) as readonly MigratedFlow[];
  }
  const failed = (raw as MigrateRawResponse | null | undefined)?.failed_flows;
  if (Array.isArray(failed)) {
    out.failedFlows = failed.map((entry) => normalizeMigratedFlowError(entry)) as readonly MigratedFlowError[];
  }
  return out as unknown as MigrateFlowsResponse;
}

function normalizeMigratedFlow(entry: unknown): MigratedFlow {
  if (entry === null || typeof entry !== "object") return entry as MigratedFlow;
  const rec = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof rec.source_name === "string") out.sourceName = rec.source_name;
  if (typeof rec.source_id === "string") out.sourceId = rec.source_id;
  if (typeof rec.migrated_id === "string") out.migratedId = rec.migrated_id;
  for (const [key, value] of Object.entries(rec)) {
    if (key === "source_name" || key === "source_id" || key === "migrated_id") continue;
    out[key] = value;
  }
  return out as MigratedFlow;
}

function normalizeMigratedFlowError(entry: unknown): MigratedFlowError {
  if (entry === null || typeof entry !== "object") return entry as MigratedFlowError;
  const rec = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof rec.source_name === "string") out.sourceName = rec.source_name;
  if (rec.error_code !== undefined) out.errorCode = rec.error_code;
  if (typeof rec.error_message === "string") out.errorMessage = rec.error_message;
  for (const [key, value] of Object.entries(rec)) {
    if (key === "source_name" || key === "error_code" || key === "error_message") continue;
    out[key] = value;
  }
  return out as MigratedFlowError;
}

const migrateFlowsRaw = defineEndpoint<
  { destinationWabaId: string; source_waba_id: string; source_flow_names: string },
  never,
  MigrateRawResponse
>({
  method: "POST",
  pathTemplate: "/{destinationWabaId}/migrate_flows",
  params: {
    destinationWabaId: { in: "path", required: true },
    source_waba_id: { in: "query", required: true },
    source_flow_names: { in: "query", required: true }
  }
});

export const migrateFlows = Object.assign(
  async function migrateFlows(
    client: GraphClient,
    params: MigrateFlowsInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<MigrateFlowsResponse> {
    const normalized = normalizeMigrateFlowsParams(params);
    const raw = await migrateFlowsRaw(
      client,
      normalized as Parameters<typeof migrateFlowsRaw>[1],
      body,
      opts
    );
    return parseMigrateFlowsResponse(raw as unknown as MigrateRawResponse);
  },
  { definition: migrateFlowsRaw.definition }
) as unknown as {
  (client: GraphClient, params: MigrateFlowsInput, body?: never, opts?: EndpointInvokeOptions): Promise<MigrateFlowsResponse>;
  readonly definition: typeof migrateFlowsRaw.definition;
};
