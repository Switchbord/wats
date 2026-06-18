// WATS-154 slice 1 RED/GREEN behavioral tests for getFlowMetrics +
// migrateFlows. MockTransport only — no live calls.
//
// Covers: exact request path/query/body (metric field string, comma-joined
// source_flow_names), response normalization (data_points → dataPoints,
// migrated_flows → migratedFlows, failed_flows → failedFlows, unknowns
// preserved), validation errors for missing/empty/unknown metric/granularity,
// malformed YYYY-MM-DD since/until, unsafe path values, sourceFlowNames
// over-cap / empty / comma / control chars / accessors, and WABAClient
// scoped-method parity (bound wabaId as destination).

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  WABAClient,
  buildFlowMetricField,
  getFlowMetrics,
  migrateFlows,
  KNOWN_FLOW_METRIC_GRANULARITIES,
  KNOWN_FLOW_METRIC_NAMES,
  MIGRATE_FLOWS_MAX_NAMES,
  type FlowMetric,
  type MigrateFlowsResponse
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec) {
  const handle = createMockTransport(
    Array.isArray(responses) ? { responses } : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function ok(body: object = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

describe("WATS-154 enum exports", () => {
  test("KNOWN_FLOW_METRIC_NAMES matches pywa FlowMetricName", () => {
    expect(KNOWN_FLOW_METRIC_NAMES).toEqual([
      "ENDPOINT_REQUEST_COUNT",
      "ENDPOINT_REQUEST_ERROR",
      "ENDPOINT_REQUEST_ERROR_RATE",
      "ENDPOINT_REQUEST_LATENCY_SECONDS_CEIL",
      "ENDPOINT_AVAILABILITY"
    ]);
  });

  test("KNOWN_FLOW_METRIC_GRANULARITIES matches pywa FlowMetricGranularity", () => {
    expect(KNOWN_FLOW_METRIC_GRANULARITIES).toEqual(["DAY", "HOUR", "LIFETIME"]);
  });

  test("MIGRATE_FLOWS_MAX_NAMES is 100", () => {
    expect(MIGRATE_FLOWS_MAX_NAMES).toBe(100);
  });
});

describe("WATS-154 buildFlowMetricField", () => {
  test("builds the exact field string with optional since/until omitted", () => {
    expect(
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "DAY"
      })
    ).toBe("metric.name(ENDPOINT_REQUEST_COUNT).granularity(DAY)");
  });

  test("includes .since(...) when since provided", () => {
    expect(
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_ERROR",
        granularity: "HOUR",
        since: "2026-01-01"
      })
    ).toBe("metric.name(ENDPOINT_REQUEST_ERROR).granularity(HOUR).since(2026-01-01)");
  });

  test("includes both .since(...) and .until(...)", () => {
    expect(
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_AVAILABILITY",
        granularity: "LIFETIME",
        since: "2026-01-01",
        until: "2026-02-01"
      })
    ).toBe(
      "metric.name(ENDPOINT_AVAILABILITY).granularity(LIFETIME).since(2026-01-01).until(2026-02-01)"
    );
  });

  test("rejects unknown metric name with typed error", () => {
    expect(() =>
      buildFlowMetricField({
        flowId: "flow1",
        name: "UNKNOWN_METRIC" as never,
        granularity: "DAY"
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects unknown granularity with typed error", () => {
    expect(() =>
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "MINUTE" as never
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects malformed YYYY-MM-DD since/until", () => {
    expect(() =>
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "DAY",
        since: "2026/01/01" as never
      })
    ).toThrow(GraphRequestValidationError);
    expect(() =>
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "DAY",
        until: "not-a-date" as never
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects control chars in name/granularity/since/until", () => {
    expect(() =>
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT\n",
        granularity: "DAY"
      } as never)
    ).toThrow(GraphRequestValidationError);
    expect(() =>
      buildFlowMetricField({
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "DAY\r" as never
      })
    ).toThrow(GraphRequestValidationError);
  });

  test("rejects non-object and accessor-backed input with typed errors", () => {
    expect(() => buildFlowMetricField(null as never)).toThrow(GraphRequestValidationError);
    expect(() => buildFlowMetricField("x" as never)).toThrow(GraphRequestValidationError);

    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "name", {
      enumerable: true,
      get() {
        throw new TypeError("name getter should not run");
      }
    });
    accessorParams.flowId = "flow1";
    accessorParams.granularity = "DAY";
    expect(() => buildFlowMetricField(accessorParams as never)).toThrow(
      GraphRequestValidationError
    );
  });
});

