// @wats/types — errors.ts
//
// Unified error payload shapes exposed in message, status, and webhook
// variants. The stricter `WhatsAppError` (required fields) is used when
// the type declares an error produced by the Graph/WhatsApp stack; the
// softer `WhatsAppErrorPayload` mirrors the B1 shape for backward
// compatibility with callers that still inspect optional wire fields.

export interface WhatsAppError {
  code: number;
  title: string;
  message: string;
  errorData?: {
    details?: string;
    href?: string;
  };
  href?: string;
}

/**
 * Backward-compatible payload shape introduced in B1. Retained so
 * existing consumers that inspect only-optional fields continue to
 * compile. New code should prefer `WhatsAppError`.
 */
export interface WhatsAppErrorPayload {
  code?: number;
  title?: string;
  message?: string;
  details?: string;
  errorData?: {
    details?: string;
    href?: string;
  };
  href?: string;
}

export const WATS_TYPES_ERRORS_EXPORTS = [
  "WhatsAppError",
  "WhatsAppErrorPayload"
] as const;
