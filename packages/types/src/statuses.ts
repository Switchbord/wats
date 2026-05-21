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

export type WhatsAppPricingCategory = "marketing" | "marketing_lite" | string;
export type WhatsAppPricingModel = "CBP" | "NBP" | "PMP" | string;
export type WhatsAppMarketingMessageStatus = "accepted" | "held_for_quality_assessment" | "paused" | string;

export interface ConversationRef {
  id: string;
  /** WATS-98 Marketing Messages status webhooks can report `marketing_lite`. */
  origin?: { type: "marketing_lite" | string };
  expirationTimestamp?: string;
}

export interface PricingRef {
  /** WATS-98 accepts current Meta pricing categories including `marketing_lite`. */
  category: WhatsAppPricingCategory;
  /** WATS-98 MM API status examples use pricing model `PMP`. */
  pricingModel: WhatsAppPricingModel;
  billable?: boolean;
}

export interface WhatsAppMessageStatus {
  id: string;
  recipientId: string;
  status: WhatsAppMessageStatusKind;
  timestamp: string;
  conversation?: ConversationRef;
  pricing?: PricingRef;
  /** WATS-98 Graph wire `message_status`: `accepted`, `held_for_quality_assessment`, or `paused`. */
  messageStatus?: WhatsAppMarketingMessageStatus;
  errors?: WhatsAppError[];
  raw?: unknown;
}

export const WATS_TYPES_STATUSES_EXPORTS = [
  "WhatsAppMessageStatus",
  "WhatsAppMessageStatusKind"
] as const;