describe("WATS-154 getFlowMetrics", () => {
  test("GETs /{flowId} with exact metric field string and normalizes response", async () => {
    const { client, handle } = clientWith(
      ok({
        id: "flow1",
        metric: {
          name: "ENDPOINT_REQUEST_COUNT",
          granularity: "DAY",
          data_points: [
            { timestamp: "2026-06-01", data: [{ key: "value", value: 42 }] },
            { timestamp: "2026-06-02", data: [{ key: "value", value: 7 }] }
          ]
        },
        extra: "preserved"
      })
    );

    const res: FlowMetric = await getFlowMetrics(client, {
      flowId: "flow1",
      name: "ENDPOINT_REQUEST_COUNT",
      granularity: "DAY",
      since: "2026-06-01",
      until: "2026-06-30"
    });

    // Exact request shape.
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/flow1?fields=metric.name%28ENDPOINT_REQUEST_COUNT%29.granularity%28DAY%29.since%282026-06-01%29.until%282026-06-30%29"
    );

    // Normalized fields (snake_case data_points → camelCase dataPoints).
    expect(res.name).toBe("ENDPOINT_REQUEST_COUNT");
    expect(res.granularity).toBe("DAY");
    expect(res.dataPoints).toEqual([
      { timestamp: "2026-06-01", data: [{ key: "value", value: 42 }] },
      { timestamp: "2026-06-02", data: [{ key: "value", value: 7 }] }
    ]);

    // Unknown top-level fields preserved (id + extra).
    expect((res as Record<string, unknown>).id).toBe("flow1");
    expect((res as Record<string, unknown>).extra).toBe("preserved");
  });

  test("omits .since(...)/.until(...) when those params are absent", async () => {
    const { client, handle } = clientWith(ok({ id: "flow1", metric: { name: "ENDPOINT_REQUEST_COUNT", granularity: "LIFETIME", data_points: [] } }));
    await getFlowMetrics(client, {
      flowId: "flow1",
      name: "ENDPOINT_REQUEST_COUNT",
      granularity: "LIFETIME"
    });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/flow1?fields=metric.name%28ENDPOINT_REQUEST_COUNT%29.granularity%28LIFETIME%29"
    );
  });

  test("preserves metric-unknown fields and tolerates malformed data_points entries", async () => {
    const { client } = clientWith(
      ok({
        id: "flow1",
        metric: {
          name: "ENDPOINT_REQUEST_ERROR",
          granularity: "HOUR",
          data_points: [
            { timestamp: "2026-06-01T00:00:00", data: [{ key: "timeout_error", value: 3 }] },
            null,
            "not-an-object"
          ],
          extra_metric_field: "kept"
        }
      })
    );
    const res = await getFlowMetrics(client, {
      flowId: "flow1",
      name: "ENDPOINT_REQUEST_ERROR",
      granularity: "HOUR"
    });
    expect(res.dataPoints?.length).toBe(3);
    expect((res as Record<string, unknown>).extra_metric_field).toBe("kept");
  });

  test("returns a normalized result when metric is absent", async () => {
    const { client } = clientWith(ok({ id: "flow1", something: "else" }));
    const res = await getFlowMetrics(client, {
      flowId: "flow1",
      name: "ENDPOINT_REQUEST_COUNT",
      granularity: "DAY"
    });
    expect(res.name).toBeUndefined();
    expect(res.dataPoints).toBeUndefined();
    expect((res as Record<string, unknown>).something).toBe("else");
  });

  test("rejects unknown metric name before transport", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      getFlowMetrics(client, {
        flowId: "flow1",
        name: "BOGUS_METRIC",
        granularity: "DAY"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unknown granularity before transport", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      getFlowMetrics(client, {
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "WEEK"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects malformed since/until before transport", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      getFlowMetrics(client, {
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "DAY",
        since: "2026/06/01"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      getFlowMetrics(client, {
        flowId: "flow1",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "DAY",
        until: "not-a-date"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unsafe flowId path values (dot-segment / slash / control)", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of ["", "   ", "../evil", "flow/evil", "flow\n1"] as const) {
      await expect(
        getFlowMetrics(client, {
          flowId: bad,
          name: "ENDPOINT_REQUEST_COUNT",
          granularity: "DAY"
        } as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params and accessor-backed params with typed errors (no host TypeError)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(getFlowMetrics(client, null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(getFlowMetrics(client, "x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "flowId", {
      enumerable: true,
      get() {
        throw new TypeError("flowId getter should not run");
      }
    });
    accessorParams.name = "ENDPOINT_REQUEST_COUNT";
    accessorParams.granularity = "DAY";
    await expect(
      getFlowMetrics(client, accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-154 migrateFlows", () => {
  test("POSTs /{destinationWabaId}/migrate_flows with comma-joined source_flow_names and normalizes response", async () => {
    const { client, handle } = clientWith(
      ok({
        migrated_flows: [
          { source_name: "welcome_flow", source_id: "111", migrated_id: "222" },
          { source_name: "checkout_flow", source_id: "333", migrated_id: "444" }
        ],
        failed_flows: [
          { source_name: "blocked_flow", error_code: 139100, error_message: "name collision" }
        ],
        extra: "preserved"
      })
    );

    const res: MigrateFlowsResponse = await migrateFlows(client, {
      destinationWabaId: "dst-waba",
      sourceWabaId: "src-waba",
      sourceFlowNames: ["welcome_flow", "checkout_flow"]
    });

    // Exact request shape.
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/dst-waba/migrate_flows?source_waba_id=src-waba&source_flow_names=welcome_flow%2Ccheckout_flow"
    );
    // No body for migrate_flows.
    expect(handle.requests[0]?.body).toBeNull();

    // Normalized camelCase arrays.
    expect(res.migratedFlows).toEqual([
      { sourceName: "welcome_flow", sourceId: "111", migratedId: "222" },
      { sourceName: "checkout_flow", sourceId: "333", migratedId: "444" }
    ]);
    expect(res.failedFlows).toEqual([
      { sourceName: "blocked_flow", errorCode: 139100, errorMessage: "name collision" }
    ]);

    // Unknown top-level fields preserved.
    expect((res as Record<string, unknown>).extra).toBe("preserved");
  });

  test("preserves migrated/failed entry unknown fields", async () => {
    const { client } = clientWith(
      ok({
        migrated_flows: [
          { source_name: "flowA", source_id: "1", migrated_id: "2", extra_field: "kept" }
        ],
        failed_flows: [
          { source_name: "flowB", error_code: "ERR_CODE_STR", error_message: "msg", notes: 7 }
        ]
      })
    );
    const res = await migrateFlows(client, {
      destinationWabaId: "dst",
      sourceWabaId: "src",
      sourceFlowNames: ["flowA"]
    });
    expect((res.migratedFlows?.[0] as Record<string, unknown>).extra_field).toBe("kept");
    expect((res.failedFlows?.[0] as Record<string, unknown>).notes).toBe(7);
    expect(res.failedFlows?.[0].errorCode).toBe("ERR_CODE_STR");
  });

  test("tolerates malformed migrated/failed entries without throwing", async () => {
    const { client } = clientWith(
      ok({
        migrated_flows: [null, "not-an-object", { source_name: "ok", migrated_id: "1" }],
        failed_flows: ["bad"]
      })
    );
    const res = await migrateFlows(client, {
      destinationWabaId: "dst",
      sourceWabaId: "src",
      sourceFlowNames: ["ok"]
    });
    expect(res.migratedFlows?.length).toBe(3);
    expect(res.migratedFlows?.[2]).toEqual({ sourceName: "ok", migratedId: "1" });
    expect(res.failedFlows?.length).toBe(1);
  });

  test("returns empty normalized result when arrays are absent", async () => {
    const { client } = clientWith(ok({ success: true }));
    const res = await migrateFlows(client, {
      destinationWabaId: "dst",
      sourceWabaId: "src",
      sourceFlowNames: ["flowA"]
    });
    expect(res.migratedFlows).toBeUndefined();
    expect(res.failedFlows).toBeUndefined();
    expect((res as Record<string, unknown>).success).toBe(true);
  });

  test("URL-encodes source_flow_names containing special-but-safe characters", async () => {
    const { client, handle } = clientWith(ok({}));
    await migrateFlows(client, {
      destinationWabaId: "dst",
      sourceWabaId: "src",
      sourceFlowNames: ["flow with spaces", "dashes-flow"]
    });
    // URLSearchParams encodes spaces as `+` (form encoding); commas as %2C.
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/dst/migrate_flows?source_waba_id=src&source_flow_names=flow+with+spaces%2Cdashes-flow"
    );
  });

  test("rejects missing/empty destinationWabaId / sourceWabaId", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      migrateFlows(client, {
        destinationWabaId: "",
        sourceWabaId: "src",
        sourceFlowNames: ["a"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateFlows(client, {
        destinationWabaId: "   ",
        sourceWabaId: "src",
        sourceFlowNames: ["a"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst",
        sourceWabaId: "",
        sourceFlowNames: ["a"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unsafe destinationWabaId path values", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      migrateFlows(client, {
        destinationWabaId: "../evil",
        sourceWabaId: "src",
        sourceFlowNames: ["a"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst/x",
        sourceWabaId: "src",
        sourceFlowNames: ["a"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst\n",
        sourceWabaId: "src",
        sourceFlowNames: ["a"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects empty sourceFlowNames array and over-cap (101) array", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst",
        sourceWabaId: "src",
        sourceFlowNames: []
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    const tooMany = Array.from({ length: MIGRATE_FLOWS_MAX_NAMES + 1 }, (_, i) => `flow_${i}`);
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst",
        sourceWabaId: "src",
        sourceFlowNames: tooMany
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects empty / control-char / comma-containing sourceFlowNames entries", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst",
        sourceWabaId: "src",
        sourceFlowNames: ["ok", ""]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst",
        sourceWabaId: "src",
        sourceFlowNames: ["ok", "bad\nname"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    // Comma is the wire separator: a name containing a comma is ambiguous.
    await expect(
      migrateFlows(client, {
        destinationWabaId: "dst",
        sourceWabaId: "src",
        sourceFlowNames: ["name,with,commas"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params and accessor-backed params with typed errors (no host TypeError)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(migrateFlows(client, null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(migrateFlows(client, "x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "destinationWabaId", {
      enumerable: true,
      get() {
        throw new TypeError("destinationWabaId getter should not run");
      }
    });
    accessorParams.sourceWabaId = "src";
    accessorParams.sourceFlowNames = ["a"];
    await expect(
      migrateFlows(client, accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-154 WABAClient scoped methods", () => {
  test("getFlowMetrics delegates to the endpoint callable (flow-id scoped)", async () => {
    const { client, handle } = clientWith(
      ok({ id: "flow1", metric: { name: "ENDPOINT_REQUEST_COUNT", granularity: "DAY", data_points: [{ timestamp: "2026-06-01", data: [{ key: "value", value: 5 }] }] } })
    );
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const res = await waba.getFlowMetrics({
      flowId: "flow1",
      name: "ENDPOINT_REQUEST_COUNT",
      granularity: "DAY"
    });
    expect(res.dataPoints?.[0]?.data?.[0]?.value).toBe(5);
    // Bound wabaId is NOT in the URL — flow-id scoped path.
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/flow1?fields=metric.name%28ENDPOINT_REQUEST_COUNT%29.granularity%28DAY%29"
    );
  });

  test("migrateFlows injects the bound wabaId as destination", async () => {
    const { client, handle } = clientWith(
      ok({ migrated_flows: [{ source_name: "flowA", source_id: "1", migrated_id: "2" }] })
    );
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-DST-WABA" });
    const res = await waba.migrateFlows({
      sourceWabaId: "src-waba",
      sourceFlowNames: ["flowA", "flowB"]
    });
    expect(res.migratedFlows?.[0]?.migratedId).toBe("2");
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/BOUND-DST-WABA/migrate_flows?source_waba_id=src-waba&source_flow_names=flowA%2CflowB"
    );
  });

  test("WABAClient.migrateFlows ignores any caller-supplied destinationWabaId (bound id wins)", async () => {
    const { client, handle } = clientWith(ok({}));
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND" });
    // Caller tries to override destination via spread — bound id must win.
    await waba.migrateFlows({
      sourceWabaId: "src",
      sourceFlowNames: ["a"],
      destinationWabaId: "ATTACKER"
    } as never);
    expect(handle.requests[0]?.url).toContain("/BOUND/migrate_flows");
    expect(handle.requests[0]?.url).not.toContain("/ATTACKER/migrate_flows");
  });

  test("WABAClient Flow metrics/migrate methods reject unsafe params before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND" });
    await expect(
      waba.getFlowMetrics({
        flowId: "../evil",
        name: "ENDPOINT_REQUEST_COUNT",
        granularity: "DAY"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      waba.migrateFlows({
        sourceWabaId: "src",
        sourceFlowNames: []
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("WABAClient.migrateFlows rejects accessor-backed params without invoking getters", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND" });
    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "sourceWabaId", {
      enumerable: true,
      get() {
        throw new TypeError("sourceWabaId getter should not run");
      }
    });
    accessorParams.sourceFlowNames = ["a"];
    await expect(waba.migrateFlows(accessorParams as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    expect(handle.requests.length).toBe(0);
  });
});
