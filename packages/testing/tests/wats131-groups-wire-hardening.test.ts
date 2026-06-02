import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFile(filePath: string): JsonRecord {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isJsonRecord(parsed)) throw new Error(`Expected JSON object at ${filePath}`);
  return parsed;
}

function findRepoRoot(startDir: string): string {
  let currentDir = resolve(startDir);

  while (true) {
    const manifestPath = join(currentDir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = parseJsonFile(manifestPath);
      if (Array.isArray(manifest.workspaces) && manifest.workspaces.includes("packages/*")) {
        return currentDir;
      }
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) throw new Error(`Could not locate repo root from ${startDir}`);
    currentDir = parentDir;
  }
}

function runBun(args: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const completed = Bun.spawnSync(["bun", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: completed.exitCode,
    stdout: new TextDecoder().decode(completed.stdout),
    stderr: new TextDecoder().decode(completed.stderr)
  };
}

describe("WATS-131 Groups webhook wire hardening", () => {
  test("group webhook wire and normalized types preserve Meta edge shapes", () => {
    const repoRoot = findRepoRoot(import.meta.dir);
    const tempRoot = mkdtempSync(join(tmpdir(), "wats-131-groups-wire-"));

    try {
      const typeFixturePath = join(tempRoot, "groups-wire.ts");
      writeFileSync(typeFixturePath, GROUPS_WIRE_FIXTURE);
      writeFileSync(
        join(tempRoot, "tsconfig.json"),
        `${JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              ignoreDeprecations: "6.0",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              exactOptionalPropertyTypes: true,
              noUncheckedIndexedAccess: true,
              noEmit: true,
              baseUrl: repoRoot,
              paths: {
                "@wats/types": ["packages/types/src/index.ts"],
                "@wats/types/*": ["packages/types/src/*"]
              }
            },
            include: [typeFixturePath]
          },
          null,
          2
        )}\n`
      );

      const result = runBun(["x", "tsc", "--noEmit", "-p", join(tempRoot, "tsconfig.json")], repoRoot);
      expect(result.exitCode).toBe(
        0,
        `WATS-131 wire hardening type fixture failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

const GROUPS_WIRE_FIXTURE = String.raw`
import type {
  GroupLifecycleUpdateType,
  GroupLifecycleUpdateWebhookValue,
  GroupLifecycleUpdateWireValue,
  GroupParticipantsUpdateType,
  GroupParticipantsUpdateWebhookValue,
  GroupParticipantsUpdateWireValue,
  GroupSettingsUpdateType,
  GroupSettingsUpdateWebhookValue,
  GroupSettingsUpdateWireValue,
  GroupStatusUpdateType,
  GroupStatusUpdateWebhookValue,
  GroupStatusUpdateWireValue,
  GroupWebhookField,
  WhatsAppMessageRecipient
} from "@wats/types";

const recipient: WhatsAppMessageRecipient = { recipientType: "group", to: "GROUP_ID" };
void recipient;
// @ts-expect-error recipient type is a closed individual/group union.
const invalidRecipient: WhatsAppMessageRecipient = { recipientType: "broadcast", to: "GROUP_ID" };
void invalidRecipient;

const field: GroupWebhookField = "group_settings_update";
void field;
// @ts-expect-error group webhook fields are the four Meta Groups fields only.
const invalidField: GroupWebhookField = "messages";
void invalidField;

const lifecycleType: GroupLifecycleUpdateType = "group_create";
const participantsType: GroupParticipantsUpdateType = "group_participants_remove";
const settingsType: GroupSettingsUpdateType = "group_settings_update";
const statusType: GroupStatusUpdateType = "group_suspend_cleared";
void lifecycleType;
void participantsType;
void settingsType;
void statusType;
// @ts-expect-error lifecycle type does not accept participant events.
const invalidLifecycleType: GroupLifecycleUpdateType = "group_participants_add";
void invalidLifecycleType;
// @ts-expect-error settings update is a single literal.
const invalidSettingsType: GroupSettingsUpdateType = "group_subject";
void invalidSettingsType;

const lifecycleRaw: GroupLifecycleUpdateWireValue = {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "15551234567", phone_number_id: "PNID" },
  groups: [
    {
      timestamp: "1780357732",
      group_id: "GROUP_ID",
      type: "group_create",
      request_id: "REQ_ID",
      subject: "Release testers",
      description: "Small invite-only test group",
      invite_link: "https://chat.whatsapp.com/example",
      join_approval_mode: "approval_required"
    }
  ]
};
const lifecycleValue: GroupLifecycleUpdateWebhookValue = {
  messagingProduct: "whatsapp",
  metadata: { displayPhoneNumber: "15551234567", phoneNumberId: "PNID" },
  type: "group_create",
  requestId: "REQ_ID",
  groupId: "GROUP_ID",
  subject: "Release testers",
  description: "Small invite-only test group",
  inviteLink: "https://chat.whatsapp.com/example",
  joinApprovalMode: "approval_required",
  raw: lifecycleRaw
};
void lifecycleValue;
// @ts-expect-error wire values keep Meta snake_case field names.
const invalidLifecycleRaw: GroupLifecycleUpdateWireValue = { messagingProduct: "whatsapp", metadata: {}, groups: [] };
void invalidLifecycleRaw;

const participantsRaw: GroupParticipantsUpdateWireValue = {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "15551234567", phone_number_id: "PNID" },
  groups: [
    {
      timestamp: "1780357732",
      group_id: "GROUP_ID",
      type: "group_participants_remove",
      initiated_by: "business",
      removed_participants: [{ input: "15557654321" }],
      failed_participants: [
        { input: "15550000000", errors: [{ code: 131000, message: "failed", title: "failed" }] }
      ]
    }
  ]
};
const participantsValue: GroupParticipantsUpdateWebhookValue = {
  messagingProduct: "whatsapp",
  metadata: { displayPhoneNumber: "15551234567", phoneNumberId: "PNID" },
  groupId: "GROUP_ID",
  type: "group_participants_remove",
  initiatedBy: "business",
  removedParticipants: [{ input: "15557654321" }],
  failedParticipants: [
    { input: "15550000000", errors: [{ code: 131000, message: "failed", title: "failed" }] }
  ],
  raw: participantsRaw
};
void participantsValue;

const settingsRaw: GroupSettingsUpdateWireValue = {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "15551234567", phone_number_id: "PNID" },
  groups: [
    {
      timestamp: "1780357732",
      group_id: "GROUP_ID",
      type: "group_settings_update",
      profile_picture: { update_successful: true, mime_type: "image/jpeg", sha256: "abc123" },
      group_subject: { update_successful: true, text: "Release testers" },
      group_description: { update_successful: true, text: "Small invite-only test group" }
    }
  ]
};
const settingsValue: GroupSettingsUpdateWebhookValue = {
  messagingProduct: "whatsapp",
  metadata: { displayPhoneNumber: "15551234567", phoneNumberId: "PNID" },
  groupId: "GROUP_ID",
  type: "group_settings_update",
  profilePicture: { updateSuccessful: true, mimeType: "image/jpeg", sha256: "abc123" },
  groupSubject: { updateSuccessful: true, text: "Release testers" },
  groupDescription: { updateSuccessful: true, text: "Small invite-only test group" },
  raw: settingsRaw
};
void settingsValue;

const statusRaw: GroupStatusUpdateWireValue = {
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "15551234567", phone_number_id: "PNID" },
  groups: [{ timestamp: "1780357732", group_id: "GROUP_ID", type: "group_suspend_cleared" }]
};
const statusValue: GroupStatusUpdateWebhookValue = {
  messagingProduct: "whatsapp",
  metadata: { displayPhoneNumber: "15551234567", phoneNumberId: "PNID" },
  groupId: "GROUP_ID",
  type: "group_suspend_cleared",
  raw: statusRaw
};
void statusValue;
`;
