import { afterEach, describe, expect, test } from "bun:test";
import { createMessagesStatusClient, MessagesStatusClientError } from "../src/status-client";

type FetchLike = typeof fetch;

function startMockServer(): { baseUrl: string; stop: () => void } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const auth = request.headers.get("authorization");
      if (url.pathname === "/api/messages" && request.method === "GET") {
        if (auth !== "Bearer good-token") {
          return new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
            status: 401,
            headers: { "content-type": "application/json" }
          });
        }
        const limit = url.searchParams.get("limit");
        const cursor = url.searchParams.get("cursor");
        if (limit === "1" && cursor === "abc") {
          return Response.json({ items: [], nextCursor: null });
        }
        return Response.json({
          items: [
            {
              rowId: "row-1",
              waMessageId: "wamid.A",
              direction: "outbound",
              fromPhone: null,
              toPhone: "15550001111",
              type: "text",
              status: "sent",
              graphMessageId: "wamid.A",
              createdAt: "2026-06-21T12:00:00.000Z",
              updatedAt: "2026-06-21T12:00:00.000Z"
            }
          ],
          nextCursor: "row-1"
        });
      }
      if (url.pathname.startsWith("/api/messages/") && request.method === "GET") {
        if (auth !== "Bearer good-token") {
          return new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
            status: 401,
            headers: { "content-type": "application/json" }
          });
        }
        const id = decodeURIComponent(url.pathname.slice("/api/messages/".length));
        if (id === "wamid.A") {
          return Response.json({
            rowId: "row-1",
            waMessageId: "wamid.A",
            direction: "outbound",
            fromPhone: null,
            toPhone: "15550001111",
            type: "text",
            status: "sent",
            graphMessageId: "wamid.A",
            createdAt: "2026-06-21T12:00:00.000Z",
            updatedAt: "2026-06-21T12:00:00.000Z"
          });
        }
        return new Response(JSON.stringify({ error: { code: "not_found" } }), {
          status: 404,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("not found", { status: 404 });
    }
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true)
  };
}

describe("WATS-124 createMessagesStatusClient", () => {
  let mock: { baseUrl: string; stop: () => void };

  afterEach(() => {
    mock?.stop();
  });

  test("list returns parsed items + nextCursor on success", async () => {
    mock = startMockServer();
    const client = createMessagesStatusClient({ baseUrl: mock.baseUrl, bearerToken: "good-token" });
    const result = await client.list();
    expect(result.items.length).toBe(1);
    expect(result.items[0]!.waMessageId).toBe("wamid.A");
    expect(result.items[0]!.direction).toBe("outbound");
    expect(result.nextCursor).toBe("row-1");
  });

  test("list forwards limit + cursor query params", async () => {
    mock = startMockServer();
    const client = createMessagesStatusClient({ baseUrl: mock.baseUrl, bearerToken: "good-token" });
    const result = await client.list({ limit: 1, cursor: "abc" });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  test("get returns the single record on success", async () => {
    mock = startMockServer();
    const client = createMessagesStatusClient({ baseUrl: mock.baseUrl, bearerToken: "good-token" });
    const record = await client.get("wamid.A");
    expect(record.waMessageId).toBe("wamid.A");
    expect(record.direction).toBe("outbound");
  });

  test("list throws MessagesStatusClientError on 401", async () => {
    mock = startMockServer();
    const client = createMessagesStatusClient({ baseUrl: mock.baseUrl, bearerToken: "wrong-token" });
    await expect(client.list()).rejects.toThrow(MessagesStatusClientError);
    try {
      await client.list();
    } catch (error) {
      expect(error).toBeInstanceOf(MessagesStatusClientError);
      const typed = error as MessagesStatusClientError;
      expect(typed.status).toBe(401);
      expect(typed.body).toContain("unauthorized");
    }
  });

  test("get throws MessagesStatusClientError on 404", async () => {
    mock = startMockServer();
    const client = createMessagesStatusClient({ baseUrl: mock.baseUrl, bearerToken: "good-token" });
    await expect(client.get("wamid.UNKNOWN")).rejects.toThrow(MessagesStatusClientError);
    try {
      await client.get("wamid.UNKNOWN");
    } catch (error) {
      const typed = error as MessagesStatusClientError;
      expect(typed.status).toBe(404);
      expect(typed.body).toContain("not_found");
    }
  });

  test("network error (unreachable host) throws", async () => {
    const client = createMessagesStatusClient({
      baseUrl: "http://127.0.0.1:1",
      bearerToken: "good-token"
    });
    await expect(client.list()).rejects.toThrow();
    await expect(client.get("wamid.A")).rejects.toThrow();
  });

  test("injected fetchImpl is used and default fetch is bypassed", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: Parameters<FetchLike>[0]) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as unknown as FetchLike;
    const client = createMessagesStatusClient({
      baseUrl: "http://example.test",
      bearerToken: "tok",
      fetchImpl
    });
    const result = await client.list({ limit: 5 });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("/api/messages?limit=5");
    expect(calls[0]).toContain("example.test");
  });
});
