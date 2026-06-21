# WATS-122 Builder Brief — outbound message event-store projection + read-only service routes

Worktree: `/root/wats-wave2/wats-122` (branch `feat/wats-122`, based on `origin/main` @ f30d6a5).
You are a LEAF builder. Do NOT push, merge, deploy, bump version, close Linear, or add an `## [Unreleased]` CHANGELOG section. Commit clean local branch work only.

## Goal (narrow first slice)

Add a persisted **outbound message send-attempt projection** to `@wats/persistence` and expose it through **read-only** service routes `GET /api/messages` and `GET /api/messages/{id}` in `@wats/service`, so CLI/UI consumers can inspect locally-sent messages. This is the WATS-122 "event-store projections + read-only service routes" first slice. Inbound message projection, status-webhook event recording, conversation-ID derivation, and contacts projection are EXPLICIT NON-GOALS (follow-up slices).

## Exact scope — files & contract

### 1. `packages/persistence/src/index.ts`

Bump `CURRENT_SCHEMA_VERSION` from `2` to `3`. Add these exported types and extend the `PersistenceStore` interface:

```ts
export type MessageDirection = "inbound" | "outbound";

export interface MessageRecordInput {
  readonly rowId: string;          // UUID-ish local id (caller-generated)
  readonly waMessageId: string;    // wamid.* from Graph response
  readonly direction: MessageDirection;
  readonly fromPhone?: string;     // optional, omit when unknown
  readonly toPhone?: string;
  readonly type: string;           // "text" | "image" | ... (Graph type)
  readonly status: string;         // "sent" | "delivered" | "read" | "failed" | ...
  readonly graphMessageId?: string;// same as waMessageId for outbound; nullable
  readonly createdAt: string;      // strict ISO ms (see validateTimestamp)
  readonly updatedAt: string;      // strict ISO ms
}

export interface MessageRecord {
  readonly rowId: string;
  readonly waMessageId: string;
  readonly direction: MessageDirection;
  readonly fromPhone: string | null;
  readonly toPhone: string | null;
  readonly type: string;
  readonly status: string;
  readonly graphMessageId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageStatusEventInput {
  readonly waMessageId: string;
  readonly status: string;
  readonly timestamp: string;      // strict ISO ms
}

export interface MessageStatusEventRecord {
  readonly id: number;
  readonly waMessageId: string;
  readonly status: string;
  readonly timestamp: string;
}

export interface ListMessagesInput {
  readonly limit: number;          // 1..100
  readonly beforeRowId?: string;   // cursor: rows with row_id < beforeRowId (older)
}

export interface ListMessagesResult {
  readonly items: readonly MessageRecord[];
  readonly nextCursor: string | null;  // rowId of last item if more may exist, else null
}
```

Add to `PersistenceStore` interface:
```ts
recordMessage(input: MessageRecordInput): Promise<void>;
appendMessageStatus(input: MessageStatusEventInput): Promise<void>;
getMessage(input: { waMessageId: string }): Promise<MessageRecord | null>;
listMessages(input: ListMessagesInput): Promise<ListMessagesResult>;
```

Reuse existing `validateRecordString`/`validateTimestamp`/`validateRecordInput` helpers. Validate `limit` is integer 1..100 (mirror `validateOutboxClaim`). `rowId`/`waMessageId`/`direction`/`type`/`status` must be safe non-empty strings (≤1024, no control chars). `direction` must be `"inbound"` or `"outbound"`. Optional phone/graphMessageId: when provided, validate as safe string; `undefined`/`null` → stored as SQL NULL.

### 2. `packages/persistence/src/sqlite.ts`

Add migration `003_message_projection` (version 3, checksum `sha256:wats-persistence-003-message-projection-v1`):

```sql
CREATE TABLE IF NOT EXISTS wats_messages (
  row_id TEXT PRIMARY KEY,
  wa_message_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_phone TEXT,
  to_phone TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  graph_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wats_messages_wa_message_id_idx ON wats_messages (wa_message_id);
CREATE INDEX IF NOT EXISTS wats_messages_created_at_idx ON wats_messages (created_at DESC, row_id DESC);
CREATE TABLE IF NOT EXISTS wats_message_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wats_message_status_events_wa_message_id_idx ON wats_message_status_events (wa_message_id, id);
```

