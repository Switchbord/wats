import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const REQUIRED_TYPE_FILES = [
  "packages/types/src/config.ts",
  "packages/types/src/webhook.ts",
  "packages/types/src/entities.ts",
  "packages/types/src/contacts.ts",
  "packages/types/src/statuses.ts",
  "packages/types/src/errors.ts",
  "packages/types/src/messages/index.ts",
  "packages/types/src/messages/union.ts",
  "packages/types/src/messages/media.ts",
  "packages/types/src/messages/text.ts",
  "packages/types/src/messages/image.ts",
  "packages/types/src/messages/video.ts",
  "packages/types/src/messages/audio.ts",
  "packages/types/src/messages/document.ts",
  "packages/types/src/messages/sticker.ts",
  "packages/types/src/messages/location.ts",
  "packages/types/src/messages/contacts.ts",
  "packages/types/src/messages/reaction.ts",
  "packages/types/src/messages/order.ts",
  "packages/types/src/messages/system.ts",
  "packages/types/src/messages/unsupported.ts",
  "packages/types/src/messages/interactive.ts",
  "packages/types/src/messages/button.ts",
  "packages/types/src/index.ts"
] as const;

const PACKAGE_ENTRYPOINTS = [
  "@wats/types",
  "@wats/types/config",
  "@wats/types/webhook",
  "@wats/types/entities",
  "@wats/types/messages",
  "@wats/types/statuses",
  "@wats/types/contacts",
  "@wats/types/errors"
] as const;

const REQUIRED_RUNTIME_EXPORTS: Record<(typeof PACKAGE_ENTRYPOINTS)[number], readonly string[]> = {
  "@wats/types": [
    "WATS_TYPES_CONFIG_EXPORTS",
    "WATS_TYPES_WEBHOOK_EXPORTS",
    "WATS_TYPES_ENTITIES_EXPORTS",
    "WATS_TYPES_MESSAGES_EXPORTS",
    "WATS_TYPES_STATUSES_EXPORTS",
    "WATS_TYPES_CONTACTS_EXPORTS",
    "WATS_TYPES_ERRORS_EXPORTS"
  ],
  "@wats/types/config": ["WATS_TYPES_CONFIG_EXPORTS"],
  "@wats/types/webhook": ["WATS_TYPES_WEBHOOK_EXPORTS"],
  "@wats/types/entities": ["WATS_TYPES_ENTITIES_EXPORTS"],
  "@wats/types/messages": ["WATS_TYPES_MESSAGES_EXPORTS"],
  "@wats/types/statuses": ["WATS_TYPES_STATUSES_EXPORTS"],
  "@wats/types/contacts": ["WATS_TYPES_CONTACTS_EXPORTS"],
  "@wats/types/errors": ["WATS_TYPES_ERRORS_EXPORTS"]
} as const;

const EXPECTED_CONTRACT_VALUES = {
  WATS_TYPES_CONFIG_EXPORTS: ["WhatsAppClientConfig", "WhatsAppClientRuntimeConfig"],
  WATS_TYPES_WEBHOOK_EXPORTS: [
    "WhatsAppWebhookEnvelope",
    "WhatsAppWebhookEntry",
    "WhatsAppWebhookChange",
    "WhatsAppWebhookValue",
    "WhatsAppAccountUpdateValue"
  ],
  WATS_TYPES_ENTITIES_EXPORTS: [
    "WhatsAppMessage",
    "WhatsAppContact",
    "WhatsAppErrorPayload",
    "WhatsAppMessageStatus"
  ],
  WATS_TYPES_MESSAGES_EXPORTS: [
    "TextMessage",
    "ImageMessage",
    "VideoMessage",
    "AudioMessage",
    "DocumentMessage",
    "StickerMessage",
    "LocationMessage",
    "ContactsMessage",
    "ReactionMessage",
    "OrderMessage",
    "SystemMessage",
    "UnsupportedMessage",
    "InteractiveMessage",
    "ButtonMessage",
    "WhatsAppMessage",
    "InteractiveReply",
    "MediaReference",
    "DocumentReference",
    "MessageContext"
  ],
  WATS_TYPES_STATUSES_EXPORTS: [
    "WhatsAppMessageStatus",
    "WhatsAppMessageStatusKind"
  ],
  WATS_TYPES_CONTACTS_EXPORTS: [
    "WhatsAppContact",
    "WhatsAppContactName",
    "ContactPhone",
    "ContactEmail",
    "ContactAddress",
    "ContactOrg",
    "ContactUrl"
  ],
  WATS_TYPES_ERRORS_EXPORTS: [
    "WhatsAppError",
    "WhatsAppErrorPayload"
  ]
} as const;

type ExportContractKey = keyof typeof EXPECTED_CONTRACT_VALUES;

function hasOwnKey(objectValue: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue, key);
}

function assertContractExport(
  moduleNamespace: Record<string, unknown>,
  exportName: ExportContractKey
): void {
  expect(hasOwnKey(moduleNamespace, exportName)).toBe(true);

  const actualValue = moduleNamespace[exportName];
  expect(Array.isArray(actualValue)).toBe(true);
  expect(actualValue).toEqual(EXPECTED_CONTRACT_VALUES[exportName]);
}

function getEntrypointContractExports(
  specifier: (typeof PACKAGE_ENTRYPOINTS)[number]
): ExportContractKey[] {
  return REQUIRED_RUNTIME_EXPORTS[specifier] as ExportContractKey[];
}

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

describe("B1 foundational shared types", () => {
  test("required types source files exist", () => {
    const repoRoot = findRepoRoot(import.meta.dir);

    for (const relativePath of REQUIRED_TYPE_FILES) {
      expect(existsSync(join(repoRoot, relativePath))).toBe(true);
    }
  });

  test("@wats/types package manifest exposes documented entrypoints", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const packageManifest = parseJsonFile(join(repoRoot, "packages/types/package.json"));

    expect(packageManifest.main).toBe("./dist/index.js");
    expect(packageManifest.types).toBe("./dist/index.d.ts");
    expect(packageManifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./config": { types: "./dist/config.d.ts", import: "./dist/config.js" },
      "./webhook": { types: "./dist/webhook.d.ts", import: "./dist/webhook.js" },
      "./entities": { types: "./dist/entities.d.ts", import: "./dist/entities.js" },
      "./messages": { types: "./dist/messages/index.d.ts", import: "./dist/messages/index.js" },
      "./statuses": { types: "./dist/statuses.d.ts", import: "./dist/statuses.js" },
      "./contacts": { types: "./dist/contacts.d.ts", import: "./dist/contacts.js" },
      "./errors": { types: "./dist/errors.d.ts", import: "./dist/errors.js" }
    });
  });

  test("documented @wats/types entrypoints are importable with runtime contract exports", async () => {
    for (const specifier of PACKAGE_ENTRYPOINTS) {
      const importedModule = (await import(specifier)) as Record<string, unknown>;
      expect(importedModule).toBeObject();

      for (const contractExportName of getEntrypointContractExports(specifier)) {
        assertContractExport(importedModule, contractExportName);
      }
    }
  });
});
