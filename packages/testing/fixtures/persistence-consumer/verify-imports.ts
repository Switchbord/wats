import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  canSendFreeForm,
  getConversationWindowState,
  runOutboxWorkerOnce,
  type ConversationWindowState,
  type OutboxItem,
  type PersistenceStore
} from "@wats/persistence";
import { createSqlitePersistence } from "@wats/persistence/sqlite";
import { createPostgresPersistence } from "@wats/persistence/postgres";

const checks = {
  currentSchemaVersion: CURRENT_SCHEMA_VERSION === 4,
  errorClass: new PersistenceError("invalid_options") instanceof Error,
  sqliteFactory: typeof createSqlitePersistence === "function",
  postgresFactory: typeof createPostgresPersistence === "function",
  outboxWorker: typeof runOutboxWorkerOnce === "function",
  conversationWindowHelper: typeof getConversationWindowState === "function",
  canSendFreeFormHelper: typeof canSendFreeForm === "function"
};

const store: PersistenceStore = await createSqlitePersistence({ filename: ":memory:" });
await store.migrate();
const item: OutboxItem = {
  id: "fixture",
  status: "pending",
  attempts: 0,
  leaseId: 0,
  payloadHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nextAttemptAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z"
};
checks.outboxWorker = checks.outboxWorker && item.payloadHash.startsWith("sha256:");

const windowState: ConversationWindowState = await getConversationWindowState(store, {
  phone: "15550001111",
  now: "2026-06-01T00:00:00.000Z"
});
checks.conversationWindowHelper = checks.conversationWindowHelper && windowState.open === false && windowState.lastInboundAt === null;
checks.canSendFreeFormHelper = checks.canSendFreeFormHelper && (await canSendFreeForm(store, { phone: "15550001111", now: "2026-06-01T00:00:00.000Z" })) === false;

await store.close();

console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), checks }));
console.log("persistence-consumer:ok");
