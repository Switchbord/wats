// WATS-160B RED/GREEN behavioral tests for archiveTemplates /
// unarchiveTemplates. MockTransport only — no live calls.
//
// Covers: exact raw URL on api.facebook.com (NOT graph.facebook.com), method
// POST, JSON body { hsm_ids: [...] }, auth managed by GraphClient (Bearer
// header injected, caller `authorization` override rejected), response
// normalization (Meta map-form + pywa list-form failed_templates, string vs
// object archived/unarchived ids, unknowns preserved, malformed entries
// skipped, always-present fields defaulting to empty), Graph error envelope
// classification on non-2xx, validation rejection matrix (missing/empty/
// whitespace/unsafe wabaId, empty/oversized/non-string/whitespace/control-
// char template ids, non-object params, accessor-backed params → no host
// TypeError, no transport on bad input), and WABAClient scoped method parity
// (bound wabaId wins over caller-supplied wabaId).

import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphClient,
  GraphRequestValidationError,
  WABAClient,
  archiveTemplates,
  unarchiveTemplates,
  type ArchiveTemplatesResponse,
  type UnarchiveTemplatesResponse
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

function err(
  status: number,
  error: object,
  contentType = "application/json"
): MockTransportResponseSpec {
  return { status, headers: { "content-type": contentType }, body: { error } };
}

// ---------------------------------------------------------------------------

