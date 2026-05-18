// @wats/core — filtersTyped/message.ts (F-9 GREEN)
//
// The `message` export is BOTH a kind-filter (TypedFilter narrowing
// TypedUpdate to TypedMessageUpdate) AND a namespace carrying the
// minimum message built-ins for F-9:
//
//   message.text(substring?)        — matches text messages;
//                                     optional case-sensitive
//                                     substring match on body.
//   message.textMatches(RegExp|str) — matches a compiled RegExp.
//   message.textEquals(value)       — exact (case-sensitive) match.
//   message.type(messageType)       — discriminates on inner .type.
//   message.from(phoneNumber)       — discriminates on .from.
//   WATS-43A adds deep-message helpers for media, location,
//   reaction, interactive replies, and quick-reply buttons.
//
// Sibling-kind behaviour: every built-in returns `false` (never
// throws) when given a TypedStatusUpdate / TypedAccountUpdate /
// TypedUnknownUpdate. The outer kind check short-circuits before
// any body-specific inspection.

import type { WhatsAppMessage } from "@wats/types";
import type { TypedMessageUpdate, TypedUpdate } from "../webhookNormalizer.js";
import {
  FILTER_BRAND,
  FilterValidationError,
  type TypedFilter
} from "./typedFilter.js";

function buildFilter(
  predicate: (u: TypedUpdate) => u is TypedMessageUpdate,
  describe: string
): TypedFilter<TypedMessageUpdate> {
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => describe
  });
}

// ------------- inner accessors (no throw on off-kind) --------------

function getTextBody(u: TypedMessageUpdate): string | undefined {
  const inner = getMessageRecord(u);
  if (inner === undefined || readOwnDataField(inner, "type") !== "text") {
    return undefined;
  }
  const text = readOwnDataField(inner, "text");
  if (!isRecord(text)) {
    return undefined;
  }
  const body = readOwnDataField(text, "body");
  return typeof body === "string" ? body : undefined;
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

function readStringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = readOwnDataField(payload, key);
  return typeof value === "string" ? value : undefined;
}

function isMessage(u: TypedUpdate): u is TypedMessageUpdate {
  return u.kind === "message";
}

function getMessageRecord(u: TypedUpdate): Record<string, unknown> | undefined {
  if (!isMessage(u)) return undefined;
  const messageValue = readOwnDataField(u as unknown as Record<string, unknown>, "message");
  return isRecord(messageValue) ? messageValue : undefined;
}

function isMessageType(u: TypedUpdate, type: string): u is TypedMessageUpdate {
  const inner = getMessageRecord(u);
  return inner !== undefined && readOwnDataField(inner, "type") === type;
}

function hasRecordBody(u: TypedUpdate, type: string, key: string): boolean {
  const inner = getMessageRecord(u);
  if (inner === undefined || readOwnDataField(inner, "type") !== type) return false;
  return isRecord(readOwnDataField(inner, key));
}

function validateOptionalExact(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new FilterValidationError("invalid_predicate", `${label}: value must be a string when provided.`);
  }
  if (value.trim().length === 0) {
    throw new FilterValidationError("empty_substring", `${label}: value must be non-empty.`);
  }
  return value;
}

// ------------- factories --------------------------------------------

function messageText(substring?: string): TypedFilter<TypedMessageUpdate> {
  if (substring !== undefined) {
    if (typeof substring !== "string") {
      throw new FilterValidationError(
        "invalid_predicate",
        "message.text: substring must be a string when provided."
      );
    }
    if (substring.length === 0) {
      throw new FilterValidationError(
        "empty_substring",
        "message.text: substring must be non-empty."
      );
    }
  }

  const label =
    substring === undefined
      ? "message.text()"
      : `message.text(${JSON.stringify(substring)})`;

  const predicate = (u: TypedUpdate): u is TypedMessageUpdate => {
    if (!isMessage(u)) {
      return false;
    }
    const body = getTextBody(u);
    if (body === undefined) {
      return false;
    }
    if (substring === undefined) {
      return true;
    }
    return body.includes(substring);
  };

  return buildFilter(predicate, label);
}

