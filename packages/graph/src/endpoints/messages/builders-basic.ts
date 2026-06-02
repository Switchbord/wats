// WATS-68 messages endpoint module split: text, media, location, contacts, and reaction builders.

import { GraphRequestValidationError } from "../../errors.js";
import type {
  GraphMessagesAudioPayload,
  GraphMessagesContactsPayload,
  GraphMessagesDocumentPayload,
  GraphMessagesImagePayload,
  GraphMessagesLocationPayload,
  GraphMessagesMediaPayload,
  GraphMessagesMediaType,
  GraphMessagesReactionPayload,
  GraphMessagesRemoveReactionInput,
  GraphMessagesPinPayload,
  GraphMessagesSendAudioInput,
  GraphMessagesSendCaptionedMediaInput,
  GraphMessagesSendContactsInput,
  GraphMessagesSendDocumentInput,
  GraphMessagesSendImageInput,
  GraphMessagesSendLocationInput,
  GraphMessagesSendMediaInput,
  GraphMessagesSendPinInput,
  GraphMessagesSendReactionInput,
  GraphMessagesSendStickerInput,
  GraphMessagesSendTextInput,
  GraphMessagesSendVideoInput,
  GraphMessagesStickerPayload,
  GraphMessagesTextPayload,
  GraphMessagesVideoPayload
} from "./types.js";
import {
  GRAPH_MESSAGES_DOCUMENT_FILENAME_MAX_LENGTH,
  GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH,
  GRAPH_MESSAGES_MEDIA_CAPTION_MAX_LENGTH,
  GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH,
  GRAPH_MESSAGES_MEDIA_LINK_MAX_LENGTH,
  GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH,
  GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH,
  GRAPH_MESSAGES_MAX_CONTACTS,
  applyRecipientType,
  assertBoundedArray,
  assertMessageRecipient,
  assertNonEmptyControlFreeString,
  assertNoUnsupportedMediaFields,
  assertValidGroupId,
  assertValidMediaLink,
  assertValidNumberInRange,
  asRecordInput,
  assertValidRecipient,
  assertValidReplyToMessageId,
  assertValidText,
  rejectGroupRecipient,
  hasControlChar,
  isPlainOptionsObject,
  mapValidatedArray,
  maybeText,
  withReplyContext
} from "./validation.js";

export function buildSendTextPayload(
  input: GraphMessagesSendTextInput
): GraphMessagesTextPayload {
  if (!isPlainOptionsObject(input)) {
    throw new GraphRequestValidationError(
      "Invalid sendText input: expected an options object."
    );
  }

  const { to, recipientType } = assertMessageRecipient(input as unknown as Record<string, unknown>, "sendText");
  const text = assertValidText(input.text);

  if (input.previewUrl !== undefined && typeof input.previewUrl !== "boolean") {
    throw new GraphRequestValidationError(
      "Invalid sendText input: previewUrl must be a boolean when provided."
    );
  }

  const payload: GraphMessagesTextPayload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: text
    }
  };

  if (input.previewUrl !== undefined) {
    payload.text.preview_url = input.previewUrl;
  }
  applyRecipientType(payload, recipientType);
  if (input.replyToMessageId !== undefined) {
    payload.context = {
      message_id: assertValidReplyToMessageId(input.replyToMessageId)
    };
  }

  return payload;
}

