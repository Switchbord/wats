import type { TextMessage } from "./text";
import type { ImageMessage } from "./image";
import type { VideoMessage } from "./video";
import type { AudioMessage } from "./audio";
import type { DocumentMessage } from "./document";
import type { StickerMessage } from "./sticker";
import type { LocationMessage } from "./location";
import type { ContactsMessage } from "./contacts";
import type { ReactionMessage } from "./reaction";
import type { OrderMessage } from "./order";
import type { SystemMessage } from "./system";
import type { UnsupportedMessage } from "./unsupported";
import type { InteractiveMessage } from "./interactive";
import type { ButtonMessage } from "./button";

export type WhatsAppMessage =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | DocumentMessage
  | StickerMessage
  | LocationMessage
  | ContactsMessage
  | ReactionMessage
  | OrderMessage
  | SystemMessage
  | UnsupportedMessage
  | InteractiveMessage
  | ButtonMessage;

/**
 * The closed set of `WhatsAppMessage.type` discriminators. Useful for
 * building runtime allow-lists, but the canonical source of truth is
 * the union itself — consumers should narrow via `switch (msg.type)`.
 */
export type WhatsAppMessageKind = WhatsAppMessage["type"];
