import { describe, expect, test } from "bun:test";
import type {
  WhatsAppMessage,
  WhatsAppMessageStatus,
  WhatsAppContact,
  WhatsAppWebhookValue,
  WhatsAppAccountUpdateValue,
  TextMessage,
  ImageMessage,
  VideoMessage,
  AudioMessage,
  DocumentMessage,
  StickerMessage,
  LocationMessage,
  ContactsMessage,
  ReactionMessage,
  OrderMessage,
  SystemMessage,
  UnsupportedMessage,
  InteractiveMessage,
  ButtonMessage,
  InteractiveReply,
  WhatsAppError,
  WhatsAppMessageStatusKind,
  MediaReference,
  DocumentReference,
  MessageContext
} from "@wats/types";

// Type-level helpers for exhaustiveness and equality assertions.
type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type MemberOf<U, K> = Extract<U, { type: K }>;
type Has<U, K> = MemberOf<U, K> extends never ? false : true;

// Assert every required variant is present in the WhatsAppMessage union.
type _HasText = Expect<Has<WhatsAppMessage, "text">>;
type _HasImage = Expect<Has<WhatsAppMessage, "image">>;
type _HasVideo = Expect<Has<WhatsAppMessage, "video">>;
type _HasAudio = Expect<Has<WhatsAppMessage, "audio">>;
type _HasDocument = Expect<Has<WhatsAppMessage, "document">>;
type _HasSticker = Expect<Has<WhatsAppMessage, "sticker">>;
type _HasLocation = Expect<Has<WhatsAppMessage, "location">>;
type _HasContacts = Expect<Has<WhatsAppMessage, "contacts">>;
type _HasReaction = Expect<Has<WhatsAppMessage, "reaction">>;
type _HasOrder = Expect<Has<WhatsAppMessage, "order">>;
type _HasSystem = Expect<Has<WhatsAppMessage, "system">>;
type _HasUnsupported = Expect<Has<WhatsAppMessage, "unsupported">>;
type _HasInteractive = Expect<Has<WhatsAppMessage, "interactive">>;
type _HasButton = Expect<Has<WhatsAppMessage, "button">>;

// Each variant's `type` field is a string literal, not a plain string.
type _TextLiteral = Expect<Equal<TextMessage["type"], "text">>;
type _ImageLiteral = Expect<Equal<ImageMessage["type"], "image">>;
type _VideoLiteral = Expect<Equal<VideoMessage["type"], "video">>;
type _AudioLiteral = Expect<Equal<AudioMessage["type"], "audio">>;
type _DocumentLiteral = Expect<Equal<DocumentMessage["type"], "document">>;
type _StickerLiteral = Expect<Equal<StickerMessage["type"], "sticker">>;
type _LocationLiteral = Expect<Equal<LocationMessage["type"], "location">>;
type _ContactsLiteral = Expect<Equal<ContactsMessage["type"], "contacts">>;
type _ReactionLiteral = Expect<Equal<ReactionMessage["type"], "reaction">>;
type _OrderLiteral = Expect<Equal<OrderMessage["type"], "order">>;
type _SystemLiteral = Expect<Equal<SystemMessage["type"], "system">>;
type _UnsupportedLiteral = Expect<Equal<UnsupportedMessage["type"], "unsupported">>;
type _InteractiveLiteral = Expect<Equal<InteractiveMessage["type"], "interactive">>;
type _ButtonLiteral = Expect<Equal<ButtonMessage["type"], "button">>;

// Discriminator exhaustiveness: taking a WhatsAppMessage's `type` to a concrete
// value MUST cover exactly these literals. The closed-union equality catches
// both missing members and accidental overly-loose `string` types.
type _MessageKindUnion = Expect<
  Equal<
    WhatsAppMessage["type"],
    | "text"
    | "image"
    | "video"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contacts"
    | "reaction"
    | "order"
    | "system"
    | "unsupported"
    | "interactive"
    | "button"
  >
>;

// Status kind MUST be the closed union of 6 literals.
type _StatusKindUnion = Expect<
  Equal<
    WhatsAppMessageStatusKind,
    "sent" | "delivered" | "read" | "played" | "failed" | "deleted" | "warning"
  >
>;

type _StatusStatusField = Expect<Equal<WhatsAppMessageStatus["status"], WhatsAppMessageStatusKind>>;

