// @wats/types — contacts.ts
//
// Closed contact shape per architecture notes F-1. The Meta wire payload
// uses snake_case sub-fields (first_name / formatted_name / wa_id /
// country_code / ...). These types describe the NORMALIZED camelCase
// shape; the @wats/core webhook normalizer owns the snake→camel mapping
// for inbound contacts. The original wire record is preserved on the
// normalizer output via `raw` and is reachable on the raw envelope via
// `rawChange`.

export interface WhatsAppContactName {
  formattedName?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;
  prefix?: string;
}

export interface ContactPhone {
  phone?: string;
  type?: string;
  waId?: string;
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
  countryCode?: string;
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
  waId?: string;
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