Implement the four new methods on `SqlitePersistenceStore`:
- `recordMessage`: `INSERT OR REPLACE`? NO — use `INSERT` and on UNIQUE constraint (row_id or duplicate wa_message_id) throw `PersistenceError("invalid_record", ...)` is wrong. Decision: `INSERT` with `ON CONFLICT(row_id) DO UPDATE` is acceptable so re-recording the same rowId is idempotent. Simpler: `INSERT OR IGNORE` for row_id and if it was ignored (changes===0) just return (idempotent re-record). Use `INSERT OR IGNORE`.
- `appendMessageStatus`: insert event row; then `UPDATE wats_messages SET status = ?, updated_at = ? WHERE wa_message_id = ?` (best-effort; no-op if no matching message). Wrap in a transaction.
- `getMessage`: SELECT by wa_message_id, return `MessageRecord | null`.
- `listMessages`: SELECT `... ORDER BY created_at DESC, row_id DESC LIMIT ?` plus optional `WHERE row_id < ?` cursor. Return items + `nextCursor` (last item's rowId if items.length === limit, else null).

Map snake_case columns → camelCase in a `messageRowToRecord` helper (mirror `outboxRowToItem`).

### 3. `packages/service/src/index.ts`

Extend `validatePersistence` to also require the four new methods (`recordMessage`, `appendMessageStatus`, `getMessage`, `listMessages`) — add to the duck-typed method checks, throwing `WatsServiceError("invalid_persistence", ...)` if missing.

In `handleTextMessage` and `handleGenericMessage`, AFTER a successful Graph send and AFTER the existing idempotency-record block, when `ctx.persistence !== undefined`, record the outbound message:
```ts
const waMessageId = extractGraphMessageId(result); // see helper below
if (waMessageId !== null && ctx.persistence !== undefined) {
  const now = new Date().toISOString();
  await ctx.persistence.recordMessage({
    rowId: cryptoRandomId(),     // see helper
    waMessageId,
    direction: "outbound",
    toPhone: input.to,           // for text; for generic use body.to
    type: messageType,           // "text" for text route; for generic infer from body.type
    status: "sent",
    graphMessageId: waMessageId,
    createdAt: now,
    updatedAt: now
  }).catch(() => {}); // projection failure must NOT break the send response
  await ctx.persistence.appendMessageStatus({
    waMessageId, status: "sent", timestamp: now
  }).catch(() => {});
}
```
Add helpers:
- `extractGraphMessageId(result: unknown): string | null` — read `result.messages[0].id` defensively (result may be a record; messages may be array; id string). Return null on any shape miss.
- `cryptoRandomId(): string` — use `globalThis.crypto?.randomUUID?.() ?? <fallback>`; fallback `wats-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`. Keep it dependency-free.

Add two read-only routes in `createWatsServiceApp.fetch`, BEFORE the final 404, AFTER the group-routes block:
- `GET ${ctx.messagesPath}` → list. Requires bearer auth (`isAuthorized`). If `ctx.persistence === undefined` return `errorResponse(503, "persistence_not_configured", "Message projections require a persistence store.")`. Parse query `limit` (default 50, clamp 1..100) and `cursor` (optional beforeRowId). Return `jsonResponse(200, { items, nextCursor })`.
- `GET ${ctx.messagesPath}/{id}` → single. Match `path.startsWith(ctx.messagesPath + "/")`; the segment after is the wa_message_id (URL-decoded, validate safe non-empty ≤1024 no control chars; reject otherwise 400). Bearer auth. If no persistence → 503 `persistence_not_configured`. `getMessage({ waMessageId })` → 404 `not_found` if null, else `jsonResponse(200, record)`.
- Method-not-allowed: for these GET routes, if method is not GET return `methodNotAllowed("GET")`. Note `${ctx.messagesPath}` POST already exists — only add GET handling there.

Add a route-collision guard in `assertNoRouteCollisions`? The new GET routes share the existing `messagesPath` prefix — no new static path, so no collision change needed. But add the `{id}` sub-path: no collision with `/messages/text` because text is a distinct segment; still, guard: if a wa_message_id equals "text" it would collide with POST `/messages/text` — but methods differ (GET vs POST) so it's fine. Document this.

OpenAPI (`createWatsServiceOpenApiDocument`): add `GET ${messagesPath}` and `GET ${messagesPath}/{messageId}` operations to the `paths` object, with `serviceBearerAuth` security, 200 response (schema for list + single), 401, 404, 503. Add component schemas `MessageRecord`, `MessageListResponse`, `MessageStatusEvent`. Only include these paths when... actually always include them in the doc (they exist regardless of persistence; the 503 handles the no-persistence case). Mirror the existing groups-paths conditional style if cleaner, but unconditional is acceptable.

### 4. Tests (RED first, then GREEN)

Create `packages/persistence/tests/messages.test.ts`:
- migrate fresh temp sqlite store;
- `recordMessage` then `getMessage` returns the record with correct camelCase;
- duplicate `recordMessage` (same rowId) is idempotent (no throw);
- `appendMessageStatus` inserts event and updates `wats_messages.status`;
- `listMessages` returns newest-first, respects limit, returns nextCursor when more exist, honors beforeRowId cursor;
- malformed inputs (bad direction, bad limit, control chars, bad timestamp) throw `PersistenceError`;
- `getMessage` for unknown waMessageId returns null.

Create `packages/service/tests/wats122-message-projection.test.ts`:
- Use the `createLocalMockTransport` + `memoryStore` pattern from `wats121-persistence.test.ts`, EXTENDED with the four new no-op/stub methods (copy the MemoryStore type and add the new methods; keep it in this test file).
- After a successful `POST /api/messages/text` with persistence injected, `GET /api/messages` (bearer auth) returns `{ items: [{ waMessageId: "wamid.TEST", direction: "outbound", status: "sent", ... }], nextCursor: null }`.
- `GET /api/messages/wamid.TEST` returns the single record.
- `GET /api/messages/unknown` → 404 `not_found`.
- Without bearer → 401.
- Without persistence injected → `GET /api/messages` returns 503 `persistence_not_configured`.
- Projection failure does not break the send (inject a store whose `recordMessage` throws; assert send still returns 200 with the Graph result).
- OpenAPI doc (`createWatsServiceOpenApiDocument`) contains both GET paths with bearer security.

Update `packages/service/tests/wats121-persistence.test.ts`: the `MemoryStore` type + `memoryStore()` factory must be extended with the four new methods (stub them: `recordMessage`/`appendMessageStatus` no-op, `getMessage` returns null, `listMessages` returns `{ items: [], nextCursor: null }`). Otherwise TS breaks.

Update `packages/service/tests/openapi.test.ts` ONLY if it asserts a fixed path count — add the two new paths to any count assertion. Check first; if it uses `operation(doc, path, method)` per-test without a total-count lock, no change needed beyond optionally adding positive assertions for the new paths.

### 5. Docs lockstep (public behavior change — docs are definition-of-done)

- `site/content/docs/reference/service.mdx`: document the two new read-only GET routes, the 503 `persistence_not_configured` behavior, and the JSON shape (`MessageRecord`, list response). Follow VOICE.md (terse, no marketing filler, no ticket archaeology like "WATS-122" in the public doc — describe what it does). Update `<DocMeta lastReviewed="2026-06-21" />`.
- `site/content/docs/reference/persistence.mdx`: document the new `wats_messages` + `wats_message_status_events` tables and the four new `PersistenceStore` methods. Update `lastReviewed`.
- `site/content/docs/parity.mdx`: add a row for "Message event-store projection (outbound)" status `shape-only` (credential-free; no live validation this slice) — or `partial`. Use the exact honesty taxonomy.
- NO `## [Unreleased]` CHANGELOG section (forbidden this cycle). Do NOT touch CHANGELOG.md.
- Do NOT run `bun run docs:build`/`check-publish` — those need the full site build; just run the focused tests + typecheck. The parent verifies in the canonical checkout.

### 6. Gates to run in the worktree (report exact results)

```sh
cd /root/wats-wave2/wats-122
bun install --frozen-lockfile
bun run build:packages
bun test packages/persistence/tests/messages.test.ts \
  packages/persistence/tests/records.test.ts \
  packages/persistence/tests/sqlite.test.ts \
  packages/service/tests/wats122-message-projection.test.ts \
  packages/service/tests/wats121-persistence.test.ts \
  packages/service/tests/wats121-persistence-poisoning.test.ts \
  packages/service/tests/service.test.ts \
  packages/service/tests/openapi.test.ts \
  packages/service/tests/wats130-error-transparency.test.ts \
  --timeout 15000
bun run typecheck
bun run api:check   # if it has a count lock that now changes, update the manifest — but new service routes are NOT graph endpoint subpaths, so api:check likely unaffected. Report if it fails.
```

`git diff --check` must be clean. Commit with `git commit -m "feat(persistence,service): WATS-122 outbound message projection + read-only /api/messages routes"`. Make a separate RED commit first (tests failing) then the GREEN commit, OR one combined commit if RED-then-GREEN in one commit is cleaner — prefer two commits (RED, GREEN) to mirror project discipline. Use `git config user.email` only if commits fail on author.

## Non-goals (state these in your final summary)

- Inbound message projection (from webhook TypedUpdate) — follow-up.
- Status-webhook event recording (parsing TypedUpdate status) — follow-up.
- Conversation-ID derivation + `GET /api/conversations` + `/api/conversations/{id}` — follow-up.
- Contacts projection + `GET /api/contacts` — follow-up.
- Postgres adapter for new tables — follow-up.
- CLI thread navigation / status UI — follow-up.
- Outbox worker integration with projections — follow-up.
- Raw webhook body storage — never (privacy).
- No live Meta calls, no Railway, no npm, no version bump, no Unreleased changelog, no Linear close.

## Report back

Report: files changed, commit SHAs, exact gate output (pass/fail per command), the JSON shape of `GET /api/messages` and `GET /api/messages/{id}`, and any blocker.
