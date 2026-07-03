// WATS-164: Telemetry sink seam for OpenTelemetry-compatible exporters.
//
// No @opentelemetry/* dependency in this file. The interface and constants are
// designed so that a user-owned adapter can bridge WATS telemetry into
// OpenTelemetry JS, Prometheus, structured logs, or any other backend.
//
// Internal metrics (the Prometheus registry used by /metrics) are fed through
// the same sink seam via MetricsBridgeTelemetrySink. Instrumentation code
// emits telemetry once; the bridge translates semantic attributes back into the
// internal Prometheus label model.

// Telemetry attributes are intentionally primitive and flat. Arrays and nested
// objects are not allowed so that every backend adapter can consume them
// without a bespoke schema.
export type TelemetryAttributeValue = string | number | boolean;

export type TelemetryAttributes = Readonly<Record<string, TelemetryAttributeValue>>;

export interface TelemetrySink {
  /** Increment a counter metric by `value`. */
  incrementCounter(name: string, value: number, attributes: TelemetryAttributes): void;

  /** Record a histogram observation in seconds. */
  recordHistogram(name: string, valueSeconds: number, attributes: TelemetryAttributes): void;

  /** Optionally emit a span. Called around significant operations when provided. */
  recordSpan?(name: string, start: Date, end: Date, attributes: TelemetryAttributes): void;

  /** Optionally emit a discrete event. */
  recordEvent?(name: string, attributes: TelemetryAttributes, timestamp?: Date): void;
}

/** Swallows every metric. Used when no user sink is configured. */
export const NOOP_TELEMETRY_SINK: TelemetrySink = {
  incrementCounter() {},
  recordHistogram() {},
};

// OpenTelemetry-compatible semantic attribute keys used on the sink interface.
// These are the raw names an adapter would see. Internal metrics are mapped to
// Prometheus-style label names by MetricsBridgeTelemetrySink below.
export const OTEL_ATTR = {
  httpRoute: "http.route",
  httpMethod: "http.request.method",
  httpStatusClass: "http.response.status.class",
  httpStatusCode: "http.response.status_code",
  webhookUpdateKind: "wats.webhook.update_kind",
  graphEndpointFamily: "wats.graph.endpoint_family",
  persistenceAdapter: "wats.persistence.adapter",
  persistenceState: "wats.persistence.state",
  operationOutcome: "wats.operation.outcome",
} as const;

export type OtelMetricName =
  | "http_requests_total"
  | "http_request_duration_seconds"
  | "webhook_normalization_total"
  | "graph_operations_total"
  | "send_outcomes_total"
  | "persistence_operations_total"
  | "outbox_depth";

// Prometheus-style label names used by the internal MetricsRegistry.
const INTERNAL_LABEL = {
  route: "route",
  method: "method",
  status_class: "status_class",
  update_kind: "update_kind",
  endpoint_family: "endpoint_family",
  outcome: "outcome",
  adapter: "adapter",
  state: "state",
} as const;

// Map each metric name to the OTel attribute keys that carry its internal label values.
const METRIC_LABEL_MAP: Record<
  OtelMetricName,
  Readonly<Record<string, keyof typeof INTERNAL_LABEL>>
> = {
  http_requests_total: {
    [OTEL_ATTR.httpRoute]: "route",
    [OTEL_ATTR.httpMethod]: "method",
    [OTEL_ATTR.httpStatusClass]: "status_class",
  },
  http_request_duration_seconds: {
    [OTEL_ATTR.httpRoute]: "route",
    [OTEL_ATTR.httpStatusClass]: "status_class",
  },
  webhook_normalization_total: {
    [OTEL_ATTR.webhookUpdateKind]: "update_kind",
    [OTEL_ATTR.operationOutcome]: "outcome",
  },
  graph_operations_total: {
    [OTEL_ATTR.graphEndpointFamily]: "endpoint_family",
    [OTEL_ATTR.httpStatusClass]: "status_class",
    [OTEL_ATTR.operationOutcome]: "outcome",
  },
  send_outcomes_total: {
    [OTEL_ATTR.graphEndpointFamily]: "endpoint_family",
    [OTEL_ATTR.operationOutcome]: "outcome",
  },
  persistence_operations_total: {
    [OTEL_ATTR.persistenceAdapter]: "adapter",
    [OTEL_ATTR.operationOutcome]: "outcome",
  },
  outbox_depth: {
    [OTEL_ATTR.persistenceAdapter]: "adapter",
    [OTEL_ATTR.persistenceState]: "state",
  },
};

