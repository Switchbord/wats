// WATS-160A RED/GREEN behavioral tests for migrateTemplates. MockTransport
// only — no live calls.
//
// Covers: exact request path/query (no body), response parsing for both the
// Meta map-form and pywa list-form `failed_templates`, string-vs-object
// `migrated_templates` normalization, unknowns preserved (top-level +
// per-entry), malformed entries skipped, validation errors for
// missing/empty/unsafe ids, finite integer >=0 pageNumber, descriptor-safe
// object params (no host TypeError), no transport on validation failure,
// and WABAClient scoped method parity (bound wabaId wins).

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  WABAClient,
  migrateTemplates,
  type MigrateTemplatesResponse
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

describe("WATS-160A migrateTemplates — request contract", () => {
  test("POST /{destinationWabaId}/migrate_message_templates?source_waba_id=... with no body", async () => {
    const { client, handle } = clientWith(
      ok({
        migrated_templates: ["tpl1", "tpl2"],
        failed_templates: {}
      })
    );

    const res: MigrateTemplatesResponse = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });

    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/DEST-WABA/migrate_message_templates?source_waba_id=SRC-WABA"
    );
    // No body for migrate.
    expect(handle.requests[0]?.body).toBeNull();

    // String migrated ids are converted to { id }.
    expect(res.migratedTemplates).toEqual([{ id: "tpl1" }, { id: "tpl2" }]);
  });

  test("optional pageNumber=0 is appended as &page_number=0", async () => {
    const { client, handle } = clientWith(
      ok({ migrated_templates: [], failed_templates: [] })
    );
    await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA",
      pageNumber: 0
    });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/DEST-WABA/migrate_message_templates?source_waba_id=SRC-WABA&page_number=0"
    );
  });

  test("positive pageNumber is sent as a string query value", async () => {
    const { client, handle } = clientWith(
      ok({ migrated_templates: [], failed_templates: [] })
    );
    await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA",
      pageNumber: 3
    });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/DEST-WABA/migrate_message_templates?source_waba_id=SRC-WABA&page_number=3"
    );
  });
});

describe("WATS-160A migrateTemplates — response normalization", () => {
  test("Meta map-form failed_templates -> { id, reason }[]", async () => {
    const { client } = clientWith(
      ok({
        migrated_templates: ["tpl1"],
        failed_templates: {
          "1019496902803242": "Incorrect category",
          "259672276895259": "Formatting error - dangling parameter"
        }
      })
    );
    const res = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });
    expect(res.migratedTemplates).toEqual([{ id: "tpl1" }]);
    expect(res.failedTemplates).toEqual([
      { id: "1019496902803242", reason: "Incorrect category" },
      { id: "259672276895259", reason: "Formatting error - dangling parameter" }
    ]);
  });

  test("pywa list-form failed_templates preserves per-entry unknowns", async () => {
    const { client } = clientWith(
      ok({
        migrated_templates: [{ id: "tpl1", extra: "x" }],
        failed_templates: [{ id: "tpl2", reason: "bad", extra: "y" }]
      })
    );
    const res = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });
    expect(res.migratedTemplates).toEqual([{ id: "tpl1", extra: "x" }]);
    expect(res.failedTemplates).toEqual([
      { id: "tpl2", reason: "bad", extra: "y" }
    ]);
  });

  test("unknown top-level response fields are preserved", async () => {
    const { client } = clientWith(
      ok({
        migrated_templates: ["tpl1"],
        failed_templates: { tpl2: "nope" },
        paging: { next: "cursor" },
        extra_field: 42
      })
    );
    const res = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });
    expect((res as Record<string, unknown>).paging).toEqual({ next: "cursor" });
    expect((res as Record<string, unknown>).extra_field).toBe(42);
  });

  test("malformed migrated/failed entries are skipped without throwing", async () => {
    const { client } = clientWith(
      ok({
        migrated_templates: [
          "good-id",
          "",
          null,
          123,
          "another",
          { id: "obj-id" },
          { id: "" },
          { noId: true },
          []
        ],
        failed_templates: [
          { id: "f1", reason: "r1" },
          null,
          "not-an-object",
          { id: "f2" }, // missing reason -> skipped
          { reason: "no-id" }, // missing id -> skipped
          { id: "f3", reason: "r3", note: "keep" }
        ]
      })
    );
    const res = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });
    expect(res.migratedTemplates).toEqual([
      { id: "good-id" },
      { id: "another" },
      { id: "obj-id" }
    ]);
    expect(res.failedTemplates).toEqual([
      { id: "f1", reason: "r1" },
      { id: "f3", reason: "r3", note: "keep" }
    ]);
  });

  test("missing migrated/failed arrays yield undefined normalized fields", async () => {
    const { client } = clientWith(ok({ unrelated: true }));
    const res = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });
    expect(res.migratedTemplates).toBeUndefined();
    expect(res.failedTemplates).toBeUndefined();
    expect((res as Record<string, unknown>).unrelated).toBe(true);
  });

  test("failed_templates as a non-object/non-array scalar is ignored", async () => {
    const { client } = clientWith(
      ok({ migrated_templates: ["tpl1"], failed_templates: "oops" })
    );
    const res = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });
    expect(res.migratedTemplates).toEqual([{ id: "tpl1" }]);
    expect(res.failedTemplates).toBeUndefined();
  });

  test("map-form failed_templates skips non-string reason values", async () => {
    const { client } = clientWith(
      ok({
        migrated_templates: [],
        failed_templates: {
          good: "string reason",
          bad1: 123,
          bad2: null,
          "": "empty-key-skipped"
        }
      })
    );
    const res = await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA"
    });
    expect(res.failedTemplates).toEqual([{ id: "good", reason: "string reason" }]);
  });
});

describe("WATS-160A migrateTemplates — validation", () => {
  test("rejects missing/empty/whitespace destinationWabaId and sourceWabaId", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      migrateTemplates(client, {
        destinationWabaId: "",
        sourceWabaId: "SRC-WABA"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateTemplates(client, {
        destinationWabaId: "   ",
        sourceWabaId: "SRC-WABA"
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateTemplates(client, {
        destinationWabaId: "DEST-WABA",
        sourceWabaId: ""
      } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateTemplates(
        client,
        { destinationWabaId: "DEST-WABA", sourceWabaId: undefined } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects unsafe path-ish ids (dot-segment / slash / ? / # / control char)", async () => {
    const { client, handle } = clientWith(ok());
    const badIds = ["../evil", "a/b", "a\\b", "a?b", "a#b", ".", "..", "tpl\n1"];
    for (const bad of badIds) {
      await expect(
        migrateTemplates(client, {
          destinationWabaId: bad,
          sourceWabaId: "SRC-WABA"
        } as never)
      ).rejects.toThrow(GraphRequestValidationError);
      await expect(
        migrateTemplates(client, {
          destinationWabaId: "DEST-WABA",
          sourceWabaId: bad
        } as never)
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-string ids (number/boolean/object)", async () => {
    const { client, handle } = clientWith(ok());
    await expect(
      migrateTemplates(
        client,
        { destinationWabaId: 12345, sourceWabaId: "SRC-WABA" } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      migrateTemplates(
        client,
        { destinationWabaId: "DEST-WABA", sourceWabaId: { id: 1 } } as never
      )
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects invalid pageNumber (NaN, Infinity, negative, non-integer, non-number)", async () => {
    const { client, handle } = clientWith(ok());
    const badPages: unknown[] = [NaN, Infinity, -Infinity, -1, 1.5, "0", true, null, []];
    for (const bad of badPages) {
      await expect(
        migrateTemplates(
          client,
          {
            destinationWabaId: "DEST-WABA",
            sourceWabaId: "SRC-WABA",
            pageNumber: bad
          } as never
        )
      ).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("accepts pageNumber=0 as a valid finite non-negative integer", async () => {
    const { client, handle } = clientWith(ok({ migrated_templates: [], failed_templates: [] }));
    await migrateTemplates(client, {
      destinationWabaId: "DEST-WABA",
      sourceWabaId: "SRC-WABA",
      pageNumber: 0
    });
    expect(handle.requests.length).toBe(1);
  });

  test("rejects non-object params and accessor-backed params with typed errors", async () => {
    const { client, handle } = clientWith(ok());
    await expect(migrateTemplates(client, null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(migrateTemplates(client, undefined as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(migrateTemplates(client, "x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(migrateTemplates(client, [] as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    // Accessor-backed destinationWabaId must not trigger a host TypeError.
    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "destinationWabaId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    accessorParams.sourceWabaId = "SRC-WABA";
    await expect(
      migrateTemplates(client, accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);

    // Accessor-backed sourceWabaId.
    const accessorParams2 = {} as Record<string, unknown>;
    accessorParams2.destinationWabaId = "DEST-WABA";
    Object.defineProperty(accessorParams2, "sourceWabaId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      migrateTemplates(client, accessorParams2 as never)
    ).rejects.toThrow(GraphRequestValidationError);

    // Accessor-backed pageNumber.
    const accessorParams3 = {} as Record<string, unknown>;
    accessorParams3.destinationWabaId = "DEST-WABA";
    accessorParams3.sourceWabaId = "SRC-WABA";
    Object.defineProperty(accessorParams3, "pageNumber", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      migrateTemplates(client, accessorParams3 as never)
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-160A WABAClient scoped migrateTemplates", () => {
  test("delegates with the bound wabaId as destination", async () => {
    const { client, handle } = clientWith([
      ok({ migrated_templates: ["tpl1"], failed_templates: { tpl2: "bad" } })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const res = await waba.migrateTemplates({ sourceWabaId: "SRC-WABA" });
    expect(res.migratedTemplates).toEqual([{ id: "tpl1" }]);
    expect(res.failedTemplates).toEqual([{ id: "tpl2", reason: "bad" }]);
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/BOUND-WABA/migrate_message_templates?source_waba_id=SRC-WABA"
    );
    expect(handle.requests[0]?.body).toBeNull();
  });

  test("caller-supplied destinationWabaId is overwritten by the bound wabaId", async () => {
    const { client, handle } = clientWith([ok({ migrated_templates: [] })]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await waba.migrateTemplates({
      sourceWabaId: "SRC-WABA",
      // Attempt to override; bound id must win.
      destinationWabaId: "ATTACK-WABA"
    } as never);
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/BOUND-WABA/migrate_message_templates?source_waba_id=SRC-WABA"
    );
  });

  test("forwards optional pageNumber via the scoped method", async () => {
    const { client, handle } = clientWith([ok({ migrated_templates: [] })]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await waba.migrateTemplates({ sourceWabaId: "SRC-WABA", pageNumber: 2 });
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/BOUND-WABA/migrate_message_templates?source_waba_id=SRC-WABA&page_number=2"
    );
  });

  test("rejects unsafe sourceWabaId before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(
      waba.migrateTemplates({ sourceWabaId: "../evil" } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      waba.migrateTemplates({ sourceWabaId: "a?b" } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects invalid pageNumber before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(
      waba.migrateTemplates({ sourceWabaId: "SRC-WABA", pageNumber: -1 } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      waba.migrateTemplates({ sourceWabaId: "SRC-WABA", pageNumber: 1.5 } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("rejects non-object params and accessor-backed params before transport", async () => {
    const { client, handle } = clientWith(ok());
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(waba.migrateTemplates(null as never)).rejects.toThrow(
      GraphRequestValidationError
    );
    await expect(waba.migrateTemplates("x" as never)).rejects.toThrow(
      GraphRequestValidationError
    );

    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "sourceWabaId", {
      get() {
        throw new TypeError("getter should not run");
      }
    });
    await expect(
      waba.migrateTemplates(accessorParams as never)
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});
