// @wats/types — package barrel.
//
// Keeps B1 entrypoints (./config, ./webhook, ./entities) stable while
// exposing the F-1 discriminated-union modules under their own
// subpaths (./messages, ./statuses, ./contacts, ./errors). Every
// contract-constant array is re-exported at the root so external
// consumers can assert the documented surface without reaching into
// subpath modules.

export * from "./config.js";
export * from "./webhook.js";
export * from "./entities.js";

// F-1 discriminated unions.
export type {
  TextMessage,
  ImageMessage,
  VideoMessage,
  AudioMessage,
  DocumentMessage,
  StickerMessage,
  LocationMessage,
  LocationPayload,
  ContactsMessage,
  ReactionMessage,
  ReactionPayload,
  OrderMessage,
  OrderPayload,
  OrderProductItem,
  SystemMessage,
  SystemNotification,
  UnsupportedMessage,
  UnsupportedMessageDetail,
  InteractiveMessage,
  InteractiveReply,
  InteractiveButtonReply,
  InteractiveListReply,
  InteractiveNfmReply,
  InteractiveProductReply,
  InteractiveProductListReply,
  InteractiveCtaUrlReply,
  InteractiveCallPermissionReply,
  ButtonMessage,
  ButtonPayload,
  WhatsAppMessageKind,
  MediaReference,
  DocumentReference,
  MessageContext
} from "./messages/index.js";

export { WATS_TYPES_MESSAGES_EXPORTS } from "./messages/index.js";
export { WATS_TYPES_STATUSES_EXPORTS } from "./statuses.js";
export { WATS_TYPES_CONTACTS_EXPORTS } from "./contacts.js";
export { WATS_TYPES_ERRORS_EXPORTS } from "./errors.js";

// Named access to the full webhook variant union so consumers can
// narrow without reaching into ./webhook directly.
export type {
  WhatsAppMessagesFieldValue,
  WhatsAppAccountUpdateValue,
  WhatsAppTemplateStatusUpdateValue,
  WhatsAppAccountReviewUpdateValue,
  WhatsAppUserMarketingPreferencesValue,
  WhatsAppPhoneNumberChangeValue,
  WhatsAppIdentityChangeValue,
  WhatsAppRawWebhookValue
} from "./webhook.js";
