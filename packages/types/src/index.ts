// @wats/types — package barrel.
//
// Keeps B1 entrypoints (./config, ./webhook, ./entities) stable while
// exposing the F-1 discriminated-union modules under their own
// subpaths (./messages, ./statuses, ./contacts, ./errors). Every
// contract-constant array is re-exported at the root so external
// consumers can assert the documented surface without reaching into
// subpath modules.

export * from "./config";
export * from "./webhook";
export * from "./entities";

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
  InteractiveMessage,
  InteractiveReply,
  InteractiveButtonReply,
  InteractiveListReply,
  InteractiveNfmReply,
  InteractiveProductReply,
  InteractiveProductListReply,
  InteractiveCtaUrlReply,
  ButtonMessage,
  ButtonPayload,
  WhatsAppMessageKind,
  MediaReference,
  DocumentReference,
  MessageContext
} from "./messages";

export { WATS_TYPES_MESSAGES_EXPORTS } from "./messages";
export { WATS_TYPES_STATUSES_EXPORTS } from "./statuses";
export { WATS_TYPES_CONTACTS_EXPORTS } from "./contacts";
export { WATS_TYPES_ERRORS_EXPORTS } from "./errors";

// Named access to the full webhook variant union so consumers can
// narrow without reaching into ./webhook directly.
export type {
  WhatsAppMessagesFieldValue,
  WhatsAppTemplateStatusUpdateValue,
  WhatsAppAccountReviewUpdateValue,
  WhatsAppUserMarketingPreferencesValue,
  WhatsAppPhoneNumberChangeValue,
  WhatsAppIdentityChangeValue,
  WhatsAppRawWebhookValue
} from "./webhook";
