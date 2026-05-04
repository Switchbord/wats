// F-13 pagination primitive coverage (WATS-25 / Arch-K).
//
// Covers:
//   - input validation with PaginationError taxonomy
//   - single-page happy path
//   - multi-page cursor iteration (3 pages with `paging.next`)
//   - maxPages cap (pageLimitReached=true in final result)
//   - AbortSignal mid-stream (aborted=true, partial items preserved)
//   - endpoint throws mid-stream wrap-as-PaginationError with cause
//   - empty first page
//   - missing paging.next stops cleanly
//   - malformed paging.next URL handled gracefully
//   - paginateAll accumulates yielded items

import { describe, expect, test } from "bun:test";
import { GraphClient } from "../src/client";
import { createMockTransport } from "../src/createMockTransport";
import { defineEndpoint, type EndpointCallable } from "../src/endpoint";
import {
  paginate,
  paginateAll,
  PaginationError,
  type PaginatedPage
} from "../src/pagination";
import type { Transport } from "../src/transport";

interface Item {
  readonly id: string;
}

type ListEndpoint = EndpointCallable<
  { accountId: string; after?: string },
  never,
  PaginatedPage<Item>
>;

function buildEndpoint(): ListEndpoint {
  return defineEndpoint<
    { accountId: string; after?: string },
    never,
    PaginatedPage<Item>
  >({
    method: "GET",
    pathTemplate: "/{accountId}/items",
    params: {
      accountId: { in: "path", required: true },
      after: { in: "query", required: false }
    }
  });
}

function makePage(
  ids: readonly string[],
  nextCursor?: string
): { status: number; headers: Record<string, string>; body: PaginatedPage<Item> } {
  const body: PaginatedPage<Item> = {
    data: ids.map((id) => ({ id })),
    paging:
      nextCursor !== undefined
        ? {
            cursors: { after: nextCursor },
            next: `https://graph.facebook.com/v20.0/100/items?after=${nextCursor}`
          }
        : { cursors: {} }
  };
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body
  };
}

function buildClientAndHandle(pages: ReturnType<typeof makePage>[]): {
  client: GraphClient;
  handle: ReturnType<typeof createMockTransport>;
} {
  const handle = createMockTransport({ responses: pages });
  const client = new GraphClient({
    accessToken: "t",
    apiVersion: "v20.0",
    baseUrl: "https://graph.facebook.com",
    transport: handle.transport as Transport
  });
  return { client, handle };
}

// ---------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------

describe("F-13 paginate — input validation", () => {
  test("rejects non-endpoint-callable with PaginationError('invalid_endpoint')", async () => {
    const { client } = buildClientAndHandle([]);
    // A plain function is not an endpoint-callable (no .definition).
    const notAnEndpoint = (async () => ({})) as unknown as ListEndpoint;
    const gen = paginate(client, notAnEndpoint, { accountId: "1" });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_endpoint");
  });

  test("rejects maxPages=0 with invalid_max_pages", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const gen = paginate(client, ep, { accountId: "1" }, { maxPages: 0 });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_max_pages");
  });

  test("rejects negative maxPages", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const gen = paginate(client, ep, { accountId: "1" }, { maxPages: -5 });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_max_pages");
  });

  test("rejects NaN maxPages", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const gen = paginate(client, ep, { accountId: "1" }, { maxPages: Number.NaN });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_max_pages");
  });

  test("rejects Infinity maxPages", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const gen = paginate(
      client,
      ep,
      { accountId: "1" },
      { maxPages: Number.POSITIVE_INFINITY }
    );
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_max_pages");
  });

  test("rejects non-integer maxPages (0.5)", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const gen = paginate(client, ep, { accountId: "1" }, { maxPages: 0.5 });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_max_pages");
  });

  test("rejects pageSize=0 with invalid_page_size", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const gen = paginate(client, ep, { accountId: "1" }, { pageSize: 0 });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_page_size");
  });

  test("rejects non-integer pageSize", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const gen = paginate(client, ep, { accountId: "1" }, { pageSize: 3.14 });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_page_size");
  });

  test("rejects non-AbortSignal signal with invalid_signal", async () => {
    const { client } = buildClientAndHandle([]);
    const ep = buildEndpoint();
    const bogus = { aborted: false } as unknown as AbortSignal;
    const gen = paginate(client, ep, { accountId: "1" }, { signal: bogus });
    let thrown: unknown;
    try {
      await gen.next();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("invalid_signal");
  });

  test("PaginationError is a plain Error, not a TypeError (sibling-class)", () => {
    const err = new PaginationError("aborted", "x");
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err.name).toBe("PaginationError");
  });
});

