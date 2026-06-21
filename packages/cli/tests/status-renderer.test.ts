import { describe, expect, test } from "bun:test";
import {
  formatMessagesStatusJson,
  formatMessagesStatusSummaryLine,
  renderMessagesStatusFrame,
  runMessagesStatusPoller
} from "../src/status-renderer";
import type { MessagesStatusClient, StatusListResult, StatusMessageRecord } from "../src/status-client";

function record(overrides: Partial<StatusMessageRecord> = {}): StatusMessageRecord {
  return {
    rowId: "row-0001",
    waMessageId: "wamid.A",
    direction: "outbound",
    fromPhone: null,
    toPhone: "15550001111",
    type: "text",
    status: "sent",
    graphMessageId: "wamid.A",
    createdAt: "2026-06-21T12:00:00.000Z",
    updatedAt: "2026-06-21T12:00:00.000Z",
    ...overrides
  };
}

function fakeClient(results: StatusListResult[], errorOnCall?: number): MessagesStatusClient {
  let calls = 0;
  return Object.freeze({
    async list(): Promise<StatusListResult> {
      calls += 1;
      if (errorOnCall !== undefined && calls >= errorOnCall) {
        throw new Error("simulated fetch error");
      }
      return results[(calls - 1) % results.length]!;
    },
    async get(): Promise<StatusMessageRecord> {
      throw new Error("not used");
    }
  });
}

describe("WATS-124 status-renderer formatters", () => {
  test("renderMessagesStatusFrame with empty records still emits header + footer", () => {
    const frame = renderMessagesStatusFrame({
      records: [],
      fetchedAt: "2026-06-21T12:00:00.000Z",
      nextCursor: null
    });
    const lines = frame.split("\n");
    expect(lines[0]).toContain("rowId");
    expect(lines[0]).toContain("status");
    expect(frame).toContain("0 record(s)");
    expect(frame).toContain("no more pages");
    expect(frame).toContain("fetchedAt: 2026-06-21T12:00:00.000Z");
    // No ANSI escapes in the frame itself (clear-line is the poller's job).
    expect(frame).not.toContain("\u001B");
  });

  test("renderMessagesStatusFrame with one record prints row + verbatim status", () => {
    const frame = renderMessagesStatusFrame({
      records: [record({ status: "sent" })],
      fetchedAt: "2026-06-21T12:00:00.000Z",
      nextCursor: "row-0001"
    });
    expect(frame).toContain("outbound");
    expect(frame).toContain("sent");
    expect(frame).toContain("15550001111");
    expect(frame).toContain("next cursor: row-0001");
    // sent must NOT be promoted to delivered/read.
    expect(frame).not.toContain("delivered");
    expect(frame).not.toContain("read");
  });

  test("renderMessagesStatusFrame with many records prints each row", () => {
    const records = [
      record({ rowId: "row-0001", waMessageId: "wamid.A", toPhone: "15550001111" }),
      record({ rowId: "row-0002", waMessageId: "wamid.B", toPhone: "15550002222", status: "sent" }),
      record({ rowId: "row-0003", waMessageId: "wamid.C", toPhone: "15550003333" })
    ];
    const frame = renderMessagesStatusFrame({
      records,
      fetchedAt: "2026-06-21T12:00:00.000Z",
      nextCursor: null
    });
    expect(frame).toContain("row-0001");
    expect(frame).toContain("row-0002");
    expect(frame).toContain("row-0003");
    expect(frame).toContain("15550002222");
    expect(frame).toContain("3 record(s)");
  });

  test("status:'sent' printed verbatim, never promoted to delivered/read", () => {
    const frame = renderMessagesStatusFrame({
      records: [record({ status: "sent" })],
      fetchedAt: "2026-06-21T12:00:00.000Z",
      nextCursor: null
    });
    expect(frame).toContain("sent");
    expect(frame).not.toMatch(/delivered|read/u);
  });

  test("status:'failed' printed verbatim", () => {
    const frame = renderMessagesStatusFrame({
      records: [record({ status: "failed" })],
      fetchedAt: "2026-06-21T12:00:00.000Z",
      nextCursor: null
    });
    expect(frame).toContain("failed");
  });

  test("long phone and rowId are truncated", () => {
    const longPhone = "12345678901234567890";
    const longRowId = "row-abcdefghij-very-long-id-123456";
    const frame = renderMessagesStatusFrame({
      records: [record({ rowId: longRowId, toPhone: longPhone })],
      fetchedAt: "2026-06-21T12:00:00.000Z",
      nextCursor: null
    });
    // rowId truncated to 8 chars; phone truncated to 12.
    expect(frame).toContain(longRowId.slice(0, 8));
    expect(frame).not.toContain(longRowId.slice(0, 9));
    expect(frame).toContain(longPhone.slice(0, 12));
    expect(frame).not.toContain(longPhone.slice(0, 13));
  });

  test("summary line reports outbound count and observation time", () => {
    const line = formatMessagesStatusSummaryLine({
      records: [record({ status: "sent" }), record({ status: "sent", direction: "outbound" })],
      fetchedAt: "2026-06-21T12:00:00.000Z"
    });
    expect(line).toContain("wats messages:");
    expect(line).toContain("2 outbound record(s)");
    expect(line).toContain("observed at 2026-06-21T12:00:00.000Z");
    expect(line.endsWith("\n")).toBe(true);
  });

  test("summary line with zero records is still safe", () => {
    const line = formatMessagesStatusSummaryLine({
      records: [],
      fetchedAt: "2026-06-21T12:00:00.000Z"
    });
    expect(line).toContain("0 outbound record(s)");
    expect(line).toContain("no records yet");
    expect(line).toContain("observed at 2026-06-21T12:00:00.000Z");
  });

  test("JSON formatter round-trips the shape", () => {
    const result: StatusListResult = Object.freeze({
      items: [record()],
      nextCursor: "row-0001"
    });
    const text = formatMessagesStatusJson(result);
    expect(text.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(text) as { items: unknown[]; nextCursor: string | null };
    expect(parsed.items.length).toBe(1);
    expect(parsed.nextCursor).toBe("row-0001");
  });
});

describe("WATS-124 runMessagesStatusPoller", () => {
  test("writes >=2 frames then stops on abort", async () => {
    const writes: string[] = [];
    const controller = new AbortController();
    const client = fakeClient([
      Object.freeze({ items: [record({ rowId: "row-1" })], nextCursor: null }),
      Object.freeze({ items: [record({ rowId: "row-2" })], nextCursor: null })
    ]);
    const { stop } = runMessagesStatusPoller({
      client,
      stderrWriter: (chunk) => writes.push(chunk),
      intervalMs: 10,
      signal: controller.signal
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    controller.abort();
    stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Each frame writes a clear-line + frame; we want at least 2 frames.
    const frames = writes.filter((chunk) => chunk.includes("record(s)"));
    expect(frames.length).toBeGreaterThanOrEqual(2);
    // No process access — the poller only writes via stderrWriter.
    expect(writes.some((chunk) => chunk.includes("\u001B[2K\r"))).toBe(true);
  });

  test("stops on unrecoverable fetch error and calls onFetchError", async () => {
    const writes: string[] = [];
    let errorReported: unknown = undefined;
    const controller = new AbortController();
    const client = fakeClient([], 1);
    const { stop } = runMessagesStatusPoller({
      client,
      stderrWriter: (chunk) => writes.push(chunk),
      intervalMs: 10,
      signal: controller.signal,
      onFetchError: (error) => {
        errorReported = error;
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(errorReported).toBeInstanceOf(Error);
    expect((errorReported as Error).message).toContain("simulated fetch error");
  });
});