describe("WATS-160B archiveTemplates — request contract", () => {
  test("POST https://api.facebook.com/{wabaId}/message_templates/archive with JSON body { hsm_ids: [...] }", async () => {
    const { client, handle } = clientWith(
      ok({ archived_templates: ["tpl1", "tpl2"], failed_templates: {} })
    );

    const res: ArchiveTemplatesResponse = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["tpl1", "tpl2"]
    });

    expect(handle.requests[0]?.method).toBe("POST");
    // Exact absolute URL on api.facebook.com (NOT graph.facebook.com/v25.0/...).
    expect(handle.requests[0]?.url).toBe(
      "https://api.facebook.com/WABA-1/message_templates/archive"
    );
    // Body is JSON-encoded { hsm_ids: [...] } (toBodyInit JSON.stringifies).
    expect(handle.requests[0]?.body).toBe(JSON.stringify({ hsm_ids: ["tpl1", "tpl2"] }));

    // Auth is managed by GraphClient: Bearer header injected.
    expect(handle.requests[0]?.headers.get("authorization")).toBe(
      "Bearer test-token"
    );
    // content-type defaulted to application/json by the helper.
    expect(handle.requests[0]?.headers.get("content-type")).toBe(
      "application/json"
    );

    expect(res.archivedTemplates).toEqual(["tpl1", "tpl2"]);
    expect(res.failedTemplates).toEqual({});
  });

  test("single template id is sent as a one-element array", async () => {
    const { client, handle } = clientWith(
      ok({ archived_templates: ["only"], failed_templates: {} })
    );
    await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["only"]
    });
    expect(handle.requests[0]?.body).toBe(JSON.stringify({ hsm_ids: ["only"] }));
  });

  test("rejects caller-supplied authorization header (auth is managed)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      archiveTemplates(
        client,
        { wabaId: "WABA-1", templateIds: ["tpl1"] },
        undefined,
        { headers: { authorization: "Bearer attacker" } } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-160B unarchiveTemplates — request contract", () => {
  test("POST https://api.facebook.com/{wabaId}/message_templates/unarchive with JSON body { hsm_ids: [...] }", async () => {
    const { client, handle } = clientWith(
      ok({ unarchived_templates: ["tpl1"], failed_templates: {} })
    );

    const res: UnarchiveTemplatesResponse = await unarchiveTemplates(client, {
      wabaId: "WABA-9",
      templateIds: ["tpl1"]
    });

    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://api.facebook.com/WABA-9/message_templates/unarchive"
    );
    expect(handle.requests[0]?.body).toBe(JSON.stringify({ hsm_ids: ["tpl1"] }));
    expect(handle.requests[0]?.headers.get("authorization")).toBe(
      "Bearer test-token"
    );
    expect(res.unarchivedTemplates).toEqual(["tpl1"]);
    expect(res.failedTemplates).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe("WATS-160B archiveTemplates — response normalization", () => {
  test("Meta map-form failed_templates -> Record<string,string>", async () => {
    const { client } = clientWith(
      ok({
        archived_templates: ["tpl1"],
        failed_templates: {
          "1019496902803242": "Incorrect category",
          "259672276895259": "Formatting error - dangling parameter"
        }
      })
    );
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["tpl1", "1019496902803242", "259672276895259"]
    });
    expect(res.archivedTemplates).toEqual(["tpl1"]);
    expect(res.failedTemplates).toEqual({
      "1019496902803242": "Incorrect category",
      "259672276895259": "Formatting error - dangling parameter"
    });
  });

  test("pywa list-form failed_templates [{id,reason}] -> Record<string,string>", async () => {
    const { client } = clientWith(
      ok({
        archived_templates: ["tpl1"],
        failed_templates: [
          { id: "f1", reason: "bad" },
          { id: "f2", reason: "worse", note: "keep" }
        ]
      })
    );
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["tpl1", "f1", "f2"]
    });
    expect(res.failedTemplates).toEqual({ f1: "bad", f2: "worse" });
  });

  test("archived_templates entries may be objects with string id (pywa form)", async () => {
    const { client } = clientWith(
      ok({
        archived_templates: [
          { id: "obj-id", extra: "x" },
          "bare-id",
          { id: "" }, // skipped
          { noId: true }, // skipped
          null, // skipped
          123 // skipped
        ],
        failed_templates: {}
      })
    );
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["obj-id", "bare-id"]
    });
    expect(res.archivedTemplates).toEqual(["obj-id", "bare-id"]);
  });

  test("unknown top-level response fields are preserved", async () => {
    const { client } = clientWith(
      ok({
        archived_templates: ["tpl1"],
        failed_templates: { tpl2: "nope" },
        paging: { next: "cursor" },
        extra_field: 42
      })
    );
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["tpl1"]
    });
    expect((res as Record<string, unknown>).paging).toEqual({ next: "cursor" });
    expect((res as Record<string, unknown>).extra_field).toBe(42);
  });

  test("missing archived/failed fields default to empty (always present)", async () => {
    const { client } = clientWith(ok({ unrelated: true }));
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["tpl1"]
    });
    expect(res.archivedTemplates).toEqual([]);
    expect(res.failedTemplates).toEqual({});
    expect((res as Record<string, unknown>).unrelated).toBe(true);
  });

  test("failed_templates as a non-object/non-array scalar is ignored -> empty map", async () => {
    const { client } = clientWith(
      ok({ archived_templates: ["tpl1"], failed_templates: "oops" })
    );
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["tpl1"]
    });
    expect(res.archivedTemplates).toEqual(["tpl1"]);
    expect(res.failedTemplates).toEqual({});
  });

  test("map-form failed_templates skips non-string reason values", async () => {
    const { client } = clientWith(
      ok({
        archived_templates: [],
        failed_templates: {
          good: "string reason",
          bad1: 123,
          bad2: null,
          "": "empty-key-skipped"
        }
      })
    );
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["good"]
    });
    expect(res.failedTemplates).toEqual({ good: "string reason" });
  });

  test("list-form failed_templates skips entries missing id or reason", async () => {
    const { client } = clientWith(
      ok({
        archived_templates: [],
        failed_templates: [
          { id: "f1", reason: "r1" },
          null,
          "not-an-object",
          { id: "f2" }, // missing reason
          { reason: "no-id" }, // missing id
          { id: "f3", reason: "r3" }
        ]
      })
    );
    const res = await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["f1", "f3"]
    });
    expect(res.failedTemplates).toEqual({ f1: "r1", f3: "r3" });
  });
});

