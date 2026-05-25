import {
  CURRENT_SCHEMA_VERSION,
  PersistenceError,
  type PersistenceStore
} from "@wats/persistence";
import { createSqlitePersistence } from "@wats/persistence/sqlite";

const checks = {
  currentSchemaVersion: Number.isInteger(CURRENT_SCHEMA_VERSION) && CURRENT_SCHEMA_VERSION > 0,
  errorClass: new PersistenceError("invalid_options") instanceof Error,
  sqliteFactory: typeof createSqlitePersistence === "function"
};

const store: PersistenceStore = await createSqlitePersistence({ filename: ":memory:" });
await store.close();

console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), checks }));
console.log("persistence-consumer:ok");
