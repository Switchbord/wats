import * as rootEntrypoint from "@switchbord/types";
import * as configEntrypoint from "@switchbord/types/config";
import * as webhookEntrypoint from "@switchbord/types/webhook";
import * as entitiesEntrypoint from "@switchbord/types/entities";
import * as messagesEntrypoint from "@switchbord/types/messages";
import * as statusesEntrypoint from "@switchbord/types/statuses";
import * as contactsEntrypoint from "@switchbord/types/contacts";
import * as errorsEntrypoint from "@switchbord/types/errors";

import type {
  WhatsAppMessage,
  WhatsAppMessageStatus,
  WhatsAppMessageStatusKind,
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
  MediaReference,
  DocumentReference,
  MessageContext,
  WhatsAppError
} from "@switchbord/types";

const REQUIRED_EXPORT_SYMBOLS = {
  "@switchbord/types": [
    "WATS_TYPES_CONFIG_EXPORTS",
    "WATS_TYPES_WEBHOOK_EXPORTS",
    "WATS_TYPES_ENTITIES_EXPORTS",
    "WATS_TYPES_MESSAGES_EXPORTS",
    "WATS_TYPES_STATUSES_EXPORTS",
    "WATS_TYPES_CONTACTS_EXPORTS",
    "WATS_TYPES_ERRORS_EXPORTS"
  ],
  "@switchbord/types/config": ["WATS_TYPES_CONFIG_EXPORTS"],
  "@switchbord/types/webhook": ["WATS_TYPES_WEBHOOK_EXPORTS"],
  "@switchbord/types/entities": ["WATS_TYPES_ENTITIES_EXPORTS"],
  "@switchbord/types/messages": ["WATS_TYPES_MESSAGES_EXPORTS"],
  "@switchbord/types/statuses": ["WATS_TYPES_STATUSES_EXPORTS"],
  "@switchbord/types/contacts": ["WATS_TYPES_CONTACTS_EXPORTS"],
  "@switchbord/types/errors": ["WATS_TYPES_ERRORS_EXPORTS"]
} as const;

const ENTRYPOINT_MODULES = {
  "@switchbord/types": rootEntrypoint,
  "@switchbord/types/config": configEntrypoint,
  "@switchbord/types/webhook": webhookEntrypoint,
  "@switchbord/types/entities": entitiesEntrypoint,
  "@switchbord/types/messages": messagesEntrypoint,
  "@switchbord/types/statuses": statusesEntrypoint,
  "@switchbord/types/contacts": contactsEntrypoint,
  "@switchbord/types/errors": errorsEntrypoint
} as const;

// Exhaustive switch over the discriminated WhatsAppMessage union. The
// `_exhaustive: never` default branch forces a compile error if any
// variant is dropped from the union, and a runtime throw if an unknown
// discriminator slips through. This is the consumer-side parity of the
// in-tree discriminated-unions test and catches accidental widening of
// the union at the external package boundary.
function describeMessage(message: WhatsAppMessage): string {
  switch (message.type) {
    case "text":
      return `text:${message.text.body}`;
    case "image":
      return `image:${message.image.id}`;
    case "video":
      return `video:${message.video.id}`;
    case "audio":
      return `audio:${message.audio.id}`;
    case "document":
      return `document:${message.document.id}:${message.document.filename}`;
    case "sticker":
      return `sticker:${message.sticker.id}`;
    case "location":
      return `location:${message.location.latitude},${message.location.longitude}`;
    case "contacts":
      return `contacts:${message.contacts.length}`;
    case "reaction":
      return `reaction:${message.reaction.emoji}`;
    case "order":
      return `order:${message.order.catalogId}`;
    case "system":
      return `system:${message.system.body}`;
    case "unsupported":
      return `unsupported:${message.id}`;
    case "interactive":
      return `interactive:${message.interactive.type}`;
    case "button":
      return `button:${message.button.text}`;
    default: {
      const _exhaustive: never = message;
      throw new Error(`unhandled discriminator: ${String(_exhaustive)}`);
    }
  }
}

function describeStatus(status: WhatsAppMessageStatus): string {
  const kind: WhatsAppMessageStatusKind = status.status;
  switch (kind) {
    case "sent":
    case "delivered":
    case "read":
    case "failed":
    case "deleted":
    case "warning":
      return `${status.id}:${kind}`;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`unhandled status kind: ${String(_exhaustive)}`);
    }
  }
}

function describeInteractive(reply: InteractiveReply): string {
  switch (reply.type) {
    case "button_reply":
      return `button_reply:${reply.buttonReply.id}`;
    case "list_reply":
      return `list_reply:${reply.listReply.id}`;
    case "nfm_reply":
      return `nfm_reply:${reply.nfmReply.name ?? ""}`;
    case "product_reply":
      return `product_reply:${reply.productReply.productRetailerId}`;
    case "product_list_reply":
      return `product_list_reply:${reply.productListReply.catalogId}`;
    case "cta_url_reply":
      return `cta_url_reply:${reply.ctaUrlReply.url}`;
    default: {
      const _exhaustive: never = reply;
      throw new Error(`unhandled interactive reply: ${String(_exhaustive)}`);
    }
  }
}

