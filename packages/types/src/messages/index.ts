// @wats/types/messages — barrel.
//
// Re-exports every discriminated-union member plus the WhatsAppMessage
// union itself and the supporting MediaReference / MessageContext
// shapes. Keep in step with the contract constant
// `WATS_TYPES_MESSAGES_EXPORTS`.

export type { TextMessage } from "./text.js";
export type { ImageMessage } from "./image.js";
export type { VideoMessage } from "./video.js";
export type { AudioMessage } from "./audio.js";
export type { DocumentMessage } from "./document.js";
export type { StickerMessage } from "./sticker.js";
export type { LocationMessage, LocationPayload } from "./location.js";
export type { ContactsMessage } from "./contacts.js";
export type { ReactionMessage, ReactionPayload } from "./reaction.js";
export type {
  OrderMessage,
  OrderPayload,
  OrderProductItem
} from "./order.js";
export type { SystemMessage, SystemNotification } from "./system.js";
export type { UnsupportedMessage } from "./unsupported.js";
export type {
  InteractiveMessage,
  InteractiveReply,
  InteractiveButtonReply,
  InteractiveListReply,
  InteractiveNfmReply,
  InteractiveProductReply,
  InteractiveProductListReply,
  InteractiveCtaUrlReply
} from "./interactive.js";
export type { ButtonMessage, ButtonPayload } from "./button.js";
export type { WhatsAppMessage, WhatsAppMessageKind } from "./union.js";
export type { MediaReference, DocumentReference, MessageContext } from "./media.js";

export const WATS_TYPES_MESSAGES_EXPORTS = [
  "TextMessage",
  "ImageMessage",
  "VideoMessage",
  "AudioMessage",
  "DocumentMessage",
  "StickerMessage",
  "LocationMessage",
  "ContactsMessage",
  "ReactionMessage",
  "OrderMessage",
  "SystemMessage",
  "UnsupportedMessage",
  "InteractiveMessage",
  "ButtonMessage",
  "WhatsAppMessage",
  "InteractiveReply",
  "MediaReference",
  "DocumentReference",
  "MessageContext"
] as const;
