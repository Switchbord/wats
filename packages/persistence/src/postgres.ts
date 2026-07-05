import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  type LatestInboundMessageInput,
  type ListMessagesInput,
  type ListMessagesResult,
  type MessageDirection,
  type MessageRecord,
  type MessageRecordInput,
  type MessageStatusEventInput,
  type MigrationReport,
  type OutboxClaimInput,
  type OutboxEnqueueInput,
  type OutboxEnqueueResult,
  type OutboxFailedInput,
  type OutboxItem,
  type OutboxSucceededInput,
  type PersistenceHealth,
  type PersistenceStore,
  type ServiceRequestLookupInput,
  type ServiceRequestLookupResult,
  type ServiceRequestRecordInput,
  type WebhookEventRecordInput,
  type WebhookEventRecordResult
} from "./index";

export const REDACTED_POSTGRES_LOCATION = "[REDACTED_POSTGRES_DATABASE]" as const;

export interface PostgresPersistenceOptions {
  readonly connectionString: string;
}

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface PostgresClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
  end(): Promise<void>;
}

interface PostgresClientConstructor {
  new (config: { readonly connectionString: string }): PostgresClientLike;
}

interface MigrationDefinition {
  readonly id: string;
  readonly version: number;
  readonly checksum: string;
  readonly statements: readonly string[];
}

interface MigrationRow extends Record<string, unknown> {
  readonly id: string;
  readonly version: number | string;
  readonly checksum: string;
}

const OUTBOX_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const MAX_CONNECTION_STRING_LENGTH = 4096;

