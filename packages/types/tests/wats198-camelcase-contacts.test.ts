// WATS-198 RED — type-level + runtime assertions that the contacts types
// are camelCase-only (no snake_case wire field mirrors).
//
// The type-level checks (HasKey assertions) fail at compile time until
// contacts.ts drops the snake_case fields. They are enforced by
// `bun run typecheck:full` (tsconfig.full.json includes packages/types/tests/**).
//
// The runtime test constructs camelCase contact values and verifies the
// shape; it is a behavioral complement to the normalizer output tests in
// packages/core/tests/wats198-contact-normalization.test.ts.

import { describe, expect, test } from "bun:test";
import type {
  WhatsAppContact,
  WhatsAppContactName,
  ContactPhone,
  ContactAddress
} from "../src/contacts.js";

// --- Type-level assertions (compile-time) ---
// Each `HasKey` check assigns `false` to a type that is `true` only when
// the named key is still present on the type. Compilation fails until the
// snake_case / legacy wire field is removed.
type HasKey<T, K extends string> = K extends keyof T ? true : false;

// WhatsAppContactName: legacy wire fields must be gone.
const _noFormatted: HasKey<WhatsAppContactName, "formatted"> = false;
const _noFirstName: HasKey<WhatsAppContactName, "first_name"> = false;
const _noLastName: HasKey<WhatsAppContactName, "last_name"> = false;
const _noMiddleName: HasKey<WhatsAppContactName, "middle_name"> = false;

// ContactPhone: wa_id -> waId.
const _noPhoneWaId: HasKey<ContactPhone, "wa_id"> = false;

// ContactAddress: country_code -> countryCode.
const _noCountryCode: HasKey<ContactAddress, "country_code"> = false;

// WhatsAppContact: wa_id -> waId.
const _noContactWaId: HasKey<WhatsAppContact, "wa_id"> = false;

// CamelCase fields MUST be present.
const _hasFormattedName: HasKey<WhatsAppContactName, "formattedName"> = true;
const _hasFirstName: HasKey<WhatsAppContactName, "firstName"> = true;
const _hasPhoneWaId: HasKey<ContactPhone, "waId"> = true;
const _hasCountryCode: HasKey<ContactAddress, "countryCode"> = true;
const _hasContactWaId: HasKey<WhatsAppContact, "waId"> = true;

void _noFormatted;
void _noFirstName;
void _noLastName;
void _noMiddleName;
void _noPhoneWaId;
void _noCountryCode;
void _noContactWaId;
void _hasFormattedName;
void _hasFirstName;
void _hasPhoneWaId;
void _hasCountryCode;
void _hasContactWaId;

// --- Runtime behavioral complement ---

describe("WATS-198 camelCase-only contacts types", () => {
  test("WhatsAppContactName constructed with camelCase fields has no snake_case keys", () => {
    const name: WhatsAppContactName = {
      formattedName: "John Doe",
      firstName: "John",
      lastName: "Doe",
      middleName: "Q",
      suffix: "Jr",
      prefix: "Mr"
    };
    const keys = Object.keys(name);
    const snakeCaseKeys = keys.filter((k) => k.includes("_"));
    expect(snakeCaseKeys).toEqual([]);
    expect(name.formattedName).toBe("John Doe");
    expect(name.firstName).toBe("John");
  });

  test("ContactPhone uses waId, not wa_id", () => {
    const phone: ContactPhone = {
      phone: "+123****7890",
      type: "CELL",
      waId: "1234567890"
    };
    expect(phone.waId).toBe("1234567890");
    expect("wa_id" in phone).toBe(false);
  });

  test("ContactAddress uses countryCode, not country_code", () => {
    const addr: ContactAddress = {
      street: "123 Main St",
      countryCode: "US",
      type: "HOME"
    };
    expect(addr.countryCode).toBe("US");
    expect("country_code" in addr).toBe(false);
  });

  test("WhatsAppContact uses waId, not wa_id", () => {
    const contact: WhatsAppContact = {
      waId: "15551234567",
      profile: { name: "Ada" }
    };
    expect(contact.waId).toBe("15551234567");
    expect("wa_id" in contact).toBe(false);
  });
});
