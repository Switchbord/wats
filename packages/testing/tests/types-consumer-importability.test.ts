import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) {
    throw new Error(`Expected JSON object at ${filePath}`);
  }

  return parsed;
}

function includesWorkspacePackagesGlob(workspaces: unknown): boolean {
  if (Array.isArray(workspaces)) {
    return workspaces.includes("packages/*");
  }

  if (isJsonRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.includes("packages/*");
  }

  return false;
}

function isWorkspaceRootManifest(manifest: JsonRecord): boolean {
  return includesWorkspacePackagesGlob(manifest.workspaces);
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);

  while (true) {
    const candidateManifestPath = join(currentDir, "package.json");
    if (existsSync(candidateManifestPath)) {
      const candidateManifest = parseJsonFile(candidateManifestPath);
      if (isWorkspaceRootManifest(candidateManifest)) {
        return currentDir;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate workspace root from ${startDir}`);
    }

    currentDir = parentDir;
  }
}

function runBun(args: string[], cwd: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const completed = Bun.spawnSync(["bun", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    exitCode: completed.exitCode,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

describe("B1 external consumer importability", () => {
  test("documented @wats/types entrypoints are importable from an external consumer fixture", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const fixtureTemplateDir = join(
      repoRoot,
      "packages/testing/fixtures/types-consumer"
    );

    expect(existsSync(join(fixtureTemplateDir, "package.json"))).toBe(true);
    expect(existsSync(join(fixtureTemplateDir, "verify-imports.ts"))).toBe(true);

    const tempFixtureRoot = mkdtempSync(join(tmpdir(), "wats-types-consumer-"));
    const fixtureRuntimeDir = join(tempFixtureRoot, "types-consumer");

    try {
      cpSync(fixtureTemplateDir, fixtureRuntimeDir, { recursive: true });

      const fixtureManifestPath = join(fixtureRuntimeDir, "package.json");
      const fixtureManifest = parseJsonFile(fixtureManifestPath);

      if (!isJsonRecord(fixtureManifest.dependencies)) {
        throw new Error("Fixture dependencies must be an object");
      }

      fixtureManifest.dependencies["@wats/types"] = `file:${join(
        repoRoot,
        "packages/types"
      )}`;

      writeFileSync(fixtureManifestPath, `${JSON.stringify(fixtureManifest, null, 2)}\n`);

      const installResult = runBun(["install"], fixtureRuntimeDir);
      expect(installResult.exitCode).toBe(
        0,
        `bun install failed:\n${installResult.stdout}\n${installResult.stderr}`
      );

      const installedTypesPackageManifestPath = join(
        fixtureRuntimeDir,
        "node_modules/@wats/types/package.json"
      );
      expect(existsSync(installedTypesPackageManifestPath)).toBe(true);

      const verifyResult = runBun(["run", "verify-imports"], fixtureRuntimeDir);
      expect(verifyResult.exitCode).toBe(
        0,
        `fixture import verification failed:\n${verifyResult.stdout}\n${verifyResult.stderr}`
      );

      const reportLine = verifyResult.stdout
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .at(-1);

      expect(typeof reportLine).toBe("string");

      const parsedReport = JSON.parse(reportLine as string) as {
        moduleKeys: Record<string, string[]>;
        discriminatedUnionMembers?: string[];
        statusKinds?: string[];
        interactiveReplyKinds?: string[];
      };

      expect(Object.keys(parsedReport.moduleKeys).sort()).toEqual([
        "@wats/types",
        "@wats/types/config",
        "@wats/types/contacts",
        "@wats/types/entities",
        "@wats/types/errors",
        "@wats/types/messages",
        "@wats/types/statuses",
        "@wats/types/webhook"
      ]);

      // F-1 consumer fixture must exercise the discriminated unions at
      // the external-package boundary: every variant of WhatsAppMessage,
      // every kind of WhatsAppMessageStatus, and every variant of
      // InteractiveReply must be represented in an exhaustive switch
      // whose `never` default branch catches accidental widening.
      expect(parsedReport.discriminatedUnionMembers).toEqual([
        "text",
        "image",
        "video",
        "audio",
        "document",
        "sticker",
        "location",
        "contacts",
        "reaction",
        "order",
        "system",
        "unsupported",
        "interactive",
        "button"
      ]);
      expect(parsedReport.statusKinds).toEqual([
        "sent",
        "delivered",
        "read",
        "failed",
        "deleted",
        "warning"
      ]);
      expect(parsedReport.interactiveReplyKinds).toEqual([
        "button_reply",
        "list_reply",
        "nfm_reply",
        "product_reply",
        "product_list_reply",
        "cta_url_reply"
      ]);

      const dependencyPath = normalize(
        join(fixtureRuntimeDir, "node_modules/@wats/types/package.json")
      );
      expect(normalize(installedTypesPackageManifestPath)).toBe(dependencyPath);
    } finally {
      rmSync(tempFixtureRoot, { recursive: true, force: true });
    }
  });
});