function messageTextMatches(
  pattern: RegExp | string
): TypedFilter<TypedMessageUpdate> {
  let source: string;
  let flags: string;
  if (pattern instanceof RegExp) {
    source = pattern.source;
    flags = pattern.flags;
  } else if (typeof pattern === "string") {
    try {
      const compiled = new RegExp(pattern);
      source = compiled.source;
      flags = compiled.flags;
    } catch (err) {
      throw new FilterValidationError(
        "invalid_pattern",
        `message.textMatches: pattern is not a parseable RegExp (${
          err instanceof Error ? err.message : String(err)
        }).`
      );
    }
  } else {
    throw new FilterValidationError(
      "invalid_pattern",
      "message.textMatches: pattern must be a RegExp or string."
    );
  }

  // Clone the regex at construction time with /g and /y stripped.
  // Rationale: filters are pure per the module contract; a /g or /y
  // regex carries mutable `lastIndex` state across `.test(...)` calls,
  // which causes successive predicate invocations on identical input
  // to return alternating true/false. Stripping g/y here makes the
  // predicate stateless without mutating the caller-owned regex.
  // Flags i/m/s/u/v/d are preserved since they do not introduce
  // statefulness. See docs/reference/filters.md §"RegExp flag handling".
  const clonedFlags = flags.replace(/[gy]/g, "");
  const regex = new RegExp(source, clonedFlags);

  // Label uses the ORIGINAL-looking surface (source + cloned flags) so
  // debug strings reflect what the predicate actually evaluates. We
  // intentionally do not echo /g or /y back because they are stripped.
  const label = `message.textMatches(${regex.toString()})`;

  const predicate = (u: TypedUpdate): u is TypedMessageUpdate => {
    if (!isMessage(u)) {
      return false;
    }
    const body = getTextBody(u);
    if (body === undefined) {
      return false;
    }
    return regex.test(body);
  };

  return buildFilter(predicate, label);
}

function messageTextEquals(value: string): TypedFilter<TypedMessageUpdate> {
  if (typeof value !== "string") {
    throw new FilterValidationError(
      "invalid_predicate",
      "message.textEquals: value must be a string."
    );
  }

  const label = `message.textEquals(${JSON.stringify(value)})`;
  const predicate = (u: TypedUpdate): u is TypedMessageUpdate => {
    if (!isMessage(u)) {
      return false;
    }
    return getTextBody(u) === value;
  };
  return buildFilter(predicate, label);
}

function messageType(
  messageType: WhatsAppMessage["type"]
): TypedFilter<TypedMessageUpdate> {
  if (typeof messageType !== "string") {
    throw new FilterValidationError(
      "invalid_predicate",
      "message.type: messageType must be a string."
    );
  }
  if (messageType.length === 0) {
    throw new FilterValidationError(
      "empty_substring",
      "message.type: messageType must be non-empty."
    );
  }

  const label = `message.type(${JSON.stringify(messageType)})`;
  const predicate = (u: TypedUpdate): u is TypedMessageUpdate => {
    if (!isMessage(u)) {
      return false;
    }
    return isMessageType(u, messageType);
  };
  return buildFilter(predicate, label);
}

function messageFrom(phoneNumber: string): TypedFilter<TypedMessageUpdate> {
  if (typeof phoneNumber !== "string") {
    throw new FilterValidationError(
      "invalid_predicate",
      "message.from: phoneNumber must be a string."
    );
  }
  if (phoneNumber.length === 0) {
    throw new FilterValidationError(
      "empty_substring",
      "message.from: phoneNumber must be non-empty."
    );
  }

  const label = `message.from(${JSON.stringify(phoneNumber)})`;
  const predicate = (u: TypedUpdate): u is TypedMessageUpdate => {
    if (!isMessage(u)) {
      return false;
    }
    const inner = getMessageRecord(u);
    return inner !== undefined && readOwnDataField(inner, "from") === phoneNumber;
  };
  return buildFilter(predicate, label);
}

