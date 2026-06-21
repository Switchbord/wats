import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  REDACTED_SQLITE_LOCATION,
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

interface BunSqliteRunResult {
  readonly changes?: number;
}

interface BunSqliteDatabase {
  run(sql: string, ...params: unknown[]): BunSqliteRunResult;
  exec(sql: string): unknown;
  close(): void;
  query<T = Record<string, unknown>>(sql: string): {
    get(...params: unknown[]): T | null;
    all(...params: unknown[]): T[];
  };
}

interface BunSqliteModule {
  Database: new (filename: string, options?: { readonly?: boolean; create?: boolean }) => BunSqliteDatabase;
}

export interface SqlitePersistenceOptions {
  readonly filename: string;
  readonly readonly?: boolean;
}

interface MigrationDefinition {
  readonly id: string;
  readonly version: number;
  readonly checksum: string;
  readonly statements: readonly string[];
}

interface MigrationRow {
  readonly id: string;
  readonly version: number;
  readonly checksum: string;
}

const SQLITE_MEMORY = ":memory:";
const MAX_FILENAME_LENGTH = 4096;
const MIGRATION_LOCK_ID = 1;
const OUTBOX_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_message_id TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS wats_message_status_events_wa_message_id_idx ON wats_message_status_events (wa_message_id, id)`
    ])
  }
]);

function hasControlChars(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function containsUnsafePathSegment(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes(":") ||
    value.split("/").some((segment) => segment === ".." || segment === ".") ||
    lower.includes("%2e%2e") ||
    lower.includes("%252e%252e") ||
    lower.includes("%2f") ||
    lower.includes("%252f") ||
    lower.includes("%5c") ||
    lower.includes("%255c")
  );
}

function looksTokenLike(value: string): boolean {
  const lower = value.toLowerCase();
  return /(?:^|[^a-z])(token|secret|passwd|password|bearer|authorization|access[_-]?token)(?:[^a-z]|$)/u.test(lower);
}

function validateFilename(value: unknown): string {
  if (typeof value !== "string") {
    throw new PersistenceError("invalid_filename", "SQLite filename must be a safe local path or :memory:.");
  }
  if (value === SQLITE_MEMORY) return value;
  if (value.trim().length === 0 || value.length > MAX_FILENAME_LENGTH || hasControlChars(value)) {
    throw new PersistenceError("invalid_filename", "SQLite filename must be a safe local path or :memory:.");
  }
  if (containsUnsafePathSegment(value) || looksTokenLike(value)) {
    throw new PersistenceError("invalid_filename", "SQLite filename must be a safe local path or :memory:.");
  }
  return value;
}

function isOptionsRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype;
}

function validateOptions(options: SqlitePersistenceOptions): { filename: string; readonly: boolean } {
  if (!isOptionsRecord(options)) {
    throw new PersistenceError("invalid_options", "SQLite persistence options must be an object.");
  }
  const filename = validateFilename(options.filename);
  const readonly = options.readonly;
  if (readonly !== undefined && typeof readonly !== "boolean") {
    throw new PersistenceError("invalid_options", "SQLite persistence readonly option must be boolean.");
  }
  return { filename, readonly: readonly ?? false };
}

function validateRecordInput(value: unknown, label: string): Record<string, unknown> {
  if (!isOptionsRecord(value)) {
    throw new PersistenceError("invalid_record", `${label} must be an object.`);
  }
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
  const normalized = new Date(raw).toISOString();
  if (normalized !== raw) {
    throw new PersistenceError("invalid_record", `${label} must be an ISO timestamp.`);
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

function validatePayloadHash(value: unknown): string {
  const raw = validateRecordString(value, "payloadHash");
  if (!/^sha256:[a-f0-9]{64}$/u.test(raw)) {
    throw new PersistenceError("invalid_record", "payloadHash must be a sha256 hex digest.");
  }
  return raw;
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

function outboxRowToItem(row: {
  id: string;
  status: string;
  attempts: number;
  lease_id: number;
  next_attempt_at: string | null;
  payload_hash: string;
  created_at: string;
  updated_at: string;
}): OutboxItem {
  return Object.freeze({
    id: row.id,
    status: row.status as OutboxItem["status"],
    attempts: row.attempts,
    leaseId: row.lease_id,
    payloadHash: row.payload_hash,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function validateMessageDirection(value: unknown): MessageDirection {
  if (value !== "inbound" && value !== "outbound") {
    throw new PersistenceError("invalid_record", "direction must be \"inbound\" or \"outbound\".");
  }
  return value;
}

function validateOptionalRecordString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return validateRecordString(value, label);
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

function validateListMessages(input: ListMessagesInput): {
  limit: number;
  beforeRowId: string | null;
} {
  const record = validateRecordInput(input, "message list");
  if (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1 || record.limit > 100) {
    throw new PersistenceError("invalid_record", "limit must be an integer from 1 to 100.");
  }
  const beforeRowId = validateOptionalRecordString(record.beforeRowId, "beforeRowId");
  return Object.freeze({ limit: record.limit, beforeRowId });
}

interface MessageRow {
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

function subtractMillisecondsIso(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() - milliseconds).toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

function migrationById(id: string): MigrationDefinition | undefined {
  return MIGRATIONS.find((migration) => migration.id === id);
}

async function loadBunSqlite(): Promise<BunSqliteModule> {
  try {
    const specifier = "bun:sqlite";
    return (await import(specifier)) as unknown as BunSqliteModule;
  } catch (cause) {
    throw new PersistenceError("migration_failed", "SQLite persistence requires Bun sqlite support.", { cause });
  }
}

class SqlitePersistenceStore implements PersistenceStore {
  readonly backend = "sqlite" as const;
  #database: BunSqliteDatabase;
  #closed = false;

  constructor(database: BunSqliteDatabase) {
    this.#database = database;
  }

  async migrate(): Promise<MigrationReport> {
    this.#assertOpen();
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.run(
      `CREATE TABLE IF NOT EXISTS wats_persistence_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        holder TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      )`
    );
    this.#database.run(
      `CREATE TABLE IF NOT EXISTS wats_schema_migrations (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`
    );

    const holder = `wats-${Math.random().toString(36).slice(2)}`;
    try {
      this.#acquireLock(holder);
      const applied: string[] = [];
      this.#validateAppliedChecksums();
      for (const migration of MIGRATIONS) {
        const row = this.#migrationRow(migration.id);
        if (row !== null) continue;
        this.#database.exec("BEGIN IMMEDIATE");
        try {
          for (const statement of migration.statements) this.#database.run(statement);
          this.#database.run(
            "INSERT INTO wats_schema_migrations (id, version, checksum, applied_at) VALUES (?, ?, ?, ?)",
            migration.id,
            migration.version,
            migration.checksum,
            nowIso()
          );
          this.#database.exec("COMMIT");
          applied.push(migration.id);
        } catch (cause) {
          this.#database.exec("ROLLBACK");
          throw new PersistenceError("migration_failed", "SQLite migration failed.", { cause });
        }
      }
      return Object.freeze({
        currentVersion: CURRENT_SCHEMA_VERSION,
        appliedMigrations: Object.freeze(applied.slice()),
        alreadyCurrent: applied.length === 0
      });
    } finally {
      this.#releaseLock(holder);
    }
  }

  async health(): Promise<PersistenceHealth> {
    this.#assertOpen();
    const row = this.#database.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0) AS version FROM wats_schema_migrations"
    ).get();
    return Object.freeze({
      ok: true,
      backend: "sqlite",
      currentVersion: typeof row?.version === "number" ? row.version : 0,
      redactedLocation: REDACTED_SQLITE_LOCATION
    });
  }

  async recordWebhookEvent(input: WebhookEventRecordInput): Promise<WebhookEventRecordResult> {
    this.#assertOpen();
    const record = validateWebhookEventRecord(input);
    try {
      this.#database.run(
        "INSERT INTO wats_webhook_events (event_key, event_hash, received_at) VALUES (?, ?, ?)",
        record.eventKey,
        record.eventHash,
        record.receivedAt
      );
      return "recorded";
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/UNIQUE|constraint/i.test(message)) return "duplicate";
      throw new PersistenceError("migration_failed", "SQLite webhook event record failed.", { cause });
    }
  }

  async getServiceRequest(input: ServiceRequestLookupInput): Promise<ServiceRequestLookupResult> {
    this.#assertOpen();
    const lookup = validateServiceRequestLookup(input);
    const row = this.#database.query<{ request_hash: string; response_json: string }>(
      "SELECT request_hash, response_json FROM wats_service_requests WHERE idempotency_key = ?"
    ).get(lookup.idempotencyKey);
    if (row === null) return null;
    if (row.request_hash !== lookup.requestHash) return "conflict";
    return Object.freeze({ responseJson: row.response_json });
  }

  async recordServiceRequest(input: ServiceRequestRecordInput): Promise<void> {
    this.#assertOpen();
    const record = validateServiceRequestRecord(input);
    this.#database.run(
      "INSERT OR IGNORE INTO wats_service_requests (idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?)",
      record.idempotencyKey,
      record.requestHash,
      record.responseJson,
      record.createdAt
    );
  }

  async enqueueOutboxItem(input: OutboxEnqueueInput): Promise<OutboxEnqueueResult> {
    this.#assertOpen();
    const item = validateOutboxEnqueue(input);
    try {
      this.#database.run(
        "INSERT INTO wats_outbox (id, status, attempts, next_attempt_at, payload_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        item.id,
        "pending",
        0,
        item.nextAttemptAt,
        item.payloadHash,
        item.createdAt,
        item.createdAt
      );
      return "enqueued";
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/UNIQUE|constraint/i.test(message)) return "duplicate";
      throw new PersistenceError("outbox_failed", "SQLite outbox enqueue failed.", { cause });
    }
  }

  async claimOutboxItems(input: OutboxClaimInput): Promise<readonly OutboxItem[]> {
    this.#assertOpen();
    const claim = validateOutboxClaim(input);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const leaseExpiredAt = subtractMillisecondsIso(claim.now, OUTBOX_PROCESSING_LEASE_MS);
      const rows = this.#database.query<{
        id: string;
        status: string;
        attempts: number;
        lease_id: number;
        next_attempt_at: string | null;
        payload_hash: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, status, attempts, lease_id, next_attempt_at, payload_hash, created_at, updated_at
         FROM wats_outbox
         WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
            OR (status = 'processing' AND updated_at <= ?)
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      ).all(claim.now, leaseExpiredAt, claim.limit);
      for (const row of rows) {
        const result = this.#database.run(
          "UPDATE wats_outbox SET status = ?, attempts = attempts + 1, lease_id = lease_id + 1, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND status = ? AND lease_id = ?",
          "processing",
          claim.now,
          row.id,
          row.status,
          row.lease_id
        );
        if (result.changes !== 1) {
          throw new PersistenceError("outbox_failed", "SQLite outbox claim lease changed during claim.");
        }
      }
      this.#database.exec("COMMIT");
      return Object.freeze(rows.map((row) => outboxRowToItem({ ...row, status: "processing", attempts: row.attempts + 1, lease_id: row.lease_id + 1, next_attempt_at: null, updated_at: claim.now })));
    } catch (cause) {
      this.#database.exec("ROLLBACK");
      throw new PersistenceError("outbox_failed", "SQLite outbox claim failed.", { cause });
    }
  }

  async markOutboxItemFailed(input: OutboxFailedInput): Promise<void> {
    this.#assertOpen();
    const failure = validateOutboxFailed(input);
    const result = this.#database.run(
      "UPDATE wats_outbox SET status = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = ? AND lease_id = ?",
      "pending",
      failure.nextAttemptAt,
      failure.updatedAt,
      failure.id,
      "processing",
      failure.leaseId
    );
    if (result.changes !== 1) {
      throw new PersistenceError("outbox_failed", "SQLite outbox failure lease is stale.");
    }
  }

  async markOutboxItemSucceeded(input: OutboxSucceededInput): Promise<void> {
    this.#assertOpen();
    const success = validateOutboxSucceeded(input);
    const result = this.#database.run(
      "UPDATE wats_outbox SET status = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND status = ? AND lease_id = ?",
      "succeeded",
      success.updatedAt,
      success.id,
      "processing",
      success.leaseId
    );
    if (result.changes !== 1) {
      throw new PersistenceError("outbox_failed", "SQLite outbox success lease is stale.");
    }
  }

  async recordMessage(input: MessageRecordInput): Promise<void> {
    this.#assertOpen();
    const record = validateMessageRecord(input);
    this.#database.run(
      `INSERT OR IGNORE INTO wats_messages
        (row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.rowId,
      record.waMessageId,
      record.direction,
      record.fromPhone,
      record.toPhone,
      record.type,
      record.status,
      record.graphMessageId,
      record.createdAt,
      record.updatedAt
    );
  }

  async appendMessageStatus(input: MessageStatusEventInput): Promise<void> {
    this.#assertOpen();
    const event = validateMessageStatusEvent(input);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.run(
        "INSERT INTO wats_message_status_events (wa_message_id, status, timestamp) VALUES (?, ?, ?)",
        event.waMessageId,
        event.status,
        event.timestamp
      );
      this.#database.run(
        "UPDATE wats_messages SET status = ?, updated_at = ? WHERE wa_message_id = ?",
        event.status,
        event.timestamp,
        event.waMessageId
      );
      this.#database.exec("COMMIT");
    } catch (cause) {
      this.#database.exec("ROLLBACK");
      throw new PersistenceError("invalid_record", "SQLite message status append failed.", { cause });
    }
  }

  async getMessage(input: { waMessageId: string }): Promise<MessageRecord | null> {
    this.#assertOpen();
    const record = validateRecordInput(input, "message lookup");
    const waMessageId = validateRecordString(record.waMessageId, "waMessageId");
    const row = this.#database.query<MessageRow>(
      `SELECT row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at
       FROM wats_messages WHERE wa_message_id = ?`
    ).get(waMessageId);
    return row === null ? null : messageRowToRecord(row);
  }

  async listMessages(input: ListMessagesInput): Promise<ListMessagesResult> {
    this.#assertOpen();
    const query = validateListMessages(input);
    const fetchLimit = query.limit + 1;
    let rows: MessageRow[];
    if (query.beforeRowId === null) {
      rows = this.#database.query<MessageRow>(
        `SELECT row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at
         FROM wats_messages
         ORDER BY created_at DESC, row_id DESC
         LIMIT ?`
      ).all(fetchLimit);
    } else {
      const cursor = this.#database.query<{ row_id: string; created_at: string }>(
        "SELECT row_id, created_at FROM wats_messages WHERE row_id = ?"
      ).get(query.beforeRowId);
      if (cursor === null) {
        return Object.freeze({ items: Object.freeze([]), nextCursor: null });
      }
      rows = this.#database.query<MessageRow>(
        `SELECT row_id, wa_message_id, direction, from_phone, to_phone, type, status, graph_message_id, created_at, updated_at
         FROM wats_messages
         WHERE created_at < ? OR (created_at = ? AND row_id < ?)
         ORDER BY created_at DESC, row_id DESC
         LIMIT ?`
      ).all(cursor.created_at, cursor.created_at, cursor.row_id, fetchLimit);
    }
    const pageRows = rows.slice(0, query.limit);
    const items = Object.freeze(pageRows.map((row) => messageRowToRecord(row)));
    const nextCursor = rows.length > query.limit ? items[items.length - 1]?.rowId ?? null : null;
    return Object.freeze({ items, nextCursor });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }

  __unsafeTamperMigrationChecksumForTesting(id: string, checksum: string): void {
    this.#assertOpen();
    this.#database.run("UPDATE wats_schema_migrations SET checksum = ? WHERE id = ?", checksum, id);
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new PersistenceError("store_closed", "Persistence store is closed.");
    }
  }

  #acquireLock(holder: string): void {
    try {
      this.#database.run(
        "INSERT INTO wats_persistence_lock (id, holder, acquired_at) VALUES (?, ?, ?)",
        MIGRATION_LOCK_ID,
        holder,
        nowIso()
      );
    } catch (cause) {
      throw new PersistenceError("migration_lock_failed", "SQLite migration lock is already held.", { cause });
    }
  }

  #releaseLock(holder: string): void {
    try {
      this.#database.run("DELETE FROM wats_persistence_lock WHERE id = ? AND holder = ?", MIGRATION_LOCK_ID, holder);
    } catch {
      // Release is best-effort; migrate already returned or is throwing a typed error.
    }
  }

  #migrationRow(id: string): MigrationRow | null {
    return this.#database.query<MigrationRow>(
      "SELECT id, version, checksum FROM wats_schema_migrations WHERE id = ?"
    ).get(id);
  }

  #validateAppliedChecksums(): void {
    const rows = this.#database.query<MigrationRow>(
      "SELECT id, version, checksum FROM wats_schema_migrations ORDER BY version ASC"
    ).all();
    for (const row of rows) {
      const expected = migrationById(row.id);
      if (expected === undefined || expected.checksum !== row.checksum || expected.version !== row.version) {
        throw new PersistenceError("migration_checksum_mismatch", "SQLite migration checksum mismatch.");
      }
    }
  }
}

export async function createSqlitePersistence(options: SqlitePersistenceOptions): Promise<PersistenceStore> {
  const { filename, readonly } = validateOptions(options);
  const sqlite = await loadBunSqlite();
  try {
    const database = new sqlite.Database(filename, { readonly, create: !readonly });
    return new SqlitePersistenceStore(database);
  } catch (cause) {
    throw new PersistenceError("migration_failed", "SQLite database could not be opened.", { cause });
  }
}
