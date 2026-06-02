import type {
  TypedGroupLifecycleUpdate,
  TypedGroupParticipantsUpdate,
  TypedGroupSettingsUpdate,
  TypedGroupStatusUpdate,
  TypedMessageUpdate,
  TypedStatusUpdate,
  TypedUpdate
} from "../webhookNormalizer.js";
import {
  FILTER_BRAND,
  FilterValidationError,
  type TypedFilter
} from "./typedFilter.js";

type GroupMessageUpdate = TypedMessageUpdate & {
  readonly message: TypedMessageUpdate["message"] & { readonly groupId?: string };
};
type GroupStatusReceiptUpdate = TypedStatusUpdate & {
  readonly status: TypedStatusUpdate["status"] & {
    readonly recipientType?: string;
    readonly recipientId?: string;
  };
};
type GroupStatusLikeUpdate = TypedGroupStatusUpdate | GroupStatusReceiptUpdate;
type AnyGroupUpdate =
  | GroupMessageUpdate
  | GroupStatusLikeUpdate
  | TypedGroupLifecycleUpdate
  | TypedGroupParticipantsUpdate
  | TypedGroupSettingsUpdate;

function buildFilter<T extends TypedUpdate>(
  predicate: (u: TypedUpdate) => u is T,
  describe: string
): TypedFilter<T> {
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => describe
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwnDataField(payload: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(payload, key);
  if (descriptor === undefined) return undefined;
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") return undefined;
  return descriptor.value;
}

function validateGroupId(groupId: string, label: string): string {
  if (typeof groupId !== "string") {
    throw new FilterValidationError("invalid_predicate", `${label}: groupId must be a string.`);
  }
  if (groupId.length === 0 || groupId.trim().length === 0) {
    throw new FilterValidationError("empty_substring", `${label}: groupId must be non-empty.`);
  }
  return groupId;
}

function getGroupId(update: TypedUpdate): string | undefined {
  if (update.kind === "message") {
    const messageValue = readOwnDataField(update as unknown as Record<string, unknown>, "message");
    if (!isRecord(messageValue)) return undefined;
    const groupId = readOwnDataField(messageValue, "groupId");
    return typeof groupId === "string" && groupId.length > 0 ? groupId : undefined;
  }
  if (update.kind === "status") {
    const statusValue = readOwnDataField(update as unknown as Record<string, unknown>, "status");
    if (!isRecord(statusValue)) return undefined;
    if (readOwnDataField(statusValue, "recipientType") !== "group") return undefined;
    const recipientId = readOwnDataField(statusValue, "recipientId");
    return typeof recipientId === "string" && recipientId.length > 0 ? recipientId : undefined;
  }
  if (
    update.kind === "groupLifecycle" ||
    update.kind === "groupParticipants" ||
    update.kind === "groupSettings" ||
    update.kind === "groupStatus"
  ) {
    const groupValue = readOwnDataField(update as unknown as Record<string, unknown>, "group");
    if (!isRecord(groupValue)) return undefined;
    const groupId = readOwnDataField(groupValue, "groupId");
    return typeof groupId === "string" && groupId.length > 0 ? groupId : undefined;
  }
  return undefined;
}

function isGroupMessage(update: TypedUpdate): update is GroupMessageUpdate {
  return update.kind === "message" && getGroupId(update) !== undefined;
}

function isGroupStatusReceipt(update: TypedUpdate): update is GroupStatusReceiptUpdate {
  return update.kind === "status" && getGroupId(update) !== undefined;
}

function groupMessage(): TypedFilter<GroupMessageUpdate> {
  return buildFilter(isGroupMessage, "group.message()");
}

function groupParticipantsUpdate(): TypedFilter<TypedGroupParticipantsUpdate> {
  return buildFilter((u): u is TypedGroupParticipantsUpdate => u.kind === "groupParticipants", "group.participantsUpdate()");
}

function groupLifecycleUpdate(): TypedFilter<TypedGroupLifecycleUpdate> {
  return buildFilter((u): u is TypedGroupLifecycleUpdate => u.kind === "groupLifecycle", "group.lifecycleUpdate()");
}

function groupSettingsUpdate(): TypedFilter<TypedGroupSettingsUpdate> {
  return buildFilter((u): u is TypedGroupSettingsUpdate => u.kind === "groupSettings", "group.settingsUpdate()");
}

function groupStatusUpdate(): TypedFilter<GroupStatusLikeUpdate> {
  return buildFilter(
    (u): u is GroupStatusLikeUpdate => u.kind === "groupStatus" || isGroupStatusReceipt(u),
    "group.statusUpdate()"
  );
}

function groupFromGroup(groupId: string): TypedFilter<AnyGroupUpdate> {
  const expected = validateGroupId(groupId, "group.fromGroup");
  return buildFilter((u): u is AnyGroupUpdate => getGroupId(u) === expected, `group.fromGroup(${JSON.stringify(expected)})`);
}

export interface GroupFilterNamespace extends TypedFilter<AnyGroupUpdate> {
  message(): TypedFilter<GroupMessageUpdate>;
  participantsUpdate(): TypedFilter<TypedGroupParticipantsUpdate>;
  lifecycleUpdate(): TypedFilter<TypedGroupLifecycleUpdate>;
  settingsUpdate(): TypedFilter<TypedGroupSettingsUpdate>;
  statusUpdate(): TypedFilter<GroupStatusLikeUpdate>;
  fromGroup(groupId: string): TypedFilter<AnyGroupUpdate>;
}

export const group: GroupFilterNamespace = Object.freeze(
  Object.assign(
    {
      [FILTER_BRAND]: true as const,
      predicate: ((u: TypedUpdate): u is AnyGroupUpdate => getGroupId(u) !== undefined) as (u: TypedUpdate) => u is AnyGroupUpdate,
      describe: (): string => "group"
    },
    {
      message: groupMessage,
      participantsUpdate: groupParticipantsUpdate,
      lifecycleUpdate: groupLifecycleUpdate,
      settingsUpdate: groupSettingsUpdate,
      statusUpdate: groupStatusUpdate,
      fromGroup: groupFromGroup
    }
  )
);
