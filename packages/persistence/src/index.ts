export const CURRENT_SCHEMA_VERSION = 4 as const;
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
  readonly beforeRowId?: string;   // cursor: rows after this row in createdAt DESC, rowId DESC order
}

export interface ListMessagesResult {
  readonly items: readonly MessageRecord[];
  readonly nextCursor: string | null;  // rowId of last item if more may exist, else null
}

export interface LatestInboundMessageInput {
  readonly phone: string;
}

export interface ConversationWindowInput {
  readonly phone: string;
  readonly now: string;            // strict ISO ms
  readonly windowMs?: number;      // integer 1..7*86400000; default 24h
}

export interface ConversationWindowState {
  readonly open: boolean;
  readonly lastInboundAt: string | null;
  readonly expiresAt: string | null;   // ISO ms when the window closes, null when unknown
  readonly remainingMs: number;        // 0 when closed or unknown
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
  recordMessage(input: MessageRecordInput): Promise<void>;
  appendMessageStatus(input: MessageStatusEventInput): Promise<void>;
  getMessage(input: { waMessageId: string }): Promise<MessageRecord | null>;
  listMessages(input: ListMessagesInput): Promise<ListMessagesResult>;
  getLatestInboundMessageAt(input: LatestInboundMessageInput): Promise<string | null>;
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
export {
  getConversationWindowState,
  canSendFreeForm
} from "./conversationWindow";

// WATS-176: re-export the postgres adapter from the package barrel so
// consumers can reach it via `@wats/persistence` (the `./postgres`
// subpath export already existed, but the type union
// `PersistenceBackend = "sqlite" | "postgres"` advertised a backend
// the root entry never surfaced). These re-exports close that gap
// without weakening the existing input validation in `postgres.ts`.
export {
  createPostgresPersistence,
  createPostgresPersistenceWithClient,
  REDACTED_POSTGRES_LOCATION
} from "./postgres";
export type {
  PostgresPersistenceOptions,
  PostgresClientLike,
  PostgresQueryResult
} from "./postgres";