const POSTGRES_MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
  {
    id: "001_initial",
    version: 1,
    checksum: "sha256:wats-persistence-001-initial-v1",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS wats_schema_migrations (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS wats_persistence_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        holder TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS wats_webhook_events (
        event_key TEXT PRIMARY KEY,
        event_hash TEXT NOT NULL,
        received_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS wats_service_requests (
        idempotency_key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS wats_outbox (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at TEXT,
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ])
  },
  {
    id: "002_outbox_lease_id",
    version: 2,
    checksum: "sha256:wats-persistence-002-outbox-lease-id-v1",
    statements: Object.freeze([
      "ALTER TABLE wats_outbox ADD COLUMN lease_id INTEGER NOT NULL DEFAULT 0"
    ])
  },
  {
    id: "003_message_projection",
    version: 3,
    checksum: "sha256:wats-persistence-003-message-projection-v1",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS wats_messages (
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
      )`,
      `CREATE INDEX IF NOT EXISTS wats_messages_wa_message_id_idx ON wats_messages (wa_message_id)`,
      `CREATE INDEX IF NOT EXISTS wats_messages_created_at_idx ON wats_messages (created_at DESC, row_id DESC)`,
      `CREATE TABLE IF NOT EXISTS wats_message_status_events (
        id BIGSERIAL PRIMARY KEY,
        wa_message_id TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS wats_message_status_events_wa_message_id_idx ON wats_message_status_events (wa_message_id, id)`
    ])
  },
  {
    id: "004_inbound_window_index",
    version: 4,
    checksum: "sha256:wats-persistence-004-inbound-window-index-v1",
    statements: Object.freeze([
      `CREATE INDEX IF NOT EXISTS wats_messages_direction_from_phone_created_at_idx
        ON wats_messages (direction, from_phone, created_at DESC)`
    ])
  }
]);

function hasControlChars(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

function validateConnectionString(value: unknown): string {
  if (typeof value !== "string") {
    throw new PersistenceError("invalid_options", "Postgres connectionString must be a postgres:// or postgresql:// URL.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CONNECTION_STRING_LENGTH || hasControlChars(value)) {
    throw new PersistenceError("invalid_options", "Postgres connectionString must be a postgres:// or postgresql:// URL.");
  }
  if (!trimmed.startsWith("postgres://") && !trimmed.startsWith("postgresql://")) {
    throw new PersistenceError("invalid_options", "Postgres connectionString must be a postgres:// or postgresql:// URL.");
  }
  return trimmed;
}

function validateRecordInput(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PersistenceError("invalid_record", `${label} must be an object.`);
  return value;
}

function validateRecordString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 1024 || hasControlChars(value)) {
    throw new PersistenceError("invalid_record", `${label} must be a safe non-empty string.`);
  }
  return value;
}

function validateTimestamp(value: unknown, label: string): string {
  const raw = validateRecordString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(raw)) {
    throw new PersistenceError("invalid_record", `${label} must be an ISO timestamp.`);
  }
  if (new Date(raw).toISOString() !== raw) {
    throw new PersistenceError("invalid_record", `${label} must be an ISO timestamp.`);
  }
  return raw;
}

function validateOptionalRecordString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return validateRecordString(value, label);
}

function validatePayloadHash(value: unknown): string {
  const raw = validateRecordString(value, "payloadHash");
  if (!/^sha256:[a-f0-9]{64}$/u.test(raw)) {
    throw new PersistenceError("invalid_record", "payloadHash must be a sha256 hex digest.");
  }
  return raw;
}

function validateWebhookEventRecord(input: WebhookEventRecordInput): WebhookEventRecordInput {
  const record = validateRecordInput(input, "webhook event record");
  return Object.freeze({
    eventKey: validateRecordString(record.eventKey, "eventKey"),
    eventHash: validateRecordString(record.eventHash, "eventHash"),
    receivedAt: validateTimestamp(record.receivedAt, "receivedAt")
  });
}

function validateServiceRequestLookup(input: ServiceRequestLookupInput): ServiceRequestLookupInput {
  const record = validateRecordInput(input, "service request lookup");
  return Object.freeze({
    idempotencyKey: validateRecordString(record.idempotencyKey, "idempotencyKey"),
    requestHash: validateRecordString(record.requestHash, "requestHash")
  });
}

function validateServiceRequestRecord(input: ServiceRequestRecordInput): ServiceRequestRecordInput {
  const record = validateRecordInput(input, "service request record");
  const responseJson = validateRecordString(record.responseJson, "responseJson");
  try {
    JSON.parse(responseJson);
  } catch (cause) {
    throw new PersistenceError("invalid_record", "responseJson must be valid JSON.", { cause });
  }
  return Object.freeze({
    idempotencyKey: validateRecordString(record.idempotencyKey, "idempotencyKey"),
    requestHash: validateRecordString(record.requestHash, "requestHash"),
    responseJson,
    createdAt: validateTimestamp(record.createdAt, "createdAt")
  });
}

function validateOutboxEnqueue(input: OutboxEnqueueInput): Required<OutboxEnqueueInput> {
  const record = validateRecordInput(input, "outbox item");
  const createdAt = validateTimestamp(record.createdAt, "createdAt");
  const nextAttemptAt = record.nextAttemptAt === undefined || record.nextAttemptAt === null
    ? createdAt
    : validateTimestamp(record.nextAttemptAt, "nextAttemptAt");
  return Object.freeze({
    id: validateRecordString(record.id, "id"),
    payloadHash: validatePayloadHash(record.payloadHash),
    createdAt,
    nextAttemptAt
  });
}

function validateOutboxClaim(input: OutboxClaimInput): OutboxClaimInput {
  const record = validateRecordInput(input, "outbox claim");
  if (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1 || record.limit > 100) {
    throw new PersistenceError("invalid_record", "limit must be an integer from 1 to 100.");
  }
  return Object.freeze({ now: validateTimestamp(record.now, "now"), limit: record.limit });
}

function validateLeaseId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
    throw new PersistenceError("invalid_record", "leaseId must be a positive safe integer.");
  }
  return value;
}

function validateOutboxFailed(input: OutboxFailedInput): OutboxFailedInput {
  const record = validateRecordInput(input, "outbox failure");
  return Object.freeze({
    id: validateRecordString(record.id, "id"),
    leaseId: validateLeaseId(record.leaseId),
    nextAttemptAt: validateTimestamp(record.nextAttemptAt, "nextAttemptAt"),
    updatedAt: validateTimestamp(record.updatedAt, "updatedAt")
  });
}

function validateOutboxSucceeded(input: OutboxSucceededInput): OutboxSucceededInput {
  const record = validateRecordInput(input, "outbox success");
  return Object.freeze({
    id: validateRecordString(record.id, "id"),
    leaseId: validateLeaseId(record.leaseId),
    updatedAt: validateTimestamp(record.updatedAt, "updatedAt")
  });
}

function validateMessageDirection(value: unknown): MessageDirection {
  if (value !== "inbound" && value !== "outbound") {
    throw new PersistenceError("invalid_record", "direction must be \"inbound\" or \"outbound\".");
  }
  return value;
}

function validateMessageRecord(input: MessageRecordInput): {
  rowId: string;
  waMessageId: string;
  direction: MessageDirection;
  fromPhone: string | null;
  toPhone: string | null;
  type: string;
  status: string;
  graphMessageId: string | null;
  createdAt: string;
  updatedAt: string;
} {
  const record = validateRecordInput(input, "message record");
  return Object.freeze({
    rowId: validateRecordString(record.rowId, "rowId"),
    waMessageId: validateRecordString(record.waMessageId, "waMessageId"),
    direction: validateMessageDirection(record.direction),
    fromPhone: validateOptionalRecordString(record.fromPhone, "fromPhone"),
    toPhone: validateOptionalRecordString(record.toPhone, "toPhone"),
    type: validateRecordString(record.type, "type"),
    status: validateRecordString(record.status, "status"),
    graphMessageId: validateOptionalRecordString(record.graphMessageId, "graphMessageId"),
    createdAt: validateTimestamp(record.createdAt, "createdAt"),
    updatedAt: validateTimestamp(record.updatedAt, "updatedAt")
  });
}

function validateMessageStatusEvent(input: MessageStatusEventInput): {
  waMessageId: string;
  status: string;
  timestamp: string;
} {
  const record = validateRecordInput(input, "message status event");
  return Object.freeze({
    waMessageId: validateRecordString(record.waMessageId, "waMessageId"),
    status: validateRecordString(record.status, "status"),
    timestamp: validateTimestamp(record.timestamp, "timestamp")
  });
}

function validateListMessages(input: ListMessagesInput): { limit: number; beforeRowId: string | null } {
  const record = validateRecordInput(input, "message list");
  if (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1 || record.limit > 100) {
    throw new PersistenceError("invalid_record", "limit must be an integer from 1 to 100.");
  }
  return Object.freeze({
    limit: record.limit,
    beforeRowId: validateOptionalRecordString(record.beforeRowId, "beforeRowId")
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function subtractMillisecondsIso(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() - milliseconds).toISOString();
}

function migrationById(id: string): MigrationDefinition | undefined {
  return POSTGRES_MIGRATIONS.find((migration) => migration.id === id);
}

function numeric(value: number | string): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function outboxRowToItem(row: {
  id: string;
  status: string;
  attempts: number | string;
  lease_id: number | string;
  next_attempt_at: string | null;
  payload_hash: string;
  created_at: string;
  updated_at: string;
}): OutboxItem {
  return Object.freeze({
    id: row.id,
    status: row.status as OutboxItem["status"],
    attempts: numeric(row.attempts),
    leaseId: numeric(row.lease_id),
    payloadHash: row.payload_hash,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

interface MessageRow extends Record<string, unknown> {
  row_id: string;
  wa_message_id: string;
  direction: string;
  from_phone: string | null;
  to_phone: string | null;
  type: string;
  status: string;
  graph_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function messageRowToRecord(row: MessageRow): MessageRecord {
  return Object.freeze({
    rowId: row.row_id,
    waMessageId: row.wa_message_id,
    direction: row.direction as MessageDirection,
    fromPhone: row.from_phone,
    toPhone: row.to_phone,
    type: row.type,
    status: row.status,
    graphMessageId: row.graph_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

class PostgresPersistenceStore implements PersistenceStore {
  readonly backend = "postgres" as const;
  #client: PostgresClientLike;
  #closed = false;

  constructor(client: PostgresClientLike) {
    this.#client = client;
  }

  async migrate(): Promise<MigrationReport> {
    this.#assertOpen();
    await this.#client.query(`CREATE TABLE IF NOT EXISTS wats_persistence_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      holder TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    )`);
    await this.#client.query(`CREATE TABLE IF NOT EXISTS wats_schema_migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);

    const holder = `wats-${Math.random().toString(36).slice(2)}`;
    try {
      const lock = await this.#client.query(
        "INSERT INTO wats_persistence_lock (id, holder, acquired_at) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING",
        [holder, nowIso()]
      );
      if (lock.rowCount !== 1) throw new PersistenceError("migration_lock_failed", "Postgres migration lock is already held.");
      await this.#validateAppliedChecksums();
      const applied: string[] = [];
      for (const migration of POSTGRES_MIGRATIONS) {
        const existing = await this.#client.query(
          "SELECT id FROM wats_schema_migrations WHERE id = $1",
          [migration.id]
        );
        if (existing.rows.length > 0 || (existing.rowCount ?? 0) > 0) continue;
        await this.#client.query("BEGIN");
        try {
          for (const statement of migration.statements) await this.#client.query(statement);
          await this.#client.query(
            "INSERT INTO wats_schema_migrations (id, version, checksum, applied_at) VALUES ($1, $2, $3, $4)",
            [migration.id, migration.version, migration.checksum, nowIso()]
          );
          await this.#client.query("COMMIT");
          applied.push(migration.id);
        } catch (cause) {
          await this.#client.query("ROLLBACK");
          throw new PersistenceError("migration_failed", "Postgres migration failed.", { cause });
        }
      }
      return Object.freeze({ currentVersion: CURRENT_SCHEMA_VERSION, appliedMigrations: Object.freeze(applied), alreadyCurrent: applied.length === 0 });
    } finally {
      await this.#releaseLock(holder);
    }
  }

  async health(): Promise<PersistenceHealth> {
    this.#assertOpen();
    const result = await this.#client.query<{ version: number | string }>("SELECT COALESCE(MAX(version), 0) AS version FROM wats_schema_migrations");
    const version = result.rows[0]?.version;
    return Object.freeze({ ok: true, backend: "postgres", currentVersion: version === undefined ? 0 : numeric(version), redactedLocation: REDACTED_POSTGRES_LOCATION });
  }

  async recordWebhookEvent(input: WebhookEventRecordInput): Promise<WebhookEventRecordResult> {
    this.#assertOpen();
    const record = validateWebhookEventRecord(input);
    const result = await this.#client.query(
      "INSERT INTO wats_webhook_events (event_key, event_hash, received_at) VALUES ($1, $2, $3) ON CONFLICT (event_key) DO NOTHING",
      [record.eventKey, record.eventHash, record.receivedAt]
    );
    return result.rowCount === 1 ? "recorded" : "duplicate";
  }

  async getServiceRequest(input: ServiceRequestLookupInput): Promise<ServiceRequestLookupResult> {
    this.#assertOpen();
    const lookup = validateServiceRequestLookup(input);
    const result = await this.#client.query<{ request_hash: string; response_json: string }>(
      "SELECT request_hash, response_json FROM wats_service_requests WHERE idempotency_key = $1",
      [lookup.idempotencyKey]
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    if (row.request_hash !== lookup.requestHash) return "conflict";
    return Object.freeze({ responseJson: row.response_json });
  }

  async recordServiceRequest(input: ServiceRequestRecordInput): Promise<void> {
    this.#assertOpen();
    const record = validateServiceRequestRecord(input);
    await this.#client.query(
      "INSERT INTO wats_service_requests (idempotency_key, request_hash, response_json, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING",
      [record.idempotencyKey, record.requestHash, record.responseJson, record.createdAt]
    );
  }

  async enqueueOutboxItem(input: OutboxEnqueueInput): Promise<OutboxEnqueueResult> {
    this.#assertOpen();
    const item = validateOutboxEnqueue(input);
    const result = await this.#client.query(
      "INSERT INTO wats_outbox (id, status, attempts, next_attempt_at, payload_hash, created_at, updated_at) VALUES ($1, 'pending', 0, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
      [item.id, item.nextAttemptAt, item.payloadHash, item.createdAt, item.createdAt]
    );
    return result.rowCount === 1 ? "enqueued" : "duplicate";
  }

  async claimOutboxItems(input: OutboxClaimInput): Promise<readonly OutboxItem[]> {
    this.#assertOpen();
    const claim = validateOutboxClaim(input);
    const leaseExpiredAt = subtractMillisecondsIso(claim.now, OUTBOX_PROCESSING_LEASE_MS);
    await this.#client.query("BEGIN");
    try {
      const result = await this.#client.query<{
        id: string;
        status: string;
        attempts: number | string;
        lease_id: number | string;
        next_attempt_at: string | null;
        payload_hash: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, status, attempts, lease_id, next_attempt_at, payload_hash, created_at, updated_at
         FROM wats_outbox
         WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1))
            OR (status = 'processing' AND updated_at <= $2)
         ORDER BY created_at ASC, id ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [claim.now, leaseExpiredAt, claim.limit]
      );
      const rows = result.rows;
      for (const row of rows) {
        const update = await this.#client.query(
          "UPDATE wats_outbox SET status = 'processing', attempts = attempts + 1, lease_id = lease_id + 1, next_attempt_at = NULL, updated_at = $1 WHERE id = $2 AND status = $3 AND lease_id = $4",
          [claim.now, row.id, row.status, numeric(row.lease_id)]
        );
        if (update.rowCount !== 1) throw new PersistenceError("outbox_failed", "Postgres outbox claim lease changed during claim.");
      }
      await this.#client.query("COMMIT");
      return Object.freeze(rows.map((row) => outboxRowToItem({ ...row, status: "processing", attempts: numeric(row.attempts) + 1, lease_id: numeric(row.lease_id) + 1, next_attempt_at: null, updated_at: claim.now })));
    } catch (cause) {
      await this.#client.query("ROLLBACK");
      if (cause instanceof PersistenceError) throw cause;
      throw new PersistenceError("outbox_failed", "Postgres outbox claim failed.", { cause });
    }
  }

  async markOutboxItemFailed(input: OutboxFailedInput): Promise<void> {
    this.#assertOpen();
    const failure = validateOutboxFailed(input);
    const result = await this.#client.query(
      "UPDATE wats_outbox SET status = 'pending', next_attempt_at = $1, updated_at = $2 WHERE id = $3 AND status = 'processing' AND lease_id = $4",
      [failure.nextAttemptAt, failure.updatedAt, failure.id, failure.leaseId]
    );
    if (result.rowCount !== 1) throw new PersistenceError("outbox_failed", "Postgres outbox failure lease is stale.");
  }

  async markOutboxItemSucceeded(input: OutboxSucceededInput): Promise<void> {
    this.#assertOpen();
    const success = validateOutboxSucceeded(input);
    const result = await this.#client.query(
      "UPDATE wats_outbox SET status = 'succeeded', next_attempt_at = NULL, updated_at = $1 WHERE id = $2 AND status = 'processing' AND lease_id = $3",
      [success.updatedAt, success.id, success.leaseId]
    );
    if (result.rowCount !== 1) throw new PersistenceError("outbox_failed", "Postgres outbox success lease is stale.");
  }

  async recordMessage(input: MessageRecordInput): Promise<void> {
    this.#assertOpen();
    const record = validateMessageRecord(input);
    await this.#client.query(
      `INSERT INTO wats_messages
        (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (row_id) DO NOTHING`,
      [record.rowId, record.waMessageId, record.direction, record.fromPhone, record.toPhone, record.type, record.status, record.graphMessageId, record.createdAt, record.updatedAt]
    );
  }

  async appendMessageStatus(input: MessageStatusEventInput): Promise<void> {
    this.#assertOpen();
    const event = validateMessageStatusEvent(input);
    await this.#client.query("BEGIN");
    try {
      await this.#client.query(
        "INSERT INTO wats_message_status_events (wa_message_id, status, timestamp) VALUES ($1, $2, $3)",
        [event.waMessageId, event.status, event.timestamp]
      );
      await this.#client.query(
        "UPDATE wats_messages SET status = $1, updated_at = $2 WHERE wa_message_id = $3",
        [event.status, event.timestamp, event.waMessageId]
      );
      await this.#client.query("COMMIT");
    } catch (cause) {
      await this.#client.query("ROLLBACK");
      throw new PersistenceError("invalid_record", "Postgres message status append failed.", { cause });
    }
  }

  async getMessage(input: { waMessageId: string }): Promise<MessageRecord | null> {
    this.#assertOpen();
    const record = validateRecordInput(input, "message lookup");
    const waMessageId = validateRecordString(record.waMessageId, "waMessageId");
    const result = await this.#client.query<MessageRow>(
      `SELECT row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at
       FROM wats_messages WHERE wa_message_id = $1`,
      [waMessageId]
    );
    const row = result.rows[0];
    return row === undefined ? null : messageRowToRecord(row);
  }

  async listMessages(input: ListMessagesInput): Promise<ListMessagesResult> {
    this.#assertOpen();
    const query = validateListMessages(input);
    const fetchLimit = query.limit + 1;
    let rows: readonly MessageRow[];
    if (query.beforeRowId === null) {
      rows = (await this.#client.query<MessageRow>(
        `SELECT row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at
         FROM wats_messages
         ORDER BY created_at DESC, row_id DESC
         LIMIT $1`,
        [fetchLimit]
      )).rows;
    } else {
      const cursor = await this.#client.query<{ row_id: string; created_at: string }>(
        "SELECT row_id, created_at FROM wats_messages WHERE row_id = $1",
        [query.beforeRowId]
      );
      const cursorRow = cursor.rows[0];
      if (cursorRow === undefined) return Object.freeze({ items: Object.freeze([]), nextCursor: null });
      rows = (await this.#client.query<MessageRow>(
        `SELECT row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at
         FROM wats_messages
         WHERE created_at < $1 OR (created_at = $2 AND row_id < $3)
         ORDER BY created_at DESC, row_id DESC
         LIMIT $4`,
        [cursorRow.created_at, cursorRow.created_at, cursorRow.row_id, fetchLimit]
      )).rows;
    }
    const pageRows = rows.slice(0, query.limit);
    const items = Object.freeze(pageRows.map((row) => messageRowToRecord(row)));
    const nextCursor = rows.length > query.limit ? items[items.length - 1]?.rowId ?? null : null;
    return Object.freeze({ items, nextCursor });
  }

  async getLatestInboundMessageAt(input: LatestInboundMessageInput): Promise<string | null> {
    this.#assertOpen();
    const record = validateRecordInput(input, "latest inbound lookup");
    const phone = validateRecordString(record.phone, "phone");
    const result = await this.#client.query<{ created_at: string }>(
      `SELECT created_at FROM wats_messages
       WHERE direction = 'inbound' AND from_phone = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone]
    );
    const row = result.rows[0];
    return row === undefined ? null : row.created_at;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#client.end();
  }

  async #releaseLock(holder: string): Promise<void> {
    try {
      await this.#client.query("DELETE FROM wats_persistence_lock WHERE id = 1 AND holder = $1", [holder]);
    } catch {
      // Best-effort cleanup; the caller already completed or is throwing a typed error.
    }
  }

  async #validateAppliedChecksums(): Promise<void> {
    const result = await this.#client.query<MigrationRow>("SELECT id, version, checksum FROM wats_schema_migrations ORDER BY version ASC");
    for (const row of result.rows) {
      const expected = migrationById(row.id);
      if (expected === undefined || expected.version !== numeric(row.version) || expected.checksum !== row.checksum) {
        throw new PersistenceError("migration_checksum_mismatch", "Postgres migration checksum mismatch.");
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new PersistenceError("store_closed", "Persistence store is closed.");
  }
}

export async function createPostgresPersistence(options: PostgresPersistenceOptions): Promise<PersistenceStore> {
  const connectionString = validateConnectionString(options?.connectionString);
  const specifier = "pg";
  let Client: PostgresClientConstructor | undefined;
  try {
    const mod = await import(specifier) as unknown as { readonly Client?: PostgresClientConstructor; readonly default?: PostgresClientConstructor | { readonly Client?: PostgresClientConstructor } };
    const defaultExport = mod.default;
    Client = mod.Client ?? (typeof defaultExport === "function" ? defaultExport : defaultExport?.Client);
  } catch (cause) {
    throw new PersistenceError("invalid_options", "Postgres persistence requires the optional 'pg' package.", { cause });
  }
  if (Client === undefined) {
    throw new PersistenceError("invalid_options", "Postgres persistence requires the optional 'pg' package.");
  }
  return createPostgresPersistenceWithClient(new Client({ connectionString }));
}

export function createPostgresPersistenceWithClient(client: PostgresClientLike): PersistenceStore {
  if (client === null || typeof client !== "object" || typeof client.query !== "function" || typeof client.end !== "function") {
    throw new PersistenceError("invalid_options", "Postgres client must expose query and end functions.");
  }
  return new PostgresPersistenceStore(client);
}
