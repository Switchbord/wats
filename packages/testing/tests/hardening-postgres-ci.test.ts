import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

describe("real database regression CI", () => {
  test("provisions a private ephemeral Postgres service for the full suite", () => {
    const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("WATS_TEST_POSTGRES_URL:");
    expect(workflow).toContain("127.0.0.1:");
    expect(workflow).toContain("--health-cmd");
    expect(workflow).toContain("postgresRealConcurrency.test.ts");
  });

  test("Postgres test driver stays development-only while runtime peer is optional", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const persistence = JSON.parse(readFileSync(resolve(root, "packages/persistence/package.json"), "utf8"));
    expect(typeof manifest.devDependencies.pg).toBe("string");
    expect(typeof manifest.devDependencies["@types/pg"]).toBe("string");
    expect(persistence.peerDependenciesMeta.pg.optional).toBe(true);
    expect(persistence.dependencies.pg).toBeUndefined();
  });
});
