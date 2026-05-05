// @switchbord/types — webhook.ts
//
// F-1 closes the open `[key: string]: unknown` on every webhook-value
// variant in favor of a discriminated union keyed by the outer field
// name. Each variant keeps a `raw: unknown` escape hatch so new Meta
// fields remain reachable without breaking the typed surface.
//
// The envelope / entry / change shapes remain unchanged: the field
// discriminator lives on `WhatsAppWebhookChange.field`.

import type { WhatsAppError, WhatsAppErrorPayload } from "./errors";
import type { WhatsAppContact } from "./contacts";
import type { WhatsAppMessage } from "./messages/union";
import type { WhatsAppMessageStatus } from "./statuses";

export interface WhatsAppWebhookEnvelope {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

export interface WhatsAppWebhookEntry {
  id?: string;
  time?: number;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookChange {
  field: string;
  value: WhatsAppWebhookValue;
  event?: string;
}

/**
 * The "messages" field carries inbound messages + statuses + contacts.
 * This is the most common shape and the only one that exposes the
 * message union.
 */
export interface WhatsAppMessagesFieldValue {
  messagingProduct: "whatsapp";
  metadata: {
    displayPhoneNumber: string;
    phoneNumberId: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppMessageStatus[];
  errors?: WhatsAppErrorPayload[];
  raw?: unknown;
}

/**
 * Template status lifecycle events (approved / rejected / etc). The
 * WhatsApp wire uses uppercase event values; preserved here as the
 * canonical closed enum.
 */
export interface WhatsAppTemplateStatusUpdateValue {
  messageTemplateId: string;
  messageTemplateName: string;
  messageTemplateLanguage: string;
  event:
    | "APPROVED"
    | "REJECTED"
    | "FLAGGED"
    | "PAUSED"
    | "DISABLED"
    | "PENDING_DELETION";
  reason?: string;
  raw?: unknown;
}

export interface WhatsAppAccountReviewUpdateValue {
  decision: string;
  raw?: unknown;
}

export interface WhatsAppUserMarketingPreferencesValue {
  waId: string;
  category: string;
  preference: "opt_in" | "opt_out";
  timestamp: string;
  raw?: unknown;
}

export interface WhatsAppPhoneNumberChangeValue {
  mobileDisplayName?: string;
  oldPhoneNumber?: string;
  newPhoneNumber: string;
  raw?: unknown;
}

export interface WhatsAppIdentityChangeValue {
  waId: string;
  acknowledged: boolean;
  createdTimestamp: string;
  hash?: string;
  raw?: unknown;
}

/**
 * Generic catch-all variant for fields not yet promoted to a concrete
 * shape. Callers that need to handle unknown field types reach into
 * `raw` to inspect the original payload.
 */
export interface WhatsAppRawWebhookValue {
  raw: unknown;
  errors?: WhatsAppError[];
}

/**
 * Closed union of webhook-value shapes. Because WhatsApp frequently
 * introduces new webhook fields without advance notice, this union
 * includes `WhatsAppRawWebhookValue` as the catch-all — every variant
 * also carries its own `raw` reference so forward compatibility holds
 * without re-opening the index signature.
 */
export type WhatsAppWebhookValue =
  | WhatsAppMessagesFieldValue
  | WhatsAppTemplateStatusUpdateValue
  | WhatsAppAccountReviewUpdateValue
  | WhatsAppUserMarketingPreferencesValue
  | WhatsAppPhoneNumberChangeValue
  | WhatsAppIdentityChangeValue
  | WhatsAppRawWebhookValue;

export const WATS_TYPES_WEBHOOK_EXPORTS = [
  "WhatsAppWebhookEnvelope",
  "WhatsAppWebhookEntry",
  "WhatsAppWebhookChange",
  "WhatsAppWebhookValue"
] as const;
