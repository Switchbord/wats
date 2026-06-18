// WATS-153 slice 1 RED/GREEN behavioral tests for compareTemplates +
// unpauseTemplate. MockTransport only — no live calls.
//
// Covers: exact request path/query/body, response parsing (blockRate,
// timesSent, topBlockReason mapping + unknowns preserved), validation
// errors for missing/empty templateId/templateIds/start/end, unsafe
// path rejection, and WABAClient scoped method parity.

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  WABAClient,
  compareTemplates,
  unpauseTemplate,
  KNOWN_TEMPLATE_TOP_BLOCK_REASONS,
  type TemplateUnpauseResult,
  type TemplatesCompareResult
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(
  responses: MockTransportResponseSpec[] | MockTransportResponseSpec
) {
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

describe("WATS-153 compareTemplates", () => {
  test("GET /{templateId}/compare with comma-joined template_ids, start, end", async () => {
    const { client, handle } = clientWith(
      ok({
        data: [
          {
            metric: "BLOCK_RATE",
            type: "RELATIVE",
            order_by_relative_metric: ["tpl-B", "tpl-A", "tpl-C"]
          },
          {
            metric: "MESSAGE_SENDS",
            type: "NUMBER_VALUES",
            number_values: [
              { key: "tpl-A", value: 100 },
              { key: "tpl-B", value: 250 },
              { key: "tpl-C", value: 50 }
            ]
          },
          {
            metric: "TOP_BLOCK_REASON",
            type: "STRING_VALUES",
            string_values: [
              { key: "tpl-A", value: "SPAM" },
              { key: "tpl-B", value: "NO_LONGER_NEEDED" },
              { key: "tpl-C", value: "UNKNOWN_BLOCK_REASON" }
            ]
          }
        ],
        paging: { cursors: { before: "B", after: "A" } }
      })
    );

    const res: TemplatesCompareResult = await compareTemplates(client, {
      templateId: "tpl-A",
      templateIds: ["tpl-B", "tpl-C"],
      start: "1700000000",
      end: "1700003600"
    });

    // Request shape.
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/tpl-A/compare?template_ids=tpl-B%2Ctpl-C&start=1700000000&end=1700003600"
    );

    // Normalized fields.
    expect(res.blockRate).toEqual(["tpl-B", "tpl-A", "tpl-C"]);
    expect(res.timesSent).toEqual({
      "tpl-A": 100,
      "tpl-B": 250,
      "tpl-C": 50
    });
    expect(res.topBlockReason).toEqual({
      "tpl-A": "SPAM",
      "tpl-B": "NO_LONGER_NEEDED",
      "tpl-C": "UNKNOWN_BLOCK_REASON"
    });

    // Unknowns preserved (paging + raw data array).
    expect((res as Record<string, unknown>).paging).toEqual({
      cursors: { before: "B", after: "A" }
    });
    expect(Array.isArray(res.data)).toBe(true);
    expect((res.data as readonly unknown[]).length).toBe(3);
  });

  test("topBlockReason maps known reason enum values", () => {
    // Verify the exported enum matches pywa's TopBlockReasonType.
    expect(KNOWN_TEMPLATE_TOP_BLOCK_REASONS).toEqual([
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
    ]);
  });

  test("unknown topBlockReason values are preserved as raw strings", async () => {
    const { client } = clientWith(
      ok({
        data: [
          {
            metric: "TOP_BLOCK_REASON",
            type: "STRING_VALUES",
            string_values: [
              { key: "tpl-A", value: "NEW_UNDOCUMENTED_REASON" },
              { key: "tpl-B", value: "SPAM" }
            ]
          }
        ]
      })
    );
    const res = await compareTemplates(client, {
      templateId: "tpl-A",
      templateIds: ["tpl-B"],
      start: "1",
      end: "2"
    });
    expect(res.topBlockReason).toEqual({
      "tpl-A": "NEW_UNDOCUMENTED_REASON",
      "tpl-B": "SPAM"
    });
  });

  test("malformed metric entries are skipped without throwing", async () => {
    const { client } = clientWith(
      ok({
        data: [
          null,
          "not-an-object",
          { metric: "BLOCK_RATE", order_by_relative_metric: "not-an-array" },
          { metric: "MESSAGE_SENDS", number_values: [{ key: "x" }, { value: 5 }, "bad"] },
          { metric: "TOP_BLOCK_REASON", string_values: [{ key: 1, value: 2 }] },
          { metric: "UNKNOWN_METRIC", weird: true }
        ]
      })
    );
    const res = await compareTemplates(client, {
      templateId: "tpl-A",
      templateIds: ["tpl-B"],
      start: "1",
      end: "2"
    });
    expect(res.blockRate).toBeUndefined();
    expect(res.timesSent).toBeUndefined();
    expect(res.topBlockReason).toBeUndefined();
    // Unknown metric entry preserved via raw data array.
    expect(Array.isArray(res.data)).toBe(true);
  });

  test("empty/missing data array yields an empty normalized result", async () => {
    const { client } = clientWith(ok({}));
    const res = await compareTemplates(client, {
      templateId: "tpl-A",
      templateIds: ["tpl-B"],
      start: "1",
      end: "2"
    });
    expect(res.blockRate).toBeUndefined();
    expect(res.timesSent).toBeUndefined();
    expect(res.topBlockReason).toBeUndefined();
    expect(res.data).toBeUndefined();
  });

  test("rejects missing/empty templateId with GraphRequestValidationError", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      compareTemplates(client, {
        templateId: "",
        templateIds: ["tpl-B"],
        start: "1",
        end: "2"
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      compareTemplates(
        client,
        { templateId: "   ", templateIds: ["tpl-B"], start: "1", end: "2" } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects missing/empty templateIds with GraphRequestValidationError", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      compareTemplates(client, {
        templateId: "tpl-A",
        templateIds: [],
        start: "1",
        end: "2"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      compareTemplates(
        client,
        { templateId: "tpl-A", templateIds: undefined, start: "1", end: "2" } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects missing/empty start and end with GraphRequestValidationError", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      compareTemplates(
        client,
        { templateId: "tpl-A", templateIds: ["tpl-B"], start: "", end: "2" } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      compareTemplates(
        client,
        { templateId: "tpl-A", templateIds: ["tpl-B"], start: "1", end: "" } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unsafe templateId path values (dot-segment / slash / control char)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      compareTemplates(client, {
        templateId: "../evil",
        templateIds: ["tpl-B"],
        start: "1",
        end: "2"
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      compareTemplates(client, {
        templateId: "tpl/evil",
        templateIds: ["tpl-B"],
        start: "1",
        end: "2"
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      compareTemplates(client, {
        templateId: "tpl\n1",
        templateIds: ["tpl-B"],
        start: "1",
        end: "2"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params and accessor-backed params with typed errors", async () => {
    const { client, handle } = clientWith(ok());
    await expect(compareTemplates(client, null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(compareTemplates(client, "x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    // Accessor-backed templateId must not trigger a host TypeError.
    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "templateId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    accessorParams.templateIds = ["tpl-B"];
    accessorParams.start = "1";
    accessorParams.end = "2";
    await expect(
      compareTemplates(client, accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects over-cap templateIds array", async () => {
    const { client, handle } = clientWith(ok());
    const tooMany = Array.from({ length: 201 }, (_, i) => `tpl-${i}`);
    await expect(
      compareTemplates(client, {
        templateId: "tpl-A",
        templateIds: tooMany,
        start: "1",
        end: "2"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-153 unpauseTemplate", () => {
  test("POST /{templateId}/unpause with no body, returns typed result", async () => {
    const { client, handle } = clientWith(ok({ success: true }));
    const res: TemplateUnpauseResult = await unpauseTemplate(client, {
      templateId: "tpl-A"
    });
    expect(res.success).toBe(true);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/tpl-A/unpause"
    );
    // No body for unpause.
    expect(handle.requests[0]?.body).toBeNull();
  });

  test("preserves unknown fields and reason in the response", async () => {
    const { client } = clientWith(
      ok({ success: false, reason: "template not paused", id: "tpl-A", extra: 42 })
    );
    const res = await unpauseTemplate(client, { templateId: "tpl-A" });
    expect(res.success).toBe(false);
    expect(res.reason).toBe("template not paused");
    expect((res as Record<string, unknown>).id).toBe("tpl-A");
    expect((res as Record<string, unknown>).extra).toBe(42);
  });

  test("rejects missing/empty templateId with GraphRequestValidationError", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      unpauseTemplate(client, { templateId: "" } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      unpauseTemplate(client, { templateId: "  " } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unsafe templateId path values", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      unpauseTemplate(client, { templateId: "../evil" } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      unpauseTemplate(client, { templateId: "tpl#evil" } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params and accessor-backed params with typed errors", async () => {
    const { client, handle } = clientWith(ok());
    await expect(unpauseTemplate(client, null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(unpauseTemplate(client, undefined as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "templateId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      unpauseTemplate(client, accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-153 WABAClient scoped methods", () => {
  test("compareTemplates delegates to the endpoint callable (template-id scoped)", async () => {
    const { client, handle } = clientWith([
      ok({ data: [{ metric: "BLOCK_RATE", order_by_relative_metric: ["tpl-B"] }] })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const res = await waba.compareTemplates({
      templateId: "tpl-A",
      templateIds: ["tpl-B"],
      start: "1",
      end: "2"
    });
    expect(res.blockRate).toEqual(["tpl-B"]);
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/tpl-A/compare?template_ids=tpl-B&start=1&end=2"
    );
  });

  test("unpauseTemplate delegates to the endpoint callable (template-id scoped)", async () => {
    const { client, handle } = clientWith([ok({ success: true })]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const res = await waba.unpauseTemplate({ templateId: "tpl-A" });
    expect(res.success).toBe(true);
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/tpl-A/unpause"
    );
  });

  test("WABAClient methods reject unsafe templateId before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(
      waba.compareTemplates({
        templateId: "../evil",
        templateIds: ["tpl-B"],
        start: "1",
        end: "2"
      })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      waba.unpauseTemplate({ templateId: "tpl/x" } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});