for (const [specifier, requiredSymbols] of Object.entries(REQUIRED_EXPORT_SYMBOLS)) {
  const moduleNamespace = ENTRYPOINT_MODULES[
    specifier as keyof typeof ENTRYPOINT_MODULES
  ];
  const moduleKeys = Object.keys(moduleNamespace);

  for (const symbolName of requiredSymbols) {
    if (!moduleKeys.includes(symbolName)) {
      throw new Error(
        `Missing required runtime export ${symbolName} from ${specifier}. Present exports: ${moduleKeys.join(", ") || "<none>"}`
      );
    }
  }
}

// Construct one representative value per discriminator kind and run
// every exhaustive switch above. Any unhandled kind throws; any
// widened discriminator fails compilation at the never branch.
const sampleMedia: MediaReference = { id: "media-x", mimeType: "image/jpeg" };
const sampleDoc: DocumentReference = {
  id: "doc-x",
  mimeType: "application/pdf",
  filename: "file.pdf"
};
const sampleContext: MessageContext = { messageId: "ctx-1" };
void sampleContext;

const messages: WhatsAppMessage[] = [
  { type: "text", id: "1", from: "1", timestamp: "1", text: { body: "hi" } } satisfies TextMessage,
  { type: "image", id: "2", from: "1", timestamp: "2", image: sampleMedia } satisfies ImageMessage,
  { type: "video", id: "3", from: "1", timestamp: "3", video: sampleMedia } satisfies VideoMessage,
  { type: "audio", id: "4", from: "1", timestamp: "4", audio: sampleMedia } satisfies AudioMessage,
  {
    type: "document",
    id: "5",
    from: "1",
    timestamp: "5",
    document: sampleDoc
  } satisfies DocumentMessage,
  {
    type: "sticker",
    id: "6",
    from: "1",
    timestamp: "6",
    sticker: sampleMedia
  } satisfies StickerMessage,
  {
    type: "location",
    id: "7",
    from: "1",
    timestamp: "7",
    location: { latitude: 0, longitude: 0 }
  } satisfies LocationMessage,
  {
    type: "contacts",
    id: "8",
    from: "1",
    timestamp: "8",
    contacts: []
  } satisfies ContactsMessage,
  {
    type: "reaction",
    id: "9",
    from: "1",
    timestamp: "9",
    reaction: { messageId: "1", emoji: "👍" }
  } satisfies ReactionMessage,
  {
    type: "order",
    id: "10",
    from: "1",
    timestamp: "10",
    order: { catalogId: "cat", productItems: [] }
  } satisfies OrderMessage,
  {
    type: "system",
    id: "11",
    from: "1",
    timestamp: "11",
    system: { body: "system-body" }
  } satisfies SystemMessage,
  {
    type: "unsupported",
    id: "12",
    from: "1",
    timestamp: "12"
  } satisfies UnsupportedMessage,
  {
    type: "interactive",
    id: "13",
    from: "1",
    timestamp: "13",
    interactive: { type: "button_reply", buttonReply: { id: "b", title: "t" } }
  } satisfies InteractiveMessage,
  {
    type: "button",
    id: "14",
    from: "1",
    timestamp: "14",
    button: { text: "ok" }
  } satisfies ButtonMessage
];

const discriminatedUnionMembers = messages.map((m) => m.type);
const describedMessages = messages.map(describeMessage);
if (describedMessages.length !== 14) {
  throw new Error(`expected 14 message variants, got ${describedMessages.length}`);
}

const statusKinds: WhatsAppMessageStatusKind[] = [
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
  "warning"
];
const statuses: WhatsAppMessageStatus[] = statusKinds.map((kind) => ({
  id: `s:${kind}`,
  recipientId: "1",
  status: kind,
  timestamp: "1"
}));

const describedStatuses = statuses.map(describeStatus);
if (describedStatuses.length !== 6) {
  throw new Error(`expected 6 status kinds, got ${describedStatuses.length}`);
}

const interactiveReplies: InteractiveReply[] = [
  { type: "button_reply", buttonReply: { id: "b", title: "t" } },
  { type: "list_reply", listReply: { id: "l", title: "t" } },
  { type: "nfm_reply", nfmReply: { name: "flow" } },
  { type: "product_reply", productReply: { catalogId: "c", productRetailerId: "p" } },
  {
    type: "product_list_reply",
    productListReply: { catalogId: "c", productItems: [{ productRetailerId: "p" }] }
  },
  { type: "cta_url_reply", ctaUrlReply: { displayText: "open", url: "https://example.test" } }
];

const interactiveReplyKinds = interactiveReplies.map((r) => r.type);
const describedInteractive = interactiveReplies.map(describeInteractive);
if (describedInteractive.length !== 6) {
  throw new Error(`expected 6 interactive replies, got ${describedInteractive.length}`);
}

// Sanity: a structural WhatsAppError value is importable.
const sampleError: WhatsAppError = {
  code: 131051,
  title: "unsupported",
  message: "Unsupported message type"
};
if (sampleError.code !== 131051) {
  throw new Error("WhatsAppError contract broken");
}

const report = {
  moduleKeys: Object.fromEntries(
    Object.entries(ENTRYPOINT_MODULES).map(([specifier, moduleNamespace]) => [
      specifier,
      Object.keys(moduleNamespace).sort()
    ])
  ),
  discriminatedUnionMembers,
  statusKinds,
  interactiveReplyKinds
};

console.log(JSON.stringify(report));
