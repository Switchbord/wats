// @wats/types — statuses.ts
//
// Closed WhatsAppMessageStatus per architecture notes F-1. The `status` field is
// the discriminator and narrows to the current Meta status literals. Additional
// context (conversation, pricing, errors) is flat and optional; any
// extra fields Meta may add ride through `raw`.

import type { WhatsAppError } from "./errors.js";

export type WhatsAppMessageStatusKind =
  | "sent"
  | "delivered"
  | "read"
  | "played"
  | "failed"
  | "deleted"
  | "warning";

export interface ConversationRef {
  id: string;
  origin?: { type: string };
  expirationTimestamp?: string;
}

export interface PricingRef {
  category: string;
  pricingModel: string;
  billable?: boolean;
}

export interface WhatsAppMessageStatus {
  id: string;
  recipientId: string;
  status: WhatsAppMessageStatusKind;
  timestamp: string;
  conversation?: ConversationRef;
  pricing?: PricingRef;
  errors?: WhatsAppError[];
  raw?: unknown;
}

export const WATS_TYPES_STATUSES_EXPORTS = [
  "WhatsAppMessageStatus",
  "WhatsAppMessageStatusKind"
] as const;
