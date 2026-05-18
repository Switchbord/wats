// @wats/http — Bun adapter wrapper (F-12 GREEN).
//
// Wraps createWebhookAdapter in a Bun.serve handler. Bun.serve's
// request handler already speaks WinterCG Request → Response, so
// the bun adapter is essentially a one-liner around
// `createFetchWebhookHandler`. The extra surface is the
// bind-and-serve lifecycle (port, hostname, stop()).
//
// This module is edge-safe: no node:* references. It depends on the
// global `Bun` object which is present under Bun runtimes only; a
// missing `Bun` results in a typed runtime error.

import { createFetchWebhookHandler } from "./fetchAdapter.js";
import type { WebhookAdapter } from "./webhookAdapter.js";

export interface BunServerHandle {
  readonly port: number;
  readonly hostname: string;
  stop(closeActive?: boolean): void;
}

export interface BunAdapterOptions {
  readonly port?: number;
  readonly hostname?: string;
}

interface BunServeLike {
  port: number;
  hostname: string;
  stop(closeActive?: boolean): void;
}

interface BunLike {
  serve(options: {
    port?: number;
    hostname?: string;
    fetch: (req: Request) => Promise<Response> | Response;
  }): BunServeLike;
}

export function createBunWebhookServer(
  adapter: WebhookAdapter,
  options?: BunAdapterOptions
): BunServerHandle {
  if (
    adapter === null ||
    typeof adapter !== "object" ||
    typeof (adapter as { handle?: unknown }).handle !== "function"
  ) {
    throw new Error(
      "createBunWebhookServer: adapter must be a WebhookAdapter."
    );
  }
  const bunGlobal = (globalThis as { Bun?: BunLike }).Bun;
  if (bunGlobal === undefined || typeof bunGlobal.serve !== "function") {
    throw new Error(
      "createBunWebhookServer: Bun.serve is not available in this runtime."
    );
  }

  const handler = createFetchWebhookHandler(adapter);
  const serveOptions: {
    port?: number;
    hostname?: string;
    fetch: (req: Request) => Promise<Response>;
  } = {
    fetch: (req) => handler(req)
  };
  if (options?.port !== undefined) {
    serveOptions.port = options.port;
  }
  if (options?.hostname !== undefined) {
    serveOptions.hostname = options.hostname;
  }
  const server = bunGlobal.serve(serveOptions);
  return {
    port: server.port,
    hostname: server.hostname,
    stop(closeActive?: boolean): void {
      server.stop(closeActive);
    }
  };
}