// ---------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------

describe("F-13 paginate — happy paths", () => {
  test("single-page iterates items and returns pagesConsumed=1", async () => {
    const { client } = buildClientAndHandle([makePage(["a", "b", "c"])]);
    const ep = buildEndpoint();
    const collected: string[] = [];
    const gen = paginate(client, ep, { accountId: "1" });
    while (true) {
      const step = await gen.next();
      if (step.done) {
        expect(step.value.pagesConsumed).toBe(1);
        expect(step.value.pageLimitReached).toBe(false);
        expect(step.value.aborted).toBe(false);
        expect(step.value.items).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
        break;
      }
      collected.push(step.value.id);
    }
    expect(collected).toEqual(["a", "b", "c"]);
  });

  test("multi-page: 3 pages with cursors — iterates all in order", async () => {
    const { client, handle } = buildClientAndHandle([
      makePage(["a", "b"], "cur1"),
      makePage(["c", "d"], "cur2"),
      makePage(["e", "f"])
    ]);
    const ep = buildEndpoint();
    const collected: string[] = [];
    let finalResult;
    const gen = paginate(client, ep, { accountId: "1" });
    while (true) {
      const step = await gen.next();
      if (step.done) {
        finalResult = step.value;
        break;
      }
      collected.push(step.value.id);
    }
    expect(collected).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(finalResult?.pagesConsumed).toBe(3);
    expect(finalResult?.pageLimitReached).toBe(false);
    expect(finalResult?.aborted).toBe(false);
    expect(handle.requests.length).toBe(3);
    // Second/third request carries extracted 'after' cursor in query.
    expect(handle.requests[1]?.url).toContain("after=cur1");
    expect(handle.requests[2]?.url).toContain("after=cur2");
  });

  test("paginateAll accumulates items across pages", async () => {
    const { client } = buildClientAndHandle([
      makePage(["a"], "c1"),
      makePage(["b"], "c2"),
      makePage(["c"])
    ]);
    const ep = buildEndpoint();
    const result = await paginateAll(client, ep, { accountId: "1" });
    expect(result.items).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(result.pagesConsumed).toBe(3);
    expect(result.pageLimitReached).toBe(false);
    expect(result.aborted).toBe(false);
  });

  test("for-await-of consumes all items in order", async () => {
    const { client } = buildClientAndHandle([
      makePage(["a", "b"], "c1"),
      makePage(["c"])
    ]);
    const ep = buildEndpoint();
    const collected: string[] = [];
    for await (const item of paginate(client, ep, { accountId: "1" })) {
      collected.push(item.id);
    }
    expect(collected).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------
// maxPages cap
// ---------------------------------------------------------------------

describe("F-13 paginate — maxPages cap", () => {
  test("maxPages=2 on 5 pages available → stops after 2 pages with pageLimitReached=true", async () => {
    const { client } = buildClientAndHandle([
      makePage(["a"], "c1"),
      makePage(["b"], "c2"),
      makePage(["c"], "c3"),
      makePage(["d"], "c4"),
      makePage(["e"])
    ]);
    const ep = buildEndpoint();
    const result = await paginateAll(client, ep, { accountId: "1" }, { maxPages: 2 });
    expect(result.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(result.pagesConsumed).toBe(2);
    expect(result.pageLimitReached).toBe(true);
    expect(result.aborted).toBe(false);
  });

  test("maxPages=1 yields only first page's items", async () => {
    const { client, handle } = buildClientAndHandle([
      makePage(["a", "b"], "c1")
    ]);
    const ep = buildEndpoint();
    const result = await paginateAll(client, ep, { accountId: "1" }, { maxPages: 1 });
    expect(result.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(result.pagesConsumed).toBe(1);
    expect(result.pageLimitReached).toBe(true);
    expect(handle.requests.length).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------

describe("F-13 paginate — AbortSignal", () => {
  test("pre-aborted signal → aborted=true without fetching any page", async () => {
    const { client, handle } = buildClientAndHandle([makePage(["a"])]);
    const ep = buildEndpoint();
    const ac = new AbortController();
    ac.abort();
    const result = await paginateAll(
      client,
      ep,
      { accountId: "1" },
      { signal: ac.signal }
    );
    expect(result.aborted).toBe(true);
    expect(result.items.length).toBe(0);
    expect(result.pagesConsumed).toBe(0);
    expect(handle.requests.length).toBe(0);
  });

  test("abort between pages → yields partial, result.aborted=true", async () => {
    const ac = new AbortController();
    const { client } = buildClientAndHandle([
      makePage(["a"], "c1"),
      makePage(["b"], "c2"),
      makePage(["c"])
    ]);
    const ep = buildEndpoint();
    const collected: string[] = [];
    const gen = paginate(client, ep, { accountId: "1" }, { signal: ac.signal });
    let finalResult;
    // Grab the first page, then abort before the next fetch.
    const first = await gen.next();
    if (!first.done) {
      collected.push(first.value.id);
    }
    ac.abort();
    while (true) {
      const step = await gen.next();
      if (step.done) {
        finalResult = step.value;
        break;
      }
      collected.push(step.value.id);
    }
    // Only first page's items should have made it out.
    expect(collected).toEqual(["a"]);
    expect(finalResult?.aborted).toBe(true);
    expect(finalResult?.pagesConsumed).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Error wrapping
// ---------------------------------------------------------------------

describe("F-13 paginate — error wrapping", () => {
  test("endpoint throws mid-stream → wrapped as PaginationError(page_fetch_failed) with cause", async () => {
    const underlying = new Error("transport boom");
    const handle = createMockTransport({
      responses: [makePage(["a"], "c1")],
      fail: underlying,
      failAfter: 1
    });
    const client = new GraphClient({
      accessToken: "t",
      apiVersion: "v20.0",
      baseUrl: "https://graph.facebook.com",
      transport: handle.transport as Transport
    });
    const ep = buildEndpoint();
    const collected: string[] = [];
    let thrown: unknown;
    try {
      for await (const item of paginate(client, ep, { accountId: "1" })) {
        collected.push(item.id);
      }
    } catch (err) {
      thrown = err;
    }
    expect(collected).toEqual(["a"]);
    expect(thrown).toBeInstanceOf(PaginationError);
    expect((thrown as PaginationError).code).toBe("page_fetch_failed");
    // cause pointer preserved (sibling-class not-a-TypeError).
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect((thrown as PaginationError).cause).toBeDefined();
  });
});

// ---------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------

describe("F-13 paginate — edge cases", () => {
  test("empty first page → yields nothing, returns pagesConsumed=1", async () => {
    const { client } = buildClientAndHandle([
      { status: 200, headers: { "content-type": "application/json" }, body: { data: [] } }
    ]);
    const ep = buildEndpoint();
    const result = await paginateAll(client, ep, { accountId: "1" });
    expect(result.items.length).toBe(0);
    expect(result.pagesConsumed).toBe(1);
    expect(result.pageLimitReached).toBe(false);
    expect(result.aborted).toBe(false);
  });

  test("page missing paging.next → stops cleanly after yielding items", async () => {
    const { client, handle } = buildClientAndHandle([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { data: [{ id: "x" }] }
      }
    ]);
    const ep = buildEndpoint();
    const result = await paginateAll(client, ep, { accountId: "1" });
    expect(result.items).toEqual([{ id: "x" }]);
    expect(result.pagesConsumed).toBe(1);
    expect(handle.requests.length).toBe(1);
  });

  test("malformed paging.next URL (no after query) → stops cleanly", async () => {
    const { client } = buildClientAndHandle([
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          data: [{ id: "x" }],
          paging: { next: "not-a-valid-url-with-after-param" }
        }
      }
    ]);
    const ep = buildEndpoint();
    const result = await paginateAll(client, ep, { accountId: "1" });
    expect(result.items).toEqual([{ id: "x" }]);
    expect(result.pagesConsumed).toBe(1);
    expect(result.aborted).toBe(false);
  });

  test("missing data array treated as empty page", async () => {
    const { client } = buildClientAndHandle([
      { status: 200, headers: { "content-type": "application/json" }, body: {} }
    ]);
    const ep = buildEndpoint();
    const result = await paginateAll(client, ep, { accountId: "1" });
    expect(result.items.length).toBe(0);
    expect(result.pagesConsumed).toBe(1);
  });

  test("pageSize is merged into the first request as query param", async () => {
    const { client, handle } = buildClientAndHandle([makePage(["a"])]);
    const ep = defineEndpoint<
      { accountId: string; after?: string; limit?: string },
      never,
      PaginatedPage<Item>
    >({
      method: "GET",
      pathTemplate: "/{accountId}/items",
      params: {
        accountId: { in: "path", required: true },
        after: { in: "query", required: false },
        limit: { in: "query", required: false }
      }
    });
    await paginateAll(client, ep, { accountId: "1" }, { pageSize: 25 });
    const url = handle.requests[0]?.url ?? "";
    expect(url).toContain("limit=25");
  });
});