function mediaFamilyFilter(type: "image" | "video" | "audio" | "document" | "sticker"): TypedFilter<TypedMessageUpdate> {
  return buildFilter((u): u is TypedMessageUpdate => hasRecordBody(u, type, type), `message.${type}()`);
}

function messageMedia(): TypedFilter<TypedMessageUpdate> {
  return buildFilter(
    (u): u is TypedMessageUpdate =>
      hasRecordBody(u, "image", "image") ||
      hasRecordBody(u, "video", "video") ||
      hasRecordBody(u, "audio", "audio") ||
      hasRecordBody(u, "document", "document") ||
      hasRecordBody(u, "sticker", "sticker"),
    "message.media()"
  );
}

function messageLocation(): TypedFilter<TypedMessageUpdate> {
  return buildFilter((u): u is TypedMessageUpdate => hasRecordBody(u, "location", "location"), "message.location()");
}

function messageReaction(emoji?: string): TypedFilter<TypedMessageUpdate> {
  const exact = validateOptionalExact(emoji, "message.reaction");
  return buildFilter((u): u is TypedMessageUpdate => {
    const inner = getMessageRecord(u);
    if (inner === undefined || readOwnDataField(inner, "type") !== "reaction") return false;
    const reaction = readOwnDataField(inner, "reaction");
    if (!isRecord(reaction)) return false;
    if (exact === undefined) return true;
    return readOwnDataField(reaction, "emoji") === exact;
  }, exact === undefined ? "message.reaction()" : `message.reaction(${JSON.stringify(exact)})`);
}

function messageReactionAdded(): TypedFilter<TypedMessageUpdate> {
  return buildFilter((u): u is TypedMessageUpdate => {
    const inner = getMessageRecord(u);
    if (inner === undefined || readOwnDataField(inner, "type") !== "reaction") return false;
    const reaction = readOwnDataField(inner, "reaction");
    return isRecord(reaction) && typeof readOwnDataField(reaction, "emoji") === "string" && readOwnDataField(reaction, "emoji") !== "";
  }, "message.reactionAdded()");
}

function messageReactionRemoved(): TypedFilter<TypedMessageUpdate> {
  return buildFilter((u): u is TypedMessageUpdate => {
    const inner = getMessageRecord(u);
    if (inner === undefined || readOwnDataField(inner, "type") !== "reaction") return false;
    const reaction = readOwnDataField(inner, "reaction");
    return isRecord(reaction) && readOwnDataField(reaction, "emoji") === "";
  }, "message.reactionRemoved()");
}

function getInteractiveSubtype(u: TypedUpdate): { type: string; payload: Record<string, unknown> } | undefined {
  const inner = getMessageRecord(u);
  if (inner === undefined || readOwnDataField(inner, "type") !== "interactive") return undefined;
  const interactive = readOwnDataField(inner, "interactive");
  if (!isRecord(interactive)) return undefined;
  const type = readStringField(interactive, "type");
  return type === undefined ? undefined : { type, payload: interactive };
}

function messageInteractive(): TypedFilter<TypedMessageUpdate> {
  return buildFilter((u): u is TypedMessageUpdate => getInteractiveSubtype(u) !== undefined, "message.interactive()");
}

function messageInteractiveReply(kind: "button_reply" | "list_reply", key: "buttonReply" | "listReply", exactId: string | undefined, label: string): TypedFilter<TypedMessageUpdate> {
  const exact = validateOptionalExact(exactId, label);
  return buildFilter((u): u is TypedMessageUpdate => {
    const subtype = getInteractiveSubtype(u);
    if (subtype === undefined || subtype.type !== kind) return false;
    const reply = readOwnDataField(subtype.payload, key);
    if (!isRecord(reply)) return false;
    if (exact === undefined) return true;
    return readOwnDataField(reply, "id") === exact;
  }, exact === undefined ? `${label}()` : `${label}(${JSON.stringify(exact)})`);
}

