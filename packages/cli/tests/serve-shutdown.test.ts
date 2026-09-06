// WATS-204 adversarial runtime correction (F1): the store-close tail of the
// graceful shutdown MUST be bounded. A never-settling pg query (hung
// #withLock chain) must not hang the process after the server is already
// force-stopped. Repeated shutdown calls MUST return the SAME in-flight
// promise so every caller awaits the actual outcome. Abandoned close
// promises must not surface as unhandled rejections.
//
// These tests import the extracted private helper directly (no built binary,
// no real DB) and inject a bounded store-close deadline + a never-resolving
// store so the outcome is deterministic and fast.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createServeShutdown, type ServeShutdownStore } from "../src/serve-shutdown";

// Minimal fake server: stop() records admission-stop vs force-stop; the drain
// loop reads pendingRequests and exits immediately when it reaches 0.
interface FakeServer {
  readonly port: number;
  stop(closeActive?: boolean): void;
  pendingRequests?: number;
  pendingWebSockets?: number;
}

function fakeServer(pending = 0): FakeServer & { forceStopped: boolean } {
  let forceStopped = false;
  return {
    port: 0,
    stop(closeActive?: boolean) { if (closeActive === true) forceStopped = true; },
    pendingRequests: pending,
    pendingWebSockets: 0,
    get forceStopped() { return forceStopped; }
  };
}

function hangingStore(): ServeShutdownStore & { closeCalls: number } {
  let closeCalls = 0;
  return {
    close: () => { closeCalls += 1; return new Promise<void>(() => undefined); },
    get closeCalls() { return closeCalls; }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("WATS-204 createServeShutdown bounded store-close (F1)", () => {
  test("successful close clears its deadline timer without retaining the process", () => {
    const code = `import {createServeShutdown} from ${JSON.stringify(new URL('../src/serve-shutdown.ts', import.meta.url).pathname)};
      const shutdown = createServeShutdown({port:0,pendingRequests:0,stop(){}}, {close:async()=>{}}, {storeCloseTimeoutMs:30000});
      await shutdown(); console.log('closed');`;
    const result = spawnSync(process.execPath, ["-e", code], {timeout:2000, encoding:"utf8"});
    expect(result.stdout).toContain("closed");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  test("synchronous close failure still resolves shutdown", async () => {
    const shutdown = createServeShutdown(fakeServer(), {close() {throw new Error('private backend fault');}}, {storeCloseTimeoutMs:30});
    await expect(shutdown()).resolves.toBeUndefined();
  });
  test("never-resolving store.close returns within the injected bounded deadline", async () => {
    const server = fakeServer(0);
    const store = hangingStore();
    const shutdown = createServeShutdown(server, store, { storeCloseTimeoutMs: 80, drainPollMs: 5 });
    const start = Date.now();
    const outcome = await Promise.race([
      shutdown().then(() => "resolved" as const),
      delay(3000).then(() => "timeout" as const)
    ]);
    const elapsed = Date.now() - start;
    expect(outcome).toBe("resolved");
    expect(elapsed).toBeLessThan(2000);
    expect(store.closeCalls).toBe(1);
    expect(server.forceStopped).toBe(true);
  });

  test("repeated shutdown calls return the SAME in-flight promise", async () => {
    const server = fakeServer(0);
    const store = hangingStore();
    const shutdown = createServeShutdown(server, store, { storeCloseTimeoutMs: 80, drainPollMs: 5 });
    const p1 = shutdown();
    const p2 = shutdown();
    expect(p2).toBe(p1);
    await p1;
    await p2;
  });

  test("a rejecting store.close does not surface as an unhandled rejection", async () => {
    const server = fakeServer(0);
    const rejectingStore: ServeShutdownStore = { close: () => Promise.reject(new Error("boom")) };
    const shutdown = createServeShutdown(server, rejectingStore, { storeCloseTimeoutMs: 80, drainPollMs: 5 });
    await expect(shutdown()).resolves.toBeUndefined();
    // Give the abandoned rejection a beat to surface; none should appear.
    await delay(60);
  });
});