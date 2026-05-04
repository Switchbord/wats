// @wats/types — contacts.ts
//
// Closed contact shape per ADR-004 F-1. The wire payload uses snake_case
// sub-fields (first_name / formatted_name) which are preserved here via
// `raw` and reachable escape hatches so F-8's normalizer can promote
// them to camelCase without breaking callers that touch `raw` today.
//
// TODO(F-8): replace raw-wire field mirroring in `WhatsAppContactName`
// and related sub-shapes with the normalizer's camelCase output. The
// duplicated snake_case surface stays until F-8 lands.

export interface WhatsAppContactName {
  formatted?: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  suffix?: string;
  prefix?: string;
  /**
   * Legacy camelCase fields retained from B1. Either casing style may be
   * populated depending on who authored the payload.
   * TODO(F-8): collapse to camelCase-only once the normalizer lands.
   */
  formattedName?: string;
  firstName?: string;
  lastName?: string;
}

export interface ContactPhone {
  phone?: string;
  type?: string;
  wa_id?: string;
}

export interface ContactEmail {
  email?: string;
  type?: string;
}

export interface ContactAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  type?: string;
}

export interface ContactOrg {
  company?: string;
  department?: string;
  title?: string;
}

export interface ContactUrl {
  url?: string;
  type?: string;
}

export interface WhatsAppContact {
  wa_id?: string;
  profile?: { name?: string };
  name?: WhatsAppContactName;
  phones?: ContactPhone[];
  emails?: ContactEmail[];
  addresses?: ContactAddress[];
  org?: ContactOrg;
  urls?: ContactUrl[];
  birthday?: string;
  raw?: unknown;
}

export const WATS_TYPES_CONTACTS_EXPORTS = [
  "WhatsAppContact",
  "WhatsAppContactName",
  "ContactPhone",
  "ContactEmail",
  "ContactAddress",
  "ContactOrg",
  "ContactUrl"
] as const;