function messageInteractiveNfmReply(): TypedFilter<TypedMessageUpdate> {
  return buildFilter((u): u is TypedMessageUpdate => {
    const subtype = getInteractiveSubtype(u);
    return subtype !== undefined && subtype.type === "nfm_reply" && isRecord(readOwnDataField(subtype.payload, "nfmReply"));
  }, "message.interactiveNfmReply()");
}

function messageButton(payload?: string): TypedFilter<TypedMessageUpdate> {
  const exact = validateOptionalExact(payload, "message.button");
  return buildFilter((u): u is TypedMessageUpdate => {
    const inner = getMessageRecord(u);
    if (inner === undefined || readOwnDataField(inner, "type") !== "button") return false;
    const button = readOwnDataField(inner, "button");
    if (!isRecord(button)) return false;
    if (exact === undefined) return true;
    return readOwnDataField(button, "payload") === exact;
  }, exact === undefined ? "message.button()" : `message.button(${JSON.stringify(exact)})`);
}

// ------------- exported namespace (kind filter + built-ins) --------

export interface MessageFilterNamespace extends TypedFilter<TypedMessageUpdate> {
  text(substring?: string): TypedFilter<TypedMessageUpdate>;
  textMatches(pattern: RegExp | string): TypedFilter<TypedMessageUpdate>;
  textEquals(value: string): TypedFilter<TypedMessageUpdate>;
  type(messageType: WhatsAppMessage["type"]): TypedFilter<TypedMessageUpdate>;
  from(phoneNumber: string): TypedFilter<TypedMessageUpdate>;
  media(): TypedFilter<TypedMessageUpdate>;
  image(): TypedFilter<TypedMessageUpdate>;
  video(): TypedFilter<TypedMessageUpdate>;
  audio(): TypedFilter<TypedMessageUpdate>;
  document(): TypedFilter<TypedMessageUpdate>;
  sticker(): TypedFilter<TypedMessageUpdate>;
  location(): TypedFilter<TypedMessageUpdate>;
  reaction(emoji?: string): TypedFilter<TypedMessageUpdate>;
  reactionAdded(): TypedFilter<TypedMessageUpdate>;
  reactionRemoved(): TypedFilter<TypedMessageUpdate>;
  interactive(): TypedFilter<TypedMessageUpdate>;
  interactiveButtonReply(id?: string): TypedFilter<TypedMessageUpdate>;
  interactiveListReply(id?: string): TypedFilter<TypedMessageUpdate>;
  interactiveNfmReply(): TypedFilter<TypedMessageUpdate>;
  button(payload?: string): TypedFilter<TypedMessageUpdate>;
}

const kindPredicate = (u: TypedUpdate): u is TypedMessageUpdate =>
  u.kind === "message";

export const message: MessageFilterNamespace = Object.freeze(
  Object.assign(
    {
      [FILTER_BRAND]: true as const,
      predicate: kindPredicate,
      describe: (): string => "message"
    },
    {
      text: messageText,
      textMatches: messageTextMatches,
      textEquals: messageTextEquals,
      type: messageType,
      from: messageFrom,
      media: messageMedia,
      image: () => mediaFamilyFilter("image"),
      video: () => mediaFamilyFilter("video"),
      audio: () => mediaFamilyFilter("audio"),
      document: () => mediaFamilyFilter("document"),
      sticker: () => mediaFamilyFilter("sticker"),
      location: messageLocation,
      reaction: messageReaction,
      reactionAdded: messageReactionAdded,
      reactionRemoved: messageReactionRemoved,
      interactive: messageInteractive,
      interactiveButtonReply: (id?: string) => messageInteractiveReply("button_reply", "buttonReply", id, "message.interactiveButtonReply"),
      interactiveListReply: (id?: string) => messageInteractiveReply("list_reply", "listReply", id, "message.interactiveListReply"),
      interactiveNfmReply: messageInteractiveNfmReply,
      button: messageButton
    }
  )
);
