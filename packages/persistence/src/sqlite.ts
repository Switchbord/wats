import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  REDACTED_SQLITE_LOCATION,
  type MigrationReport,
  type PersistenceHealth,
  type PersistenceStore,
  type ServiceRequestLookupInput,
  type ServiceRequestLookupResult,
  type ServiceRequestRecordInput,
  type WebhookEventRecordInput,
  type WebhookEventRecordResult
} from "./index";

interface BunSqliteDatabase {
  run(sql: string, ...params: unknown[]): unknown;
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
