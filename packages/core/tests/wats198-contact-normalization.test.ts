// WATS-198 RED — camelCase-only contact types + inbound contact normalization.
//
// Behavioral tests for the webhook normalizer's contact mapping:
//   (a) field-value contacts[] (sender profile data accompanying inbound
//       messages) are mapped from Meta wire ({profile:{name}, wa_id, ...})
//       to camelCase NormalizedContact on TypedMessageUpdate.
//   (b) contacts-type message entries (messages[].contacts[] when a user
//       sends a contact card) are mapped from wire sub-fields
//       (formatted_name/first_name/wa_id/country_code/...) to camelCase
//       WhatsAppContact on the normalized message payload.
//   (c) malformed contacts entries (null, primitive, array-in-wrong-slot,
//       missing discriminator fields) are skipped/counted without throw.
//
// RED state: the normalizer does not yet normalize contacts. Field-value
// contacts are not surfaced on TypedMessageUpdate, and contacts-message
// entries fall through to the default safe-clone (preserving snake_case
// wire keys). All assertions below fail for the intended reason.

import { describe, expect, test } from "bun:test";
import { normalizeWebhookEnvelope } from "../src/webhookNormalizer";

type LooseUpdate = {
  readonly kind: string;
  readonly updateId: string;
  readonly message?: Record<string, unknown>;
  readonly contacts?: ReadonlyArray<Record<string, unknown>>;
};

type LooseResult = {
  readonly updates: ReadonlyArray<LooseUpdate>;
  readonly skipped: ReadonlyArray<{ reason: string; path: string; detail?: string }>;
};

function messagesEnvelope(value: Record<string, unknown>): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-CONTACTS",
        time: 1713697200,
        changes: [{ field: "messages", value }]
      }
    ]
  };
}

const baseMetadata = {
  display_phone_number: "15550001111",
  phone_number_id: "1234567890"
};

describe("WATS-198 field-value contacts normalization", () => {
  test("sender profile contacts[] are mapped to camelCase NormalizedContact on each message update", () => {
    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        contacts: [
          { wa_id: "15551234567", profile: { name: "Ada Lovelace" } },
          { wa_id: "15557654321", profile: { name: "Bob Smith" } }
        ],
        messages: [
          {
            from: "15551234567",
            id: "wamid.FV1",
            timestamp: "1713697100",
            type: "text",
            text: { body: "hello from Ada" }
          }
        ]
      })
    ) as unknown as LooseResult;

    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(1);
    const update = result.updates[0];
    expect(update.kind).toBe("message");

    // Field-value contacts[] must be surfaced as camelCase on the update.
    const contacts = update.contacts;
    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts!.length).toBe(2);

    // First contact: wa_id -> waId, profile.name preserved.
    expect(contacts![0].waId).toBe("15551234567");
    expect(contacts![0].profile).toEqual({ name: "Ada Lovelace" });
    // snake_case wire key must NOT appear on the normalized payload.
    expect("wa_id" in contacts![0]).toBe(false);
    // raw preserves the original wire record.
    expect(contacts![0].raw).toEqual({
      wa_id: "15551234567",
      profile: { name: "Ada Lovelace" }
    });

    expect(contacts![1].waId).toBe("15557654321");
    expect(contacts![1].profile).toEqual({ name: "Bob Smith" });
  });

  test("field-value contacts are absent when the change carries no contacts[]", () => {
    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        messages: [
          {
            from: "15551234567",
            id: "wamid.FV2",
            timestamp: "1713697101",
            type: "text",
            text: { body: "no contacts here" }
          }
        ]
      })
    ) as unknown as LooseResult;

    expect(result.updates.length).toBe(1);
    const update = result.updates[0];
    expect(update.contacts).toBeUndefined();
  });
});

