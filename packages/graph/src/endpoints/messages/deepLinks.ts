import { GraphRequestValidationError } from "../../errors.js";
import {
  GRAPH_MESSAGES_RECIPIENT_MAX_DIGITS,
  GRAPH_MESSAGES_VOICE_CALL_PAYLOAD_MAX_LENGTH,
  assertNonEmptyControlFreeString,
  hasControlChar
} from "./validation.js";

export interface WhatsAppCallDeepLinkInput {
  readonly phoneNumber: string;
  readonly bizPayload?: string;
}

function assertBusinessPhoneNumber(value: unknown): string {
  if (typeof value !== "string") {
    throw new GraphRequestValidationError("Invalid buildWhatsAppCallDeepLink input: phoneNumber must be a string.");
  }
  const digits = value.startsWith("+") ? value.slice(1) : value;
  if (digits.length === 0 || digits.trim().length === 0) {
    throw new GraphRequestValidationError("Invalid buildWhatsAppCallDeepLink input: phoneNumber must be non-empty.");
  }
  if (hasControlChar(digits) || !/^\d+$/.test(digits) || digits.length > GRAPH_MESSAGES_RECIPIENT_MAX_DIGITS) {
    throw new GraphRequestValidationError(
      `Invalid buildWhatsAppCallDeepLink input: phoneNumber must be digits with optional leading + and at most ${GRAPH_MESSAGES_RECIPIENT_MAX_DIGITS} digits.`
    );
  }
  return digits;
}

/**
 * Build a WhatsApp Calling deep link: `https://wa.me/call/<BUSINESS_PHONE_NUMBER>`.
 *
 * Source: Meta Developers, "Send WhatsApp Call Button Messages and Deep Links",
 * updated 2026-05-21. `bizPayload` is opaque and appears as `deeplink_payload`
 * on connect/terminate call webhooks when supported by the user's client.
 */
export function buildWhatsAppCallDeepLink(input: WhatsAppCallDeepLinkInput): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new GraphRequestValidationError("Invalid buildWhatsAppCallDeepLink input: expected an options object.");
  }
  const record = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "phoneNumber" && key !== "bizPayload") {
      throw new GraphRequestValidationError(`Invalid buildWhatsAppCallDeepLink input: unknown field ${key}.`);
    }
  }
  const phone = assertBusinessPhoneNumber(record.phoneNumber);
  const url = new URL(`https://wa.me/call/${phone}`);
  if (record.bizPayload !== undefined) {
    const payload = assertNonEmptyControlFreeString(record.bizPayload, "bizPayload", GRAPH_MESSAGES_VOICE_CALL_PAYLOAD_MAX_LENGTH, "buildWhatsAppCallDeepLink");
    url.searchParams.set("biz_payload", payload);
  }
  return url.toString();
}
