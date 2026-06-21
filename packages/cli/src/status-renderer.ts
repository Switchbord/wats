// WATS-124: plain-text status renderers for the observed message projection.
//
// All formatters are pure (no `process`, no ANSI color). The TTY poller path
// (`runMessagesStatusPoller`) is the ONLY place that emits a clear-line escape
// (`\u001B[2K\r`), and only into the injected `stderrWriter` — that path is
// TTY-gated by the caller. `record.status` is printed VERBATIM; this slice
// never infers delivered/read or promotes "sent" to a higher state.

import type { MessagesStatusClient, StatusListResult, StatusMessageRecord } from "./status-client.js";

export interface MessagesStatusFrameInput {
  readonly records: readonly StatusMessageRecord[];
  readonly fetchedAt: string;
  readonly nextCursor: string | null;
}

export interface MessagesStatusSummaryInput {
  readonly records: readonly StatusMessageRecord[];
  readonly fetchedAt: string;
}

export interface MessagesStatusPollerOptions {
  readonly client: MessagesStatusClient;
  readonly stderrWriter: (chunk: string) => void;
  readonly intervalMs: number;
  readonly signal: AbortSignal;
  readonly onFetchError?: (error: unknown) => void;
  readonly now?: () => string;
}

export function formatMessagesStatusJson(result: StatusListResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}`;
}

function phoneFor(record: StatusMessageRecord): string {
  if (record.direction === "outbound") return record.toPhone ?? "-";
  return record.fromPhone ?? "-";
}

function toLocalIso(createdAt: string): string {
  // The projection stores strict ISO ms (UTC). Render a local-ish ISO view by
  // converting through the Date object. We keep the full ISO string so the
  // column is unambiguous; truncation keeps the column narrow.
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? createdAt : parsed.toLocaleString("sv-SE");
}

export function renderMessagesStatusFrame(input: MessagesStatusFrameInput): string {
  const { records, fetchedAt, nextCursor } = input;
  const header = [
    "rowId",
    "dir",
    "status",
    "type",
    "phone",
    "createdAt"
  ].join("  ");
  const lines: string[] = [header];

  for (const record of records) {
    const row = [
      truncate(record.rowId, 8),
      record.direction,
      record.status,
      truncate(record.type, 8),
      truncate(phoneFor(record), 12),
      toLocalIso(record.createdAt)
    ].join("  ");
    lines.push(row);
  }

  const cursorHint = nextCursor === null ? "no more pages" : `next cursor: ${nextCursor}`;
  lines.push(`(${records.length} record(s)) ${cursorHint}`);
  lines.push(`fetchedAt: ${fetchedAt}`);
  return `${lines.join("\n")}\n`;
}

export function formatMessagesStatusSummaryLine(input: MessagesStatusSummaryInput): string {
  const { records, fetchedAt } = input;
  const outbound = records.filter((record) => record.direction === "outbound");
  const newest = outbound.length > 0
    ? outbound.map((record) => record.createdAt).sort().at(-1)
    : undefined;
  const newestClause = newest === undefined ? "no records yet" : `newest ${newest}`;
  return `wats messages: ${outbound.length} outbound record(s), ${newestClause}; observed at ${fetchedAt}.\n`;
}

export function runMessagesStatusPoller(options: MessagesStatusPollerOptions): { stop(): void } {
  const { client, stderrWriter, intervalMs, signal, onFetchError } = options;
  const now = options.now ?? (() => new Date().toISOString());
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const writeFrame = (result: StatusListResult): void => {
    const frame = renderMessagesStatusFrame({
      records: result.items,
      fetchedAt: now(),
      nextCursor: result.nextCursor
    });
    stderrWriter("\u001B[2K\r");
    stderrWriter(frame);
  };

  const tick = async (): Promise<void> => {
    if (stopped || signal.aborted) return;
    try {
      const result = await client.list();
      if (stopped || signal.aborted) return;
      writeFrame(result);
    } catch (error) {
      if (stopped) return;
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      onFetchError?.(error);
      return;
    }
    if (stopped || signal.aborted) return;
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  };

  const onAbort = (): void => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });

  // Kick off the first tick immediately so the first frame appears without
  // waiting an entire interval.
  void tick();

  return Object.freeze({
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // Best-effort abort so any in-flight tick sees signal.aborted === true.
      try {
        (signal as { abort?: () => void }).abort?.();
      } catch {
        // Ignore: the caller owns the signal; we only nudge it.
      }
    }
  });
}