describe("WATS-198 contacts-message normalization", () => {
  test("contacts-type message maps wire sub-fields to camelCase WhatsAppContact", () => {
    const wireContact = {
      name: {
        formatted_name: "John Doe",
        first_name: "John",
        last_name: "Doe",
        middle_name: "Q",
        suffix: "Jr",
        prefix: "Mr"
      },
      phones: [
        { phone: "+1234567890", type: "CELL", wa_id: "1234567890" },
        { phone: "+1987654321", type: "HOME" }
      ],
      emails: [{ email: "john@example.com", type: "WORK" }],
      addresses: [
        {
          street: "123 Main St",
          city: "Anytown",
          state: "CA",
          zip: "12345",
          country: "USA",
          country_code: "US",
          type: "HOME"
        }
      ],
      org: { company: "Acme", department: "Engineering", title: "Developer" },
      urls: [{ url: "https://example.com", type: "WORK" }],
      birthday: "1990-01-01"
    };

    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        messages: [
          {
            from: "15551234567",
            id: "wamid.CM1",
            timestamp: "1713697100",
            type: "contacts",
            contacts: [wireContact]
          }
        ]
      })
    ) as unknown as LooseResult;

    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(1);
    const message = result.updates[0].message!;
    expect(message.type).toBe("contacts");

    const contacts = message.contacts as ReadonlyArray<Record<string, unknown>> | undefined;
    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts!.length).toBe(1);

    const contact = contacts![0];

    // name sub-fields: snake_case -> camelCase.
    const name = contact.name as Record<string, unknown>;
    expect(name.formattedName).toBe("John Doe");
    expect(name.firstName).toBe("John");
    expect(name.lastName).toBe("Doe");
    expect(name.middleName).toBe("Q");
    expect(name.suffix).toBe("Jr");
    expect(name.prefix).toBe("Mr");
    // snake_case wire keys must NOT appear on the normalized name.
    expect("formatted_name" in name).toBe(false);
    expect("first_name" in name).toBe(false);
    expect("last_name" in name).toBe(false);
    expect("middle_name" in name).toBe(false);

    // phones: wa_id -> waId.
    const phones = contact.phones as ReadonlyArray<Record<string, unknown>>;
    expect(phones.length).toBe(2);
    expect(phones[0].phone).toBe("+1234567890");
    expect(phones[0].type).toBe("CELL");
    expect(phones[0].waId).toBe("1234567890");
    expect("wa_id" in phones[0]).toBe(false);
    expect(phones[1].waId).toBeUndefined();

    // addresses: country_code -> countryCode.
    const addresses = contact.addresses as ReadonlyArray<Record<string, unknown>>;
    expect(addresses.length).toBe(1);
    expect(addresses[0].street).toBe("123 Main St");
    expect(addresses[0].countryCode).toBe("US");
    expect("country_code" in addresses[0]).toBe(false);

    // org / urls / emails / birthday already camelCase; preserved.
    expect(contact.org).toEqual({
      company: "Acme",
      department: "Engineering",
      title: "Developer"
    });
    expect(contact.urls).toEqual([{ url: "https://example.com", type: "WORK" }]);
    expect(contact.emails).toEqual([{ email: "john@example.com", type: "WORK" }]);
    expect(contact.birthday).toBe("1990-01-01");

    // raw preserves the original wire record.
    expect(contact.raw).toEqual(wireContact);
  });

  test("a contacts-message with an empty contacts[] produces an empty normalized array", () => {
    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        messages: [
          {
            from: "15551234567",
            id: "wamid.CM2",
            timestamp: "1713697101",
            type: "contacts",
            contacts: []
          }
        ]
      })
    ) as unknown as LooseResult;

    expect(result.skipped.length).toBe(0);
    expect(result.updates.length).toBe(1);
    const message = result.updates[0].message!;
    expect(message.type).toBe("contacts");
    const contacts = message.contacts as unknown;
    expect(Array.isArray(contacts)).toBe(true);
    expect((contacts as readonly unknown[]).length).toBe(0);
  });
});

