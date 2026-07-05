import type { OutboxItem, PersistenceStore } from "./index";
import { runOutboxWorkerOnce, type OutboxWorkerReport } from "./outbox";

// WATS-175c PART 3.2: a long-lived outbox worker loop.
//
// startOutboxWorker arms a timer that fires runOutboxWorkerOnce on a fixed
// cadence. The loop is overlap-safe: a tick that arrives while a previous
// tick is still in flight is skipped (the in-flight run re-arms the next
// timer when it completes), so a single slow handler can never start a
// second concurrent claim batch. Handler errors are caught per item by
// runOutboxWorkerOnce; claim/count/store errors thrown inside a tick are
// swallowed (optionally surfaced via onError) and never escape the timer,
// so one bad tick cannot kill the loop. stop() cancels the pending timer
// and awaits any in-flight run before resolving; double-stop is a no-op.
//
// Timing is fully injectable so tests never sleep: pass a `schedule` pair
// (setTimeout/clearTimeout) and a `now` clock. The default schedule uses the
// global timers; the default clock returns new Date().toISOString().

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH_LIMIT = 10;
const DEFAULT_RETRY_DELAY_MS = 30_000;

const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 3_600_000;
const MIN_BATCH_LIMIT = 1;
const MAX_BATCH_LIMIT = 100;
const MIN_RETRY_DELAY_MS = 0;
const MAX_RETRY_DELAY_MS = 86_400_000;

/** Opaque timer handle returned by {@link OutboxScheduler.setTimeout}. */
export type OutboxTimerHandle = unknown;

/**
 * Injectable timer seam. The default implementation uses the global
 * `setTimeout`/`clearTimeout`; tests pass a fake that queues callbacks for
 * manual, deterministic firing.
 */
export interface OutboxScheduler {
  setTimeout(callback: () => void, delayMs: number): OutboxTimerHandle;
  clearTimeout(handle: OutboxTimerHandle): void;
}

/** Report delivered to {@link OutboxWorkerOptions.onReport} after each tick. */
export interface OutboxWorkerTickReport extends OutboxWorkerReport {
  /** Pending outbox depth at the moment the tick completed. */
  readonly pending: number;
}

export interface StartOutboxWorkerOptions {
  /** Called for each claimed outbox item. Errors are caught per item. */
  readonly handler: (item: OutboxItem) => Promise<void>;
  /** Tick interval in ms. Integer 100..3_600_000. Default 5000. */
  readonly intervalMs?: number;
  /** Items claimed per tick. Integer 1..100. Default 10. */
  readonly batchLimit?: number;
  /** Retry delay for failed items in ms. Integer 0..86_400_000. Default 30000. */
  readonly retryDelayMs?: number;
  /** Invoked with the combined tick report after each run. */
  readonly onReport?: (report: OutboxWorkerTickReport) => void;
  /** Invoked when claim/count/store errors are swallowed inside a tick. */
  readonly onError?: (error: unknown) => void;
  /** Injectable ISO clock for runOutboxWorkerOnce + countOutboxPending. */
  readonly now?: () => string;
  /** Injectable timer seam. Defaults to the global timers. */
  readonly schedule?: OutboxScheduler;
}

export interface OutboxWorkerHandle {
  /** Cancel the pending timer and await any in-flight run. Double-stop is a no-op. */
  stop(): Promise<void>;
  /** True until stop() has been called. */
  running(): boolean;
}

function validateInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

const DEFAULT_SCHEDULER: OutboxScheduler = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  }
};

function isStoreLike(value: unknown): value is PersistenceStore {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { claimOutboxItems?: unknown }).claimOutboxItems === "function" &&
    typeof (value as { countOutboxPending?: unknown }).countOutboxPending === "function"
  );
}

export function startOutboxWorker(store: PersistenceStore, options: StartOutboxWorkerOptions): OutboxWorkerHandle {
  if (!isStoreLike(store)) throw new TypeError("store must be a PersistenceStore exposing claimOutboxItems and countOutboxPending.");
  if (!isRecord(options)) throw new TypeError("options must be an object.");
  if (typeof options.handler !== "function") throw new TypeError("options.handler must be a function.");

  const intervalMs = validateInteger(options.intervalMs ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS, "intervalMs");
  const batchLimit = validateInteger(options.batchLimit ?? DEFAULT_BATCH_LIMIT, MIN_BATCH_LIMIT, MAX_BATCH_LIMIT, "batchLimit");
  const retryDelayMs = validateInteger(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, MIN_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS, "retryDelayMs");

  const onReport = options.onReport;
  if (onReport !== undefined && typeof onReport !== "function") throw new TypeError("options.onReport must be a function.");
  const onError = options.onError;
  if (onError !== undefined && typeof onError !== "function") throw new TypeError("options.onError must be a function.");

  const now = options.now ?? (() => new Date().toISOString());
  if (typeof now !== "function") throw new TypeError("options.now must be a function.");

  const schedule = options.schedule ?? DEFAULT_SCHEDULER;
  if (
    !isRecord(schedule) ||
    typeof schedule.setTimeout !== "function" ||
    typeof schedule.clearTimeout !== "function"
  ) {
    throw new TypeError("options.schedule must expose setTimeout and clearTimeout functions.");
  }

  const handler = options.handler;
  let stopped = false;
  let inFlight = false;
  let timerHandle: OutboxTimerHandle | null = null;
  let stopResolve: (() => void) | null = null;

  function arm(): void {
    if (stopped) return;
    timerHandle = schedule.setTimeout(fire, intervalMs);
  }

  async function fire(): Promise<void> {
    // The timer that fired is consumed regardless of what happens next.
    timerHandle = null;
    // Overlap prevention: a tick that arrives while a previous tick is still
    // running is a no-op. The in-flight run re-arms the next timer in its
    // finally block, so skipping here never stalls the loop.
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      let report: OutboxWorkerTickReport;
      try {
        const once = await runOutboxWorkerOnce(store, {
          now: now(),
          limit: batchLimit,
          retryDelayMs,
          handler
        });
        const pending = await store.countOutboxPending();
        report = Object.freeze({ processed: once.processed, succeeded: once.succeeded, failed: once.failed, pending });
      } catch (cause) {
        // claim/count/store errors must never kill the loop.
        if (onError) {
          try {
            onError(cause);
          } catch {
            // Swallow onError failures; the loop must stay alive.
          }
        }
        report = Object.freeze({ processed: 0, succeeded: 0, failed: 0, pending: 0 });
      }
      if (onReport && !stopped) {
        try {
          onReport(report);
        } catch {
          // Swallow onReport failures; the loop must stay alive.
        }
      }
    } finally {
      inFlight = false;
      if (stopped) {
        if (stopResolve) stopResolve();
      } else {
        arm();
      }
    }
  }

  arm();

  return {
    async stop(): Promise<void> {
      if (stopped) return; // double-stop no-op
      stopped = true;
      if (timerHandle !== null) {
        schedule.clearTimeout(timerHandle);
        timerHandle = null;
      }
      if (inFlight) {
        await new Promise<void>((resolve) => {
          stopResolve = resolve;
        });
      }
    },
    running(): boolean {
      return !stopped;
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
