export const CURRENT_SCHEMA_VERSION = 1 as const;
export const REDACTED_SQLITE_LOCATION = "[REDACTED_SQLITE_DATABASE]" as const;

export type PersistenceBackend = "sqlite" | "postgres";

export type PersistenceErrorCode =
  | "invalid_options"
  | "invalid_filename"
  | "invalid_record"
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

export interface WebhookEventRecordInput {
  readonly eventKey: string;
  readonly eventHash: string;
  readonly receivedAt: string;
}

export type WebhookEventRecordResult = "recorded" | "duplicate";

export interface ServiceRequestLookupInput {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface ServiceRequestRecordInput extends ServiceRequestLookupInput {
  readonly responseJson: string;
  readonly createdAt: string;
}

export type ServiceRequestLookupResult = null | "conflict" | { readonly responseJson: string };

export interface PersistenceStore {
  readonly backend: PersistenceBackend;
  migrate(): Promise<MigrationReport>;
  health(): Promise<PersistenceHealth>;
  recordWebhookEvent(input: WebhookEventRecordInput): Promise<WebhookEventRecordResult>;
  getServiceRequest(input: ServiceRequestLookupInput): Promise<ServiceRequestLookupResult>;
  recordServiceRequest(input: ServiceRequestRecordInput): Promise<void>;
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
