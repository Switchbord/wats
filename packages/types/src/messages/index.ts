// @wats/types/messages — barrel.
//
// Re-exports every discriminated-union member plus the WhatsAppMessage
// union itself and the supporting MediaReference / MessageContext
// shapes. Keep in step with the contract constant
// `WATS_TYPES_MESSAGES_EXPORTS`.

export type { TextMessage } from "./text";
export type { ImageMessage } from "./image";
export type { VideoMessage } from "./video";
export type { AudioMessage } from "./audio";
export type { DocumentMessage } from "./document";
export type { StickerMessage } from "./sticker";
export type { LocationMessage, LocationPayload } from "./location";
export type { ContactsMessage } from "./contacts";
export type { ReactionMessage, ReactionPayload } from "./reaction";
export type {
  OrderMessage,
  OrderPayload,
  OrderProductItem
} from "./order";
export type { SystemMessage, SystemNotification } from "./system";
export type { UnsupportedMessage } from "./unsupported";
export type {
  InteractiveMessage,
  InteractiveReply,
  InteractiveButtonReply,
  InteractiveListReply,
  InteractiveNfmReply,
  InteractiveProductReply,
  InteractiveProductListReply,
  InteractiveCtaUrlReply
} from "./interactive";
export type { ButtonMessage, ButtonPayload } from "./button";
export type { WhatsAppMessage, WhatsAppMessageKind } from "./union";
export type { MediaReference, DocumentReference, MessageContext } from "./media";

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