// Attribute coercion helpers used by the bridge to normalize values.
function isAllowedAttributeValue(value: unknown): value is TelemetryAttributeValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Build a set of OTel-style attributes for an HTTP request.
 * `statusCode` is the actual numeric HTTP status; `statusClass` is a low-
 * cardinality bucket such as "2xx" or "5xx".
 */
export function httpTelemetryAttributes(route: string, method: string, statusCode: number, statusClass: string): TelemetryAttributes {
  return {
    [OTEL_ATTR.httpRoute]: route,
    [OTEL_ATTR.httpMethod]: method.toUpperCase(),
    [OTEL_ATTR.httpStatusCode]: statusCode,
    [OTEL_ATTR.httpStatusClass]: statusClass,
  };
}

export function graphTelemetryAttributes(endpointFamily: string, statusCode: number, statusClass: string, outcome: string): TelemetryAttributes {
  return {
    [OTEL_ATTR.graphEndpointFamily]: endpointFamily,
    [OTEL_ATTR.httpStatusCode]: statusCode,
    [OTEL_ATTR.httpStatusClass]: statusClass,
    [OTEL_ATTR.operationOutcome]: outcome,
  };
}

export function sendTelemetryAttributes(endpointFamily: string, outcome: string): TelemetryAttributes {
  return {
    [OTEL_ATTR.graphEndpointFamily]: endpointFamily,
    [OTEL_ATTR.operationOutcome]: outcome,
  };
}

export function webhookTelemetryAttributes(updateKind: string, outcome: string): TelemetryAttributes {
  return {
    [OTEL_ATTR.webhookUpdateKind]: updateKind,
    [OTEL_ATTR.operationOutcome]: outcome,
  };
}

export function persistenceTelemetryAttributes(adapter: string, outcome: string): TelemetryAttributes {
  return {
    [OTEL_ATTR.persistenceAdapter]: adapter,
    [OTEL_ATTR.operationOutcome]: outcome,
  };
}

export function outboxDepthTelemetryAttributes(adapter: string, state: string): TelemetryAttributes {
  return {
    [OTEL_ATTR.persistenceAdapter]: adapter,
    [OTEL_ATTR.persistenceState]: state,
  };
}

/**
 * A bounded, PII-safe sink wrapper that records nothing. Useful for tests that
 * want to count calls without driving a real backend.
 */
export class CapturingTelemetrySink implements TelemetrySink {
  readonly counters: Array<{ name: string; value: number; attributes: TelemetryAttributes }> = [];
  readonly histograms: Array<{ name: string; valueSeconds: number; attributes: TelemetryAttributes }> = [];
  readonly spans: Array<{ name: string; start: Date; end: Date; attributes: TelemetryAttributes }> = [];
  readonly events: Array<{ name: string; attributes: TelemetryAttributes; timestamp: Date }> = [];

  incrementCounter(name: string, value: number, attributes: TelemetryAttributes): void {
    this.counters.push({ name, value, attributes });
  }

  recordHistogram(name: string, valueSeconds: number, attributes: TelemetryAttributes): void {
    this.histograms.push({ name, valueSeconds, attributes });
  }

  recordSpan(name: string, start: Date, end: Date, attributes: TelemetryAttributes): void {
    this.spans.push({ name, start, end, attributes });
  }

  recordEvent(name: string, attributes: TelemetryAttributes, timestamp: Date = new Date()): void {
    this.events.push({ name, attributes, timestamp });
  }

  clear(): void {
    this.counters.length = 0;
    this.histograms.length = 0;
    this.spans.length = 0;
    this.events.length = 0;
  }
}
