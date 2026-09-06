import type { PersistenceStore } from "@wats/persistence";

export type ServeShutdownStore = Pick<PersistenceStore, "close">;
type Server = Readonly<{
  stop(closeActive?: boolean): void;
  pendingRequests?: number;
  pendingWebSockets?: number;
}>;

// Private CLI lifecycle helper. The bin exits after the bounded close attempt.
export function createServeShutdown(
  server: Server,
  store: ServeShutdownStore | undefined,
  options: Readonly<{ drainTimeoutMs?: number; storeCloseTimeoutMs?: number; drainPollMs?: number }> = {}
): () => Promise<void> {
  const drainMs = options.drainTimeoutMs ?? 10_000;
  const closeMs = options.storeCloseTimeoutMs ?? 5_000;
  const pollMs = options.drainPollMs ?? 25;
  let inflight: Promise<void> | undefined;
  return () => inflight ??= (async () => {
    try { server.stop(false); } catch { /* Still attempt force-stop and store closure. */ }
    const deadline = Date.now() + drainMs;
    const hasPending = typeof server.pendingRequests === "number" || typeof server.pendingWebSockets === "number";
    if (hasPending) {
      while (Date.now() < deadline && ((server.pendingRequests ?? 0) + (server.pendingWebSockets ?? 0)) > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
      }
    } else {
      await new Promise<void>((resolve) => setTimeout(resolve, drainMs));
    }
    try { server.stop(true); } catch { /* Closure remains best effort. */ }
    if (store !== undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Defer invocation so synchronous throws are handled too. Promise.race
        // observes a late rejection even when its deadline wins.
        await Promise.race([
          Promise.resolve().then(() => store.close()),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, closeMs); })
        ]);
      } catch { /* Never replace the shutdown result with backend details. */ }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }
  })();
}