describe("WATS-198 malformed contacts safety (battery §8)", () => {
  test("malformed field-value contacts[] entries are skipped without throw", () => {
    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        contacts: [
          null,
          "not-an-object",
          42,
          { profile: { name: "Valid Contact" }, wa_id: "15559990000" },
          { profile: "not-a-record" },
          []
        ],
        messages: [
          {
            from: "15559990000",
            id: "wamid.MF1",
            timestamp: "1713697100",
            type: "text",
            text: { body: "malformed contacts field" }
          }
        ]
      })
    ) as unknown as LooseResult;

    // The message update is still emitted.
    expect(result.updates.length).toBe(1);
    const update = result.updates[0];
    // Only the valid entry survives.
    const contacts = update.contacts;
    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts!.length).toBe(1);
    expect(contacts![0].waId).toBe("15559990000");
    expect(contacts![0].profile).toEqual({ name: "Valid Contact" });
  });

  test("malformed contacts-message entries are skipped without throw", () => {
    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        messages: [
          {
            from: "15551234567",
            id: "wamid.MF2",
            timestamp: "1713697100",
            type: "contacts",
            contacts: [
              null,
              "string-primitive",
              123,
              { name: { formatted_name: "Only Name" } },
              { phones: "not-an-array" },
              { addresses: [{ country_code: "US" }] },
              []
            ]
          }
        ]
      })
    ) as unknown as LooseResult;

    // The message update is still emitted with the valid entries normalized.
    expect(result.updates.length).toBe(1);
    const message = result.updates[0].message!;
    expect(message.type).toBe("contacts");
    const contacts = message.contacts as ReadonlyArray<Record<string, unknown>> | undefined;
    expect(Array.isArray(contacts)).toBe(true);
    // null, "string-primitive", 123, and [] are skipped.
    // { name: { formatted_name } } is valid (name normalized).
    // { phones: "not-an-array" } is valid (phones omitted, entry kept).
    // { addresses: [{ country_code }] } is valid (addresses normalized).
    expect(contacts!.length).toBe(3);

    const byHasName = contacts!.filter((c) => c.name !== undefined);
    expect(byHasName.length).toBe(1);
    const nameOnly = byHasName[0].name as Record<string, unknown>;
    expect(nameOnly.formattedName).toBe("Only Name");

    const byHasAddresses = contacts!.filter((c) => c.addresses !== undefined);
    expect(byHasAddresses.length).toBe(1);
    const addr = byHasAddresses[0].addresses as ReadonlyArray<Record<string, unknown>>;
    expect(addr[0].countryCode).toBe("US");
  });

  test("accessor-backed contacts entries are skipped without executing getters", () => {
    const contactsArr: unknown[] = [];
    Object.defineProperty(contactsArr, "0", {
      enumerable: true,
      get() {
        throw new Error("field-value contacts getter should not run");
      }
    });
    contactsArr.push({ wa_id: "15550001111", profile: { name: "Getter Safe" } });

    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        contacts: contactsArr,
        messages: [
          {
            from: "15550001111",
            id: "wamid.MF3",
            timestamp: "1713697100",
            type: "text",
            text: { body: "getter safety" }
          }
        ]
      })
    ) as unknown as LooseResult;

    expect(result.updates.length).toBe(1);
    const update = result.updates[0];
    const contacts = update.contacts;
    // The getter entry is skipped; the valid entry survives.
    expect(Array.isArray(contacts)).toBe(true);
    expect(contacts!.length).toBe(1);
    expect(contacts![0].waId).toBe("15550001111");
  });

  test("contacts[] as a non-array is omitted without throw", () => {
    const result = normalizeWebhookEnvelope(
      messagesEnvelope({
        messaging_product: "whatsapp",
        metadata: baseMetadata,
        contacts: "not-an-array",
        messages: [
          {
            from: "15551234567",
            id: "wamid.MF4",
            timestamp: "1713697100",
            type: "text",
            text: { body: "contacts not array" }
          }
        ]
      })
    ) as unknown as LooseResult;

    expect(result.updates.length).toBe(1);
    expect(result.updates[0].contacts).toBeUndefined();
  });
});
