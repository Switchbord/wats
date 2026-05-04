// F-13 pagination primitive (WATS-25 / Arch-K).
//
// Shipped shapes:
//
//   paginate(client, endpoint, params, opts?)    async generator<TItem, PaginatedResult>
//   paginateAll(client, endpoint, params, opts?) Promise<PaginatedResult<TItem>>
//
// Contract highlights:
//
// - `endpoint` must be an F-6 EndpointCallable (runtime brand check via
//   its frozen `.definition`). Invalid inputs throw PaginationError at
//   the first `.next()` tick so both direct and `for await` callers
//   observe the same typed failure.
// - `maxPages` must be a positive integer (default 1000); 0, negatives,
//   NaN, Infinity and non-integer values are rejected with
//   `invalid_max_pages`.
// - `pageSize` must be a positive integer if provided; rejected with
//   `invalid_page_size` otherwise. When present it is merged into the
//   first request's params under the conventional `limit` key.
// - `signal` must be a duck-typed AbortSignal (boolean `aborted` + a
//   `addEventListener` function) or is rejected with `invalid_signal`.
// - Iteration stops when (a) `paging.next` is absent, (b)
//   `pagesConsumed >= maxPages` (final result carries
//   `pageLimitReached: true`), or (c) the signal aborts between pages
//   (final result carries `aborted: true`).
// - Items are yielded one at a time — NO accumulation of pages in
//   memory inside paginate. paginateAll is the convenience wrapper
//   that accumulates into a flat array.
// - Endpoint errors mid-stream are wrapped as
//   PaginationError('page_fetch_failed', ..., { cause }) — the
//   original error is preserved on .cause so callers can narrow.
// - Cursor extraction: parse `paging.next` as a URL and read the
//   `after` query parameter; if the URL is unparseable or lacks
//   `after`, iteration stops cleanly (no fabricated cursor, no
//   infinite loop).

import type { EndpointCallable } from "./endpoint";
import type { GraphClient } from "./client";

export interface PaginationOptions {
  readonly maxPages?: number;
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly pagesConsumed: number;
  readonly pageLimitReached: boolean;
  readonly aborted: boolean;
}

export interface PaginatedPage<T> {
  readonly data?: readonly T[];
  readonly paging?: {
    readonly cursors?: {
      readonly before?: string;
      readonly after?: string;
    };
    readonly next?: string;
    readonly previous?: string;
  };
}

export type PaginationErrorCode =
  | "invalid_endpoint"
  | "invalid_max_pages"
  | "invalid_page_size"
  | "invalid_signal"
  | "aborted"
  | "page_fetch_failed";

export class PaginationError extends Error {
  readonly code: PaginationErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: PaginationErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = "PaginationError";
    this.code = code;
    if (options !== undefined && "cause" in options) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        writable: false,
        configurable: true
      });
    }
  }
}

// ---------------------------------------------------------------------
// Defaults + validation helpers
// ---------------------------------------------------------------------

export const DEFAULT_MAX_PAGES = 1000;
const DEFAULT_PAGE_SIZE_QUERY_KEY = "limit";

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  // Small helper to avoid TS narrowing `signal.aborted` down to the
  // literal `false` after a preceding `if (signal?.aborted === true)`
  // check — that narrowing is sound for a fixed value but wrong for
  // a live boolean that flips under async scheduling.
  return signal !== undefined && signal.aborted;
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    aborted?: unknown;
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}

function isEndpointCallable<TParams extends Record<string, string>, TBody, TResponse>(
  value: unknown
): value is EndpointCallable<TParams, TBody, TResponse> {
  if (typeof value !== "function") {
    return false;
  }
  const asObj = value as { definition?: unknown };
  if (typeof asObj.definition !== "object" || asObj.definition === null) {
    return false;
  }
  const def = asObj.definition as { method?: unknown; pathTemplate?: unknown; params?: unknown };
  return (
    typeof def.method === "string" &&
    typeof def.pathTemplate === "string" &&
    typeof def.params === "object" &&
    def.params !== null
  );
}

function extractAfterCursor(nextUrl: string): string | undefined {
  // Graph's paging.next is an absolute URL. If URL parsing fails or the
  // `after` query parameter is missing, we treat the stream as
  // exhausted rather than fabricate a cursor.
  try {
    const url = new URL(nextUrl);
    const after = url.searchParams.get("after");
    return after === null ? undefined : after;
  } catch {
    return undefined;
  }
}

