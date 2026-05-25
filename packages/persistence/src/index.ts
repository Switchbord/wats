export const CURRENT_SCHEMA_VERSION = 1 as const;
export const REDACTED_SQLITE_LOCATION = "[REDACTED_SQLITE_DATABASE]" as const;

export type PersistenceBackend = "sqlite" | "postgres";

export type PersistenceErrorCode =
  | "invalid_options"
  | "invalid_filename"
  | "migration_failed"
  | "migration_checksum_mismatch"
  | "migration_lock_failed"
  | "store_closed";

export interface MigrationReport {
  readonly currentVersion: number;
  readonly appliedMigrations: readonly string[];
  readonly alreadyCurrent: boolean;
}

export interface PersistenceHealth {
  readonly ok: boolean;
  readonly backend: PersistenceBackend;
  readonly currentVersion: number;
  readonly redactedLocation: string;
}

export interface PersistenceStore {
  readonly backend: PersistenceBackend;
  migrate(): Promise<MigrationReport>;
  health(): Promise<PersistenceHealth>;
  close(): Promise<void>;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export { createSqlitePersistence } from "./sqlite";
export type { SqlitePersistenceOptions } from "./sqlite";
