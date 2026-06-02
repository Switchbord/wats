import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  runOutboxWorkerOnce,
  type OutboxItem,
  type PersistenceStore
} from "@wats/persistence";
import { createSqlitePersistence } from "@wats/persistence/sqlite";

const checks = {
  currentSchemaVersion: Number.isInteger(CURRENT_SCHEMA_VERSION) && CURRENT_SCHEMA_VERSION > 0,
  errorClass: new PersistenceError("invalid_options") instanceof Error,
  sqliteFactory: typeof createSqlitePersistence === "function",
  outboxWorker: typeof runOutboxWorkerOnce === "function"
};

const store: PersistenceStore = await createSqlitePersistence({ filename: ":memory:" });
const item: OutboxItem = {
  id: "fixture",
  status: "pending",
  attempts: 0,
  payloadHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nextAttemptAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z"
};
checks.outboxWorker = checks.outboxWorker && item.payloadHash.startsWith("sha256:");
await store.close();

console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), checks }));
console.log("persistence-consumer:ok");
