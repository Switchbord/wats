// WATS-176 slice 1 — consumer-style test asserting the postgres
// persistence factory is reachable from the package barrel
// (`@wats/persistence` root) and that input validation is preserved.
//
// This mirrors `postgres.test.ts` in spirit but imports EVERY public
// postgres symbol from `../src/index` (the barrel) instead of the
// `./postgres` subpath, locking the barrel gap closed.
import { describe, expect, test } from "bun:test";
import {
  PersistenceError,
  createPostgresPersistenceWithClient,
  REDACTED_POSTGRES_LOCATION,
  type PostgresClientLike,
  type PostgresQueryResult
} from "../src/index";

/**
 * Minimal scripted postgres client — same shape as the one in
 * `postgres.test.ts`. Only the methods the factory + a trivial health
 * probe touch are implemented.
 */
class ScriptedPgClient implements PostgresClientLike {
  readonly responses: PostgresQueryResult[];
  closed = false;
  constructor(responses: readonly PostgresQueryResult[] = []) {
    this.responses = responses.slice();
  }
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    _sql: string,
    _params: readonly unknown[] = []
  ): Promise<PostgresQueryResult<Row>> {
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as PostgresQueryResult<Row>;
  }
  async end(): Promise<void> {
    this.closed = true;
  }
}

describe("WATS-176 postgres barrel re-exports", () => {
  test("the factory + types are importable from the package barrel and construct against a mock client", async () => {
    const client = new ScriptedPgClient([
      // health() probe: SELECT COALESCE(MAX(version), 0) ...
      { rows: [{ version: 3 }], rowCount: 1 }
    ]);
    const store = createPostgresPersistenceWithClient(client);

    // backend discriminator advertised by PersistenceBackend union.
    expect(store.backend).toBe("postgres");

    // health() exercises the client + the redacted location const re-export.
    const h = await store.health();
    expect(h.ok).toBe(true);
    expect(h.backend).toBe("postgres");
    expect(h.currentVersion).toBe(3);
    expect(h.redactedLocation).toBe(REDACTED_POSTGRES_LOCATION);

    await store.close();
    expect(client.closed).toBe(true);
  });

  test("createPostgresPersistenceWithClient rejects null with PersistenceError (input validation intact)", () => {
    expect(() => createPostgresPersistenceWithClient(null as unknown as PostgresClientLike)).toThrow(PersistenceError);
  });

  test("createPostgresPersistenceWithClient rejects malformed clients missing query/end", () => {
    const badClients: readonly unknown[] = [
      {},
      { query: "not-a-function" },
      { query: () => Promise.resolve({ rows: [], rowCount: 0 }), end: "not-a-function" },
      42,
      "not-a-client",
      []
    ];
    for (const bad of badClients) {
      expect(() => createPostgresPersistenceWithClient(bad as PostgresClientLike)).toThrow(PersistenceError);
    }
  });
});