interface GraphMessagesMediaReferencePayload {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

interface GraphMessagesAudioReferencePayload extends GraphMessagesMediaReferencePayload {
  voice?: boolean;
}

function buildSendMediaPayload<TType extends GraphMessagesMediaType>(
  input: GraphMessagesSendMediaInput,
  mediaType: TType,
  helperName: string,
  options: { readonly caption: boolean; readonly filename: boolean }
): GraphMessagesMediaPayload {
  if (!isPlainOptionsObject(input)) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: expected an options object.`
    );
  }

  const record = input as Record<string, unknown>;
  assertNoUnsupportedMediaFields(record, helperName, options);

  const { to, recipientType } = assertMessageRecipient(record, helperName);
  const hasMediaId = record.mediaId !== undefined;
  const hasLink = record.link !== undefined;
  if (hasMediaId === hasLink) {
    throw new GraphRequestValidationError(
      `Invalid ${helperName} input: exactly one of mediaId or link is required.`
    );
  }

  const media: GraphMessagesMediaReferencePayload = {};
  if (hasMediaId) {
    media.id = assertNonEmptyControlFreeString(
      record.mediaId,
      "mediaId",
      GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH,
      helperName
    );
  } else {
    media.link = assertValidMediaLink(record.link, helperName);
  }

  if (record.caption !== undefined) {
    media.caption = assertNonEmptyControlFreeString(
      record.caption,
      "caption",
      GRAPH_MESSAGES_MEDIA_CAPTION_MAX_LENGTH,
      helperName
    );
  }
  if (record.filename !== undefined) {
    media.filename = assertNonEmptyControlFreeString(
      record.filename,
      "filename",
      GRAPH_MESSAGES_DOCUMENT_FILENAME_MAX_LENGTH,
      helperName
    );
  }

  const payload = {
    messaging_product: "whatsapp" as const,
    to,
    type: mediaType,
    [mediaType]: media
  } as unknown as GraphMessagesMediaPayload;

  applyRecipientType(payload, recipientType);
  if (record.replyToMessageId !== undefined) {
    (payload as GraphMessagesMediaPayload & { context?: { message_id: string } }).context = {
      message_id: assertValidReplyToMessageId(record.replyToMessageId)
    };
  }

  return payload;
}

export function buildSendImagePayload(
  input: GraphMessagesSendImageInput
): GraphMessagesImagePayload {
  return buildSendMediaPayload(input, "image", "sendImage", {
    caption: true,
    filename: false
  }) as GraphMessagesImagePayload;
}

export function buildSendVideoPayload(
  input: GraphMessagesSendVideoInput
): GraphMessagesVideoPayload {
  return buildSendMediaPayload(input, "video", "sendVideo", {
    caption: true,
    filename: false
  }) as GraphMessagesVideoPayload;
}

export function buildSendAudioPayload(
  input: GraphMessagesSendAudioInput
): GraphMessagesAudioPayload {
  const payload = buildSendMediaPayload(input, "audio", "sendAudio", {
    caption: false,
    filename: false
  }) as GraphMessagesAudioPayload;
  const record = input as unknown as Record<string, unknown>;
  if (record.voice !== undefined) {
    if (typeof record.voice !== "boolean") {
      throw new GraphRequestValidationError("Invalid sendAudio input: voice must be a boolean when provided.");
    }
    if (record.voice) payload.audio.voice = true;
  }
  return payload;
}

export function buildSendDocumentPayload(
  input: GraphMessagesSendDocumentInput
): GraphMessagesDocumentPayload {
  return buildSendMediaPayload(input, "document", "sendDocument", {
    caption: true,
    filename: true
  }) as GraphMessagesDocumentPayload;
}

export function buildSendStickerPayload(
  input: GraphMessagesSendStickerInput
): GraphMessagesStickerPayload {
  return buildSendMediaPayload(input, "sticker", "sendSticker", {
    caption: false,
    filename: false
  }) as GraphMessagesStickerPayload;
}

export function buildSendLocationPayload(input: GraphMessagesSendLocationInput): GraphMessagesLocationPayload {
  const record = asRecordInput(input, "sendLocation");
  rejectGroupRecipient(record, "sendLocation", "location messages");
  const { to, recipientType } = assertMessageRecipient(record, "sendLocation");
  const payload: GraphMessagesLocationPayload = {
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: assertValidNumberInRange(record.latitude, "latitude", -90, 90, "sendLocation"),
      longitude: assertValidNumberInRange(record.longitude, "longitude", -180, 180, "sendLocation")
    }
  };
  const name = maybeText(record.name, "name", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendLocation");
  const address = maybeText(record.address, "address", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendLocation");
  if (name !== undefined) payload.location.name = name;
  if (address !== undefined) payload.location.address = address;
  applyRecipientType(payload, recipientType);
  return withReplyContext(payload, record);
}

function normalizeContactName(value: unknown, helperName: string): Record<string, unknown> {
  if (!isPlainOptionsObject(value)) throw new GraphRequestValidationError(`Invalid ${helperName} input: contact.name must be an object.`);
  const name = value as Record<string, unknown>;
  const formatted = maybeText(name.formattedName ?? name.formatted, "name.formattedName", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
  if (formatted === undefined) throw new GraphRequestValidationError(`Invalid ${helperName} input: contact.name.formattedName is required.`);
  const out: Record<string, unknown> = { formatted_name: formatted };
  const pairs: readonly [string, string][] = [["firstName", "first_name"], ["lastName", "last_name"], ["middleName", "middle_name"], ["suffix", "suffix"], ["prefix", "prefix"]];
  for (const [camel, snake] of pairs) {
    const v = maybeText(name[camel] ?? name[snake], `name.${camel}`, GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
    if (v !== undefined) out[snake] = v;
  }
  return out;
}

function normalizeTypedStringRecord(value: unknown, fieldName: string, requiredField: string, helperName: string): Record<string, unknown> {
  if (!isPlainOptionsObject(value)) throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName} entries must be objects.`);
  const record = value as Record<string, unknown>;
  const primary = maybeText(record[requiredField], `${fieldName}.${requiredField}`, GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
  if (primary === undefined) throw new GraphRequestValidationError(`Invalid ${helperName} input: ${fieldName}.${requiredField} is required.`);
  const out: Record<string, unknown> = { [requiredField]: primary };
  const type = maybeText(record.type, `${fieldName}.type`, GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  if (type !== undefined) out.type = type;
  return out;
}

function normalizeContact(value: unknown, helperName: string): Record<string, unknown> {
  if (!isPlainOptionsObject(value)) throw new GraphRequestValidationError(`Invalid ${helperName} input: contacts entries must be objects.`);
  const contact = value as Record<string, unknown>;
  const out: Record<string, unknown> = { name: normalizeContactName(contact.name, helperName) };
  if (contact.phones !== undefined) {
    out.phones = mapValidatedArray(assertBoundedArray(contact.phones, "contact.phones", 1, 20, helperName), (entry) => {
      if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError(`Invalid ${helperName} input: phone entries must be objects.`);
      const phone = entry as Record<string, unknown>;
      const rawPhone = maybeText(phone.phone, "phone.phone", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
      const waId = maybeText(phone.waId ?? phone.wa_id, "phone.waId", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
      if (rawPhone === undefined && waId === undefined) throw new GraphRequestValidationError(`Invalid ${helperName} input: phone requires phone or waId.`);
      const normalized: Record<string, unknown> = {};
      if (rawPhone !== undefined) normalized.phone = rawPhone;
      if (waId !== undefined) normalized.wa_id = waId;
      const type = maybeText(phone.type, "phone.type", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
      if (type !== undefined) normalized.type = type;
      return normalized;
    });
  }
  if (contact.emails !== undefined) out.emails = mapValidatedArray(assertBoundedArray(contact.emails, "contact.emails", 1, 20, helperName), (entry) => normalizeTypedStringRecord(entry, "email", "email", helperName));
  if (contact.urls !== undefined) {
    out.urls = mapValidatedArray(assertBoundedArray(contact.urls, "contact.urls", 1, 20, helperName), (entry) => {
      const normalized = normalizeTypedStringRecord(entry, "url", "url", helperName);
      normalized.url = assertValidMediaLink(normalized.url, helperName);
      return normalized;
    });
  }
  if (contact.addresses !== undefined) {
    out.addresses = mapValidatedArray(assertBoundedArray(contact.addresses, "contact.addresses", 1, 20, helperName), (entry) => {
      if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError(`Invalid ${helperName} input: address entries must be objects.`);
      const address = entry as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const [camel, snake] of [["street", "street"], ["city", "city"], ["state", "state"], ["zip", "zip"], ["country", "country"], ["countryCode", "country_code"], ["type", "type"]] as const) {
        const v = maybeText(address[camel] ?? address[snake], `address.${camel}`, GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
        if (v !== undefined) normalized[snake] = v;
      }
      if (Object.keys(normalized).length === 0) throw new GraphRequestValidationError(`Invalid ${helperName} input: address entries must contain at least one field.`);
      return normalized;
    });
  }
  if (contact.org !== undefined) {
    if (!isPlainOptionsObject(contact.org)) throw new GraphRequestValidationError(`Invalid ${helperName} input: org must be an object.`);
    const org = contact.org as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of ["company", "department", "title"] as const) {
      const v = maybeText(org[key], `org.${key}`, GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, helperName);
      if (v !== undefined) normalized[key] = v;
    }
    if (Object.keys(normalized).length > 0) out.org = normalized;
  }
  const birthday = maybeText(contact.birthday, "birthday", 32, helperName);
  if (birthday !== undefined) out.birthday = birthday;
  return out;
}

export function buildSendContactsPayload(input: GraphMessagesSendContactsInput): GraphMessagesContactsPayload {
  const record = asRecordInput(input, "sendContacts");
  rejectGroupRecipient(record, "sendContacts", "contacts messages");
  const { to, recipientType } = assertMessageRecipient(record, "sendContacts");
  const contacts = mapValidatedArray(assertBoundedArray(record.contacts, "contacts", 1, GRAPH_MESSAGES_MAX_CONTACTS, "sendContacts"), (c) => normalizeContact(c, "sendContacts"));
  return withReplyContext(applyRecipientType({ messaging_product: "whatsapp", to, type: "contacts", contacts } satisfies GraphMessagesContactsPayload, recipientType), record);
}

export function buildSendReactionPayload(input: GraphMessagesSendReactionInput): GraphMessagesReactionPayload {
  const record = asRecordInput(input, "sendReaction");
  rejectGroupRecipient(record, "sendReaction", "reaction messages");
  const { to, recipientType } = assertMessageRecipient(record, "sendReaction");
  const emoji = assertNonEmptyControlFreeString(record.emoji, "emoji", 32, "sendReaction");
  return applyRecipientType({
    messaging_product: "whatsapp",
    to,
    type: "reaction",
    reaction: {
      message_id: assertNonEmptyControlFreeString(record.messageId, "messageId", GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH, "sendReaction"),
      emoji
    }
  }, recipientType);
}

export function buildRemoveReactionPayload(input: GraphMessagesRemoveReactionInput): GraphMessagesReactionPayload {
  const record = asRecordInput(input, "removeReaction");
  rejectGroupRecipient(record, "removeReaction", "reaction messages");
  const { to, recipientType } = assertMessageRecipient(record, "removeReaction");
  return applyRecipientType({
    messaging_product: "whatsapp",
    to,
    type: "reaction",
    reaction: {
      message_id: assertNonEmptyControlFreeString(record.messageId, "messageId", GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH, "removeReaction"),
      emoji: ""
    }
  } satisfies GraphMessagesReactionPayload, recipientType);
}

export function buildSendPinPayload(input: GraphMessagesSendPinInput): GraphMessagesPinPayload {
  const record = asRecordInput(input, "sendPin");
  if (record.recipientType !== undefined && record.recipientType !== "group") {
    throw new GraphRequestValidationError("Invalid sendPin input: recipientType must be group when provided.");
  }
  const to = assertValidGroupId(record.to, "sendPin");
  const pinType = record.pinType;
  if (pinType !== "pin" && pinType !== "unpin") {
    throw new GraphRequestValidationError("Invalid sendPin input: pinType must be pin or unpin.");
  }
  const expirationDays = record.expirationDays;
  if (typeof expirationDays !== "number" || !Number.isInteger(expirationDays) || expirationDays < 1 || expirationDays > 30) {
    throw new GraphRequestValidationError("Invalid sendPin input: expirationDays must be an integer between 1 and 30.");
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "group",
    to,
    type: "pin",
    pin: {
      type: pinType,
      message_id: assertNonEmptyControlFreeString(record.messageId, "messageId", GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH, "sendPin"),
      expiration_days: expirationDays
    }
  };
}
