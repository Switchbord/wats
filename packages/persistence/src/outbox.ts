import type { OutboxItem, PersistenceStore } from "./index";

export interface OutboxWorkerOptions {
  readonly now: string;
  readonly limit: number;
  readonly retryDelayMs: number;
  readonly handler: (item: OutboxItem) => Promise<void>;
}

export interface OutboxWorkerReport {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
}

function nextAttemptIso(now: string, retryDelayMs: number): string {
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 86_400_000) {
    throw new RangeError("retryDelayMs must be an integer from 0 to 86400000.");
  }
  return new Date(new Date(now).getTime() + retryDelayMs).toISOString();
}

export async function runOutboxWorkerOnce(store: PersistenceStore, options: OutboxWorkerOptions): Promise<OutboxWorkerReport> {
  const claimed = await store.claimOutboxItems({ now: options.now, limit: options.limit });
  let succeeded = 0;
  let failed = 0;
  for (const item of claimed) {
    try {
      await options.handler(item);
      await store.markOutboxItemSucceeded({ id: item.id, updatedAt: options.now });
      succeeded += 1;
    } catch {
      await store.markOutboxItemFailed({
        id: item.id,
        nextAttemptAt: nextAttemptIso(options.now, options.retryDelayMs),
        updatedAt: options.now
      });
      failed += 1;
    }
  }
  return Object.freeze({ processed: claimed.length, succeeded, failed });
}