// WhatsAppContact MUST NOT carry an open `[key: string]: unknown` index signature.
// If it did, `never` would be assignable to arbitrary string-keyed access, so
// the following equality would collapse. We pin a handful of required optional
// fields and then assert no extra index exposure.
type ContactKeys = keyof WhatsAppContact;
type _ContactKeysAreLiteral = Expect<Equal<string extends ContactKeys ? true : false, false>>;

// InteractiveReply MUST be a discriminated union keyed by `type`.
type _InteractiveReplyKinds = Expect<
  Equal<
    InteractiveReply["type"],
    | "button_reply"
    | "list_reply"
    | "nfm_reply"
    | "product_reply"
    | "product_list_reply"
    | "cta_url_reply"
    | "call_permission_reply"
  >
>;

// WhatsAppWebhookValue: unions must NOT be open `[key: string]: unknown`.
type WebhookValueKeys = keyof WhatsAppWebhookValue;
type _WebhookValueNotOpen = Expect<Equal<string extends WebhookValueKeys ? true : false, false>>;

// Every variant must carry `id`, `from`, `timestamp` when it is a message-kind
// and must always carry its kind-specific payload.
type _TextPayload = Expect<Equal<TextMessage["text"], { body: string }>>;

// Runtime exhaustiveness probe: constructing a dispatcher over the union
// without handling every variant MUST be a compile error. We express that
// at runtime with a `switch` that includes a `never` default branch.
function assertAllMessageKindsHandled(message: WhatsAppMessage): string {
  switch (message.type) {
    case "text":
      return message.text.body;
    case "image":
      return message.image.id;
    case "video":
      return message.video.id;
    case "audio":
      return message.audio.id;
    case "document":
      return message.document.id;
    case "sticker":
      return message.sticker.id;
    case "location":
      return String(message.location.latitude);
    case "contacts":
      return String(message.contacts.length);
    case "reaction":
      return message.reaction.emoji;
    case "order":
      return String(message.order);
    case "system":
      return String(message.system);
    case "unsupported":
      return message.id;
    case "interactive":
      return message.interactive.type;
    case "button":
      return message.button.text;
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

function assertAllStatusesHandled(status: WhatsAppMessageStatus): string {
  switch (status.status) {
    case "sent":
    case "delivered":
    case "read":
    case "played":
    case "failed":
    case "deleted":
    case "warning":
      return status.status;
    default: {
      const _exhaustive: never = status.status;
      return _exhaustive;
    }
  }
}

describe("F-1 discriminated union contracts", () => {
  test("WhatsAppMessage exhaustive switch narrows each variant to its payload", () => {
    const sample: WhatsAppMessage = {
      type: "text",
      id: "wamid.1",
      from: "15551234567",
      timestamp: "1718000000",
      text: { body: "hello" }
    };
    expect(assertAllMessageKindsHandled(sample)).toBe("hello");
  });

  test("WhatsAppMessageStatus exhaustive switch accepts each of the six kinds", () => {
    const kinds: WhatsAppMessageStatusKind[] = [
      "sent",
      "delivered",
      "read",
      "played",
      "failed",
      "deleted",
      "warning"
    ];
    for (const kind of kinds) {
      const status: WhatsAppMessageStatus = {
        id: "wamid.status",
        recipientId: "15551234567",
        status: kind,
        timestamp: "1718000000"
      };
      expect(assertAllStatusesHandled(status)).toBe(kind);
    }
  });

  test("WhatsAppContact is closed: an arbitrary property is not assignable as a typed field", () => {
    // If the contact were open, `typeof contact.arbitraryKey` would be unknown
    // rather than a type error. We verify closure via the type-level check
    // above and a runtime sanity on declared fields here.
    const contact: WhatsAppContact = {
      name: { formatted: "Jane Q Public" }
    };
    expect(contact.name?.formatted).toBe("Jane Q Public");
  });

  test("ImageMessage narrows MediaReference with id/mimeType", () => {
    const message: ImageMessage = {
      type: "image",
      id: "wamid.img",
      from: "15551234567",
      timestamp: "1718000001",
      image: { id: "media-1", mimeType: "image/jpeg" }
    };
    const media: MediaReference = message.image;
    expect(media.id).toBe("media-1");
    expect(media.mimeType).toBe("image/jpeg");
    const mediaWithUrl: MediaReference = { id: "media-url", mimeType: "image/jpeg", url: "https://lookaside.fbsbx.com/media" };
    expect(mediaWithUrl.url).toContain("lookaside");
  });

  test("DocumentMessage carries DocumentReference with filename", () => {
    const message: DocumentMessage = {
      type: "document",
      id: "wamid.doc",
      from: "15551234567",
      timestamp: "1718000002",
      document: {
        id: "media-2",
        mimeType: "application/pdf",
        filename: "invoice.pdf"
      }
    };
    const doc: DocumentReference = message.document;
    expect(doc.filename).toBe("invoice.pdf");
  });

  test("LocationMessage carries latitude/longitude and optional name/address", () => {
    const message: LocationMessage = {
      type: "location",
      id: "wamid.loc",
      from: "15551234567",
      timestamp: "1718000003",
      location: { latitude: 1.1, longitude: 2.2, name: "HQ" }
    };
    expect(message.location.latitude).toBe(1.1);
    expect(message.location.longitude).toBe(2.2);
    expect(message.location.name).toBe("HQ");
  });

  test("MessageContext is structurally typed (optional forwarded flags)", () => {
    const ctx: MessageContext = {
      messageId: "wamid.src",
      forwarded: true,
      frequentlyForwarded: false
    };
    expect(ctx.messageId).toBe("wamid.src");
    expect(ctx.forwarded).toBe(true);
  });

  test("InteractiveMessage reply union discriminates each interactive subtype", () => {
    const callPermissionReply: InteractiveReply = {
      type: "call_permission_reply",
      callPermissionReply: { response: "accepted", expirationTimestamp: "1718000099" }
    };
    expect(callPermissionReply.callPermissionReply.response).toBe("accepted");

    const reply: InteractiveReply = {
      type: "button_reply",
      buttonReply: { id: "btn-1", title: "Yes" }
    };
    const message: InteractiveMessage = {
      type: "interactive",
      id: "wamid.int",
      from: "15551234567",
      timestamp: "1718000004",
      interactive: reply
    };
    expect(message.interactive.type).toBe("button_reply");
  });

  test("UnsupportedMessage preserves raw alongside optional errors", () => {
    const err: WhatsAppError = {
      code: 131051,
      title: "Unsupported message type",
      message: "Message type is not currently supported."
    };
    const message: UnsupportedMessage = {
      type: "unsupported",
      id: "wamid.unk",
      from: "15551234567",
      timestamp: "1718000005",
      errors: [err],
      unsupported: { type: "request_welcome", title: "Removed", description: "Deprecated by Meta" },
      raw: { original: "payload" }
    };
    expect(message.errors?.[0]?.code).toBe(131051);
    expect(message.unsupported?.type).toBe("request_welcome");
    expect(message.raw).toEqual({ original: "payload" });
  });

  test("WhatsAppWebhookValue messages-variant keeps typed arrays and raw escape hatch", () => {
    const value: WhatsAppWebhookValue = {
      messagingProduct: "whatsapp",
      metadata: {
        displayPhoneNumber: "15550001111",
        phoneNumberId: "123456789"
      },
      messages: [
        {
          type: "text",
          id: "wamid.w",
          from: "15551234567",
          timestamp: "1718000010",
          text: { body: "ping" }
        }
      ]
    };
    // The concrete message-field value narrows; `messages` is an array whose
    // elements are WhatsAppMessage.
    if ("messages" in value && value.messages !== undefined) {
      const first = value.messages[0];
      expect(first?.type).toBe("text");
    }
  });

  test("WhatsAppAccountUpdateValue exposes WATS-95 quality and alert helpers", () => {
    const value: WhatsAppAccountUpdateValue = {
      event: "THROUGHPUT_UPGRADE",
      phoneNumberQuality: {
        displayPhoneNumber: "15550783881",
        currentLimit: "TIER_UNLIMITED",
        maxDailyConversationsPerBusiness: "TIER_UNLIMITED"
      },
      alert: {
        entityType: "PHONE_NUMBER",
        entityId: "506914307656634",
        type: "PROFILE_PICTURE_LOST"
      }
    };
    expect(value.phoneNumberQuality?.currentLimit).toBe("TIER_UNLIMITED");
    expect(value.alert?.type).toBe("PROFILE_PICTURE_LOST");
  });
});