describe("WATS-160B unarchiveTemplates — response normalization", () => {
  test("unarchived_templates normalized from both string and object forms", async () => {
    const { client } = clientWith(
      ok({
        unarchived_templates: ["bare", { id: "obj" }],
        failed_templates: { bad: "reason" }
      })
    );
    const res = await unarchiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["bare", "obj", "bad"]
    });
    expect(res.unarchivedTemplates).toEqual(["bare", "obj"]);
    expect(res.failedTemplates).toEqual({ bad: "reason" });
  });

  test("missing fields default to empty", async () => {
    const { client } = clientWith(ok({}));
    const res = await unarchiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["tpl1"]
    });
    expect(res.unarchivedTemplates).toEqual([]);
    expect(res.failedTemplates).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe("WATS-160B archive/unarchive — Graph error envelope classification", () => {
  test("non-2xx with { error: {...} } envelope throws GraphApiError with payload", async () => {
    const { client, handle } = clientWith(
      err(400, {
        message: "Invalid parameter",
        type: "OAuthException",
        code: 100,
        error_subcode: 2200025,
        fbtrace_id: "TRACE1"
      })
    );
    let caught: unknown;
    try {
      await archiveTemplates(client, {
        wabaId: "WABA-1",
        templateIds: ["tpl1"]
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GraphApiError);
    const apiErr = caught as GraphApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.message).toBe("Invalid parameter");
    expect(apiErr.code).toBe(100);
    expect(apiErr.errorSubcode).toBe(2200025);
    expect(apiErr.fbtraceId).toBe("TRACE1");
    // Token must not leak into the error payload.
    expect(JSON.stringify(apiErr.payload ?? {})).not.toContain("test-token");
    expect(handle.requests[0]?.url).toBe(
      "https://api.facebook.com/WABA-1/message_templates/archive"
    );
  });

  test("non-2xx without an envelope throws GraphApiError with fallback message", async () => {
    const { client } = clientWith({
      status: 500,
      headers: { "content-type": "application/json" },
      body: { something: "unexpected" }
    });
    let caught: unknown;
    try {
      await unarchiveTemplates(client, {
        wabaId: "WABA-1",
        templateIds: ["tpl1"]
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GraphApiError);
    const apiErr = caught as GraphApiError;
    expect(apiErr.status).toBe(500);
    expect(apiErr.message).toBe(
      "Graph API request failed with status 500"
    );
  });

  test("non-2xx with non-JSON body still throws GraphApiError", async () => {
    const { client } = clientWith({
      status: 502,
      headers: { "content-type": "text/plain" },
      body: "Bad Gateway"
    });
    await expect(
      archiveTemplates(client, {
        wabaId: "WABA-1",
        templateIds: ["tpl1"]
      })
    ).rejects.toBeInstanceOf(GraphApiError);
  });
});

// ---------------------------------------------------------------------------

describe("WATS-160B archiveTemplates — validation rejection matrix", () => {
  test("rejects missing/empty/whitespace wabaId", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of ["", "   ", undefined, null] as never[]) {
      await expect(
        archiveTemplates(client, { wabaId: bad, templateIds: ["tpl1"] } as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unsafe path-ish wabaId (dot-segment / slash / ? / # / control char)", async () => {
    const { client, handle } = clientWith(ok());
    const badIds = ["../evil", "a/b", "a\\b", "a?b", "a#b", ".", "..", "waba\n1"];
    for (const bad of badIds) {
      await expect(
        archiveTemplates(client, { wabaId: bad, templateIds: ["tpl1"] } as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-string wabaId (number/boolean/object)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      archiveTemplates(client, { wabaId: 12345, templateIds: ["tpl1"] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      archiveTemplates(client, { wabaId: { id: 1 }, templateIds: ["tpl1"] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects empty / oversized / non-array templateIds", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      archiveTemplates(client, { wabaId: "WABA-1", templateIds: [] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      archiveTemplates(client, { wabaId: "WABA-1", templateIds: "tpl1" } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      archiveTemplates(client, { wabaId: "WABA-1", templateIds: null } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    // Oversized: 101 ids > cap of 100.
    const tooMany = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    await expect(
      archiveTemplates(client, { wabaId: "WABA-1", templateIds: tooMany })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("accepts exactly 100 template ids (boundary)", async () => {
    const { client, handle } = clientWith(
      ok({ archived_templates: [], failed_templates: {} })
    );
    const exactly100 = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: exactly100
    });
    expect(handle.requests.length).toBe(1);
  });

  test("rejects non-string / empty / whitespace / control-char template ids", async () => {
    const { client, handle } = clientWith(ok());
    const badEntries: unknown[] = [
      123,
      true,
      null,
      { id: "x" },
      "",
      "   ",
      "has space",
      "has\ttab",
      "has\nnewline",
      "has\u0000null"
    ];
    for (const bad of badEntries) {
      await expect(
        archiveTemplates(client, {
          wabaId: "WABA-1",
          templateIds: ["good", bad]
        } as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("accepts template ids containing slash and comma (body values, not path)", async () => {
    const { client, handle } = clientWith(
      ok({ archived_templates: [], failed_templates: {} })
    );
    await archiveTemplates(client, {
      wabaId: "WABA-1",
      templateIds: ["id/with/slash", "id,with,comma"]
    });
    expect(handle.requests.length).toBe(1);
    expect(handle.requests[0]?.body).toBe(
      JSON.stringify({ hsm_ids: ["id/with/slash", "id,with,comma"] })
    );
  });

  test("rejects non-object params and accessor-backed params with typed errors (no host TypeError)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(archiveTemplates(client, null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(archiveTemplates(client, undefined as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(archiveTemplates(client, "x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(archiveTemplates(client, [] as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    // Accessor-backed wabaId must not trigger a host TypeError.
    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "wabaId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    accessorParams.templateIds = ["tpl1"];
    await expect(
      archiveTemplates(client, accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);

    // Accessor-backed templateIds.
    const accessorParams2 = {} as Record<string, unknown>;
    accessorParams2.wabaId = "WABA-1";
    Object.defineProperty(accessorParams2, "templateIds", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      archiveTemplates(client, accessorParams2 as never)
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });

  test("rejects a non-GraphClient-like client (no requestRaw) with typed error", async () => {
    const { handle } = clientWith(ok());
    const fakeClient = { request: () => undefined } as never;
    await expect(
      archiveTemplates(fakeClient, { wabaId: "WABA-1", templateIds: ["tpl1"] })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-160B unarchiveTemplates — validation rejection matrix", () => {
  test("rejects bad wabaId and templateIds before transport", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      unarchiveTemplates(client, { wabaId: "../evil", templateIds: ["tpl1"] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      unarchiveTemplates(client, { wabaId: "WABA-1", templateIds: [] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      unarchiveTemplates(client, {
        wabaId: "WABA-1",
        templateIds: ["has space"]
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params (no host TypeError)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(unarchiveTemplates(client, null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(unarchiveTemplates(client, "x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    expect(handle.requests.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("WATS-160B WABAClient scoped archiveTemplates / unarchiveTemplates", () => {
  test("archiveTemplates delegates with the bound wabaId in the path", async () => {
    const { client, handle } = clientWith([
      ok({ archived_templates: ["tpl1"], failed_templates: {} })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const res = await waba.archiveTemplates({ templateIds: ["tpl1"] });
    expect(res.archivedTemplates).toEqual(["tpl1"]);
    expect(res.failedTemplates).toEqual({});
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://api.facebook.com/BOUND-WABA/message_templates/archive"
    );
    expect(handle.requests[0]?.body).toBe(JSON.stringify({ hsm_ids: ["tpl1"] }));
  });

  test("unarchiveTemplates delegates with the bound wabaId in the path", async () => {
    const { client, handle } = clientWith([
      ok({ unarchived_templates: ["tpl1"], failed_templates: {} })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const res = await waba.unarchiveTemplates({ templateIds: ["tpl1"] });
    expect(res.unarchivedTemplates).toEqual(["tpl1"]);
    expect(handle.requests[0]?.url).toBe(
      "https://api.facebook.com/BOUND-WABA/message_templates/unarchive"
    );
  });

  test("caller-supplied wabaId is overwritten by the bound wabaId (bound wins)", async () => {
    const { client, handle } = clientWith([
      ok({ archived_templates: [] })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await waba.archiveTemplates({
      templateIds: ["tpl1"],
      // Attempt to override; bound id must win.
      wabaId: "ATTACK-WABA"
    } as never);
    expect(handle.requests[0]?.url).toBe(
      "https://api.facebook.com/BOUND-WABA/message_templates/archive"
    );
  });

  test("rejects unsafe templateIds before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(
      waba.archiveTemplates({ templateIds: [] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      waba.archiveTemplates({ templateIds: ["has space"] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      waba.unarchiveTemplates({ templateIds: ["a\tb"] } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params and accessor-backed params before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(waba.archiveTemplates(null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(waba.archiveTemplates("x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    // Accessor-backed templateIds must not trigger a host TypeError.
    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "templateIds", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      waba.archiveTemplates(accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);

    // Accessor-backed wabaId (caller-supplied) must not trigger a host
    // TypeError — bound id wins, but accessor is still walked and rejected.
    const accessorParams2 = {} as Record<string, unknown>;
    accessorParams2.templateIds = ["tpl1"];
    Object.defineProperty(accessorParams2, "wabaId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      waba.archiveTemplates(accessorParams2 as never)
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });
});
