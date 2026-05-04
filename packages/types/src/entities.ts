// @wats/types — entities.ts
//
// Entity entrypoint retained from B1 so external consumers that import
// from `@wats/types/entities` continue to resolve without change. F-1
// tightens the WhatsAppMessage / WhatsAppContact / WhatsAppMessageStatus
// shapes — see the messages/, contacts.ts, and statuses.ts modules for
// the discriminated-union implementations.
//
// Historical shapes that F-1 re-shaped:
//   - WhatsAppMessage: was a loose interface with open index signature;
//     now a discriminated union keyed by `type`.
//   - WhatsAppContact: was open on `[key: string]: unknown`; now closed
//     with explicit sub-shapes. Additional unmapped wire fields ride
//     through `raw`.
//   - WhatsAppMessageStatus: `status` was `string`; now the closed
//     union `WhatsAppMessageStatusKind`.
//
// Preserved (so existing callers still compile):
//   - WhatsAppMessageText structural alias.
//   - WhatsAppMessageContext legacy context shape.
//   - WhatsAppContactName legacy name shape (now with snake_case wire
//     field mirrors; see contacts.ts TODO(F-8)).
//   - WhatsAppErrorPayload loose payload shape.

export type { WhatsAppMessage } from "./messages/union";
export type {
  WhatsAppContact,
  WhatsAppContactName,
  ContactPhone,
  ContactEmail,
  ContactAddress,
  ContactOrg,
  ContactUrl
} from "./contacts";
export type {
  WhatsAppMessageStatus,
  WhatsAppMessageStatusKind,
  ConversationRef,
  PricingRef
} from "./statuses";
export type { WhatsAppError, WhatsAppErrorPayload } from "./errors";

// Legacy structural aliases retained verbatim from B1.
export interface WhatsAppMessageText {
  body: string;
}

/**
 * Legacy message-context shape carried over from B1. New code should
 * prefer `MessageContext` from `@wats/types/messages`.
 */
export interface WhatsAppMessageContext {
  from?: string;
  id?: string;
}

export const WATS_TYPES_ENTITIES_EXPORTS = [
  "WhatsAppMessage",
  "WhatsAppContact",
  "WhatsAppErrorPayload",
  "WhatsAppMessageStatus"
] as const;
