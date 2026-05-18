# Pagination Reference

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-22

## Purpose

The pagination primitive lets consumers iterate over cursor-paginated
Graph API list endpoints (phone numbers, message templates, etc.)
without hand-rolling cursor plumbing. F-13 ships `paginate` and
`paginateAll` over the F-6 `defineEndpoint` surface and closes
WATS-25 (Arch-K pagination primitive) per the foundations-pivot plan.

## Scope

- `paginate(client, endpoint, params, opts?)` — async generator
  yielding items one at a time.
- `paginateAll(client, endpoint, params, opts?)` — convenience
  wrapper that drives the generator to completion and returns a
  `PaginatedResult<T>` summary with the flat items list.
- Error taxonomy: `PaginationError` with `.code` union.
- `maxPages` cap, `pageSize` query-hint merge, `AbortSignal`
  cancellation.
- Cursor extraction from Graph's `paging.next` envelope.

## Pagination primitive overview

```ts
import {
  GraphClient,
  defineEndpoint,
  paginate,
  paginateAll,
  PaginationError,
  type PaginatedPage
} from "@wats/graph";

// 1. Define a list endpoint whose response conforms to PaginatedPage<T>.
interface PhoneNumberEntry {
  readonly id: string;
  readonly display_phone_number?: string;
}

const listPhoneNumbers = defineEndpoint<
  { wabaId: string; after?: string; limit?: string },
  never,
  PaginatedPage<PhoneNumberEntry>
>({
  method: "GET",
  pathTemplate: "/{wabaId}/phone_numbers",
  params: {
    wabaId: { in: "path", required: true },
    after: { in: "query", required: false },
    limit: { in: "query", required: false }
  }
});

const client = new GraphClient({
  accessToken: "...",
  apiVersion: "v25.0"
});

// 2. Stream items one at a time (recommended for large result sets).
for await (const phone of paginate(
  client,
  listPhoneNumbers,
  { wabaId: "1234567890" },
  { maxPages: 50, pageSize: 100 }
)) {
  console.log("saw phone number:", phone.id);
}

// 3. Or accumulate into a flat list via paginateAll.
const result = await paginateAll(
  client,
  listPhoneNumbers,
  { wabaId: "1234567890" },
  { maxPages: 10 }
);
console.log("total items:", result.items.length);
console.log("pages consumed:", result.pagesConsumed);
console.log("cap hit?", result.pageLimitReached);
```

## PaginationOptions

| Field       | Type         | Default | Notes                                                                |
|-------------|--------------|---------|----------------------------------------------------------------------|
| `maxPages`  | `number`     | `1000`  | Positive integer cap on pages consumed. NaN/Infinity/0.5 rejected.   |
| `pageSize`  | `number`     | —       | Positive integer; merged into first request's query under `limit`.   |
| `signal`    | `AbortSignal`| —       | Duck-typed signal (`aborted`, `addEventListener`, `removeEventListener`). |

All three fields are validated at the first `.next()` tick. Invalid
inputs throw `PaginationError` with a typed `.code` — the generator
never silently swallows bad options.

## PaginatedResult&lt;T&gt;

Every pagination run returns a frozen summary regardless of how it
ended. Callers can inspect:

- `items: readonly T[]` — flat list of every yielded item (same
  items the `for await` loop already observed).
- `pagesConsumed: number` — how many pages actually hit the wire.
- `pageLimitReached: boolean` — `true` when `maxPages` stopped
  iteration; `false` when the stream exhausted naturally.
- `aborted: boolean` — `true` when an `AbortSignal` interrupted
  iteration; `false` otherwise.

## Cursor extraction from paging.next

Graph responds to list endpoints with a `paging.next` field that is
an **absolute URL** carrying an `after` query parameter. The
primitive:

1. Parses `paging.next` as a `URL`.
2. Reads the `after` query param.
3. Merges it into the next iteration's params as `{ ..., after: <cursor> }`.

If `paging.next` is absent, empty, unparseable, or lacks `after`,
iteration terminates cleanly — no fabricated cursor, no infinite
loop. This makes the primitive resilient to Graph API response
drift.

## Error taxonomy

`PaginationError` is a plain `Error` subclass (sibling-NOT
`TypeError`) with a stable `.code` union:

| `.code`                | When it fires                                                                  |
|------------------------|--------------------------------------------------------------------------------|
| `invalid_endpoint`     | First arg is not an F-6 `EndpointCallable` (missing `.definition` brand).      |
| `invalid_max_pages`    | `maxPages` is not a positive integer (0, negatives, NaN, Infinity, 0.5 etc.).  |
| `invalid_page_size`    | `pageSize` is not a positive integer.                                          |
| `invalid_signal`       | `signal` is not a duck-typed `AbortSignal`.                                    |
| `aborted`              | Reserved for programmatic abort-path signalling (currently conveyed via the result flag). |
| `page_fetch_failed`    | Underlying endpoint threw mid-stream; original error attached as `.cause`.     |

Endpoint errors are always re-thrown as
`PaginationError(page_fetch_failed, ..., { cause })`. Consumers
narrow via `instanceof PaginationError` and inspect `.code` for
branching, or follow `.cause` back to the underlying
`GraphApiError` / transport failure.

## Streaming iteration (no in-memory accumulation of pages)

`paginate` yields each item as it arrives from the current page
and then — once the page is exhausted — fetches the next one.
Page bodies never accumulate in memory: the only structure that
grows is the `items` array on `PaginatedResult`, which mirrors what
the caller already observed item-by-item. For very large result
sets, consumers should iterate with `for await` and skip
`paginateAll` to avoid holding the flat items list.

## AbortSignal semantics

- **Pre-aborted signal** — iteration returns an empty result with
  `aborted: true` WITHOUT touching the transport (zero requests
  captured).
- **Abort between pages** — the current page's items still flush
  to the caller; the next fetch is skipped; final result carries
  `aborted: true` and `pagesConsumed` reflects pages actually
  fetched.
- The signal is also forwarded to the underlying endpoint's
  `EndpointInvokeOptions.signal`, so in-flight fetches cancel at
  the transport layer.

## maxPages cap

Default `DEFAULT_MAX_PAGES = 1000` — large enough for any realistic
list endpoint, small enough to prevent runaway loops against a
misbehaving cursor. On cap:

- Iteration stops after the Nth page's items have been yielded.
- Final result carries `pageLimitReached: true`.
- `pagesConsumed === maxPages`.

Set `maxPages: 1` for "first page only" semantics; set a larger cap
for long-running exports; the default is a safety net rather than a
tight bound.

## Scope ledger (non-goals)

F-13 pagination does NOT:

- persist cursor state across process restarts (caller
  responsibility — save `result.items` or re-read via new
  iteration).
- implement cross-envelope pagination (cursor chaining across
  Graph response variants — the Graph shape is the only shape).
- provide bidirectional iteration (no `previous` cursor walk).
- retry or backoff transient page fetch failures (surface as
  `PaginationError(page_fetch_failed)`; consumers wrap with their
  own retry policy).
- resumable streams across process boundaries.
- Not a cache: each run hits the transport for the configured
  endpoint.

## References

- Plan: foundations-pivot F-13 pagination primitive.
- Linear: WATS-25 (Arch-K pagination primitive).
- Architecture: endpoint registry architecture endpoint registry + error taxonomy (pagination shape
  section).
- pywa reference: `list_media` / `download_media` cursor shape in
  `pywa/client.py`.
- Related: `docs/reference/endpoints.md` (F-6 defineEndpoint),
  `docs/reference/scoped-clients.md` (F-7 PhoneNumberClient /
  WABAClient).