function validateOptions(opts: PaginationOptions | undefined): {
  maxPages: number;
  pageSize: number | undefined;
  signal: AbortSignal | undefined;
} {
  if (opts !== undefined && (typeof opts !== "object" || opts === null)) {
    throw new PaginationError(
      "invalid_endpoint",
      "paginate: opts must be an object when provided."
    );
  }
  const maxPagesRaw = opts?.maxPages;
  let maxPages = DEFAULT_MAX_PAGES;
  if (maxPagesRaw !== undefined) {
    if (!isPositiveInteger(maxPagesRaw)) {
      throw new PaginationError(
        "invalid_max_pages",
        `paginate: maxPages must be a positive integer; received ${String(maxPagesRaw)}.`
      );
    }
    maxPages = maxPagesRaw;
  }

  const pageSizeRaw = opts?.pageSize;
  let pageSize: number | undefined;
  if (pageSizeRaw !== undefined) {
    if (!isPositiveInteger(pageSizeRaw)) {
      throw new PaginationError(
        "invalid_page_size",
        `paginate: pageSize must be a positive integer; received ${String(pageSizeRaw)}.`
      );
    }
    pageSize = pageSizeRaw;
  }

  const signalRaw = opts?.signal;
  let signal: AbortSignal | undefined;
  if (signalRaw !== undefined) {
    if (!isAbortSignalLike(signalRaw)) {
      throw new PaginationError(
        "invalid_signal",
        "paginate: signal must be an AbortSignal (duck-typed)."
      );
    }
    signal = signalRaw;
  }

  return { maxPages, pageSize, signal };
}

// ---------------------------------------------------------------------
// paginate — async generator
// ---------------------------------------------------------------------

export async function* paginate<
  TParams extends Record<string, string>,
  TBody,
  TItem
>(
  client: GraphClient,
  endpoint: EndpointCallable<TParams, TBody, PaginatedPage<TItem>>,
  params: TParams,
  opts?: PaginationOptions
): AsyncGenerator<TItem, PaginatedResult<TItem>, void> {
  if (!isEndpointCallable<TParams, TBody, PaginatedPage<TItem>>(endpoint)) {
    throw new PaginationError(
      "invalid_endpoint",
      "paginate: endpoint must be an EndpointCallable (see defineEndpoint)."
    );
  }

  const { maxPages, pageSize, signal } = validateOptions(opts);

  // Collect yielded items for the final result summary. We do NOT
  // accumulate page bodies in memory — only the flat items list for
  // the returned summary (the same items the caller already observed
  // one-at-a-time).
  const collected: TItem[] = [];
  let pagesConsumed = 0;
  let aborted = false;
  let pageLimitReached = false;

  // Pre-aborted: return the empty zero-page result without touching
  // the transport.
  if (isSignalAborted(signal)) {
    return {
      items: collected,
      pagesConsumed,
      pageLimitReached,
      aborted: true
    } satisfies PaginatedResult<TItem>;
  }

  // Build the initial params. pageSize is merged under the conventional
  // `limit` key — callers who want a different key should set it
  // directly in params and omit pageSize.
  let currentParams: TParams = params;
  if (pageSize !== undefined) {
    const existing = (params as unknown as Record<string, unknown>)[DEFAULT_PAGE_SIZE_QUERY_KEY];
    if (existing === undefined) {
      currentParams = {
        ...(params as unknown as Record<string, string>),
        [DEFAULT_PAGE_SIZE_QUERY_KEY]: String(pageSize)
      } as unknown as TParams;
    }
  }

  while (true) {
    if (isSignalAborted(signal)) {
      aborted = true;
      break;
    }

    let page: PaginatedPage<TItem>;
    try {
      const invokeOpts = signal !== undefined ? { signal } : undefined;
      page = await endpoint(client, currentParams, undefined, invokeOpts);
    } catch (err) {
      throw new PaginationError(
        "page_fetch_failed",
        `paginate: underlying endpoint threw while fetching page ${pagesConsumed + 1}.`,
        { cause: err }
      );
    }
    pagesConsumed += 1;

    const data = page.data ?? [];
    for (const item of data) {
      collected.push(item);
      yield item;
    }

    if (pagesConsumed >= maxPages) {
      pageLimitReached = true;
      break;
    }

    const nextUrl = page.paging?.next;
    if (typeof nextUrl !== "string" || nextUrl.length === 0) {
      break;
    }

    const nextAfter = extractAfterCursor(nextUrl);
    if (nextAfter === undefined) {
      break;
    }

    currentParams = {
      ...(currentParams as unknown as Record<string, string>),
      after: nextAfter
    } as unknown as TParams;
  }

  return {
    items: collected,
    pagesConsumed,
    pageLimitReached,
    aborted
  } satisfies PaginatedResult<TItem>;
}

// ---------------------------------------------------------------------
// paginateAll — convenience accumulator
// ---------------------------------------------------------------------

export async function paginateAll<
  TParams extends Record<string, string>,
  TBody,
  TItem
>(
  client: GraphClient,
  endpoint: EndpointCallable<TParams, TBody, PaginatedPage<TItem>>,
  params: TParams,
  opts?: PaginationOptions
): Promise<PaginatedResult<TItem>> {
  const gen = paginate(client, endpoint, params, opts);
  // Drive the generator to completion. Items are already collected
  // into the final PaginatedResult.items by paginate itself, so we
  // only need the returned value.
  while (true) {
    const step = await gen.next();
    if (step.done) {
      return step.value;
    }
  }
}
