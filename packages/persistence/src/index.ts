export const CURRENT_SCHEMA_VERSION = 2 as const;
export const REDACTED_SQLITE_LOCATION = "[REDACTED_SQLITE_DATABASE]" as const;

export type PersistenceBackend = "sqlite" | "postgres";

export type PersistenceErrorCode =
  | "invalid_options"
  | "invalid_filename"
  | "invalid_record"
  | "migration_failed"
  | "migration_checksum_mismatch"
  | "migration_lock_failed"
  | "outbox_failed"
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

export type OutboxStatus = "pending" | "processing" | "succeeded";

export interface OutboxItem {
  readonly id: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly leaseId: number;
  readonly payloadHash: string;
  readonly nextAttemptAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutboxEnqueueInput {
  readonly id: string;
  readonly payloadHash: string;
  readonly createdAt: string;
  readonly nextAttemptAt?: string | null;
}

export type OutboxEnqueueResult = "enqueued" | "duplicate";

export interface OutboxClaimInput {
  readonly now: string;
  readonly limit: number;
}

export interface OutboxFailedInput {
  readonly id: string;
  readonly leaseId: number;
  readonly nextAttemptAt: string;
  readonly updatedAt: string;
}

export interface OutboxSucceededInput {
  readonly id: string;
  readonly leaseId: number;
  readonly updatedAt: string;
}

export interface PersistenceStore {
  readonly backend: PersistenceBackend;
  migrate(): Promise<MigrationReport>;
  health(): Promise<PersistenceHealth>;
  recordWebhookEvent(input: WebhookEventRecordInput): Promise<WebhookEventRecordResult>;
  getServiceRequest(input: ServiceRequestLookupInput): Promise<ServiceRequestLookupResult>;
  recordServiceRequest(input: ServiceRequestRecordInput): Promise<void>;
  enqueueOutboxItem(input: OutboxEnqueueInput): Promise<OutboxEnqueueResult>;
  claimOutboxItems(input: OutboxClaimInput): Promise<readonly OutboxItem[]>;
  markOutboxItemFailed(input: OutboxFailedInput): Promise<void>;
  markOutboxItemSucceeded(input: OutboxSucceededInput): Promise<void>;
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
export { runOutboxWorkerOnce } from "./outbox";
export type { OutboxWorkerOptions, OutboxWorkerReport } from "./outbox";
