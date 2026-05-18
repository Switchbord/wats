import type { TextMessage } from "./text.js";
import type { ImageMessage } from "./image.js";
import type { VideoMessage } from "./video.js";
import type { AudioMessage } from "./audio.js";
import type { DocumentMessage } from "./document.js";
import type { StickerMessage } from "./sticker.js";
import type { LocationMessage } from "./location.js";
import type { ContactsMessage } from "./contacts.js";
import type { ReactionMessage } from "./reaction.js";
import type { OrderMessage } from "./order.js";
import type { SystemMessage } from "./system.js";
import type { UnsupportedMessage } from "./unsupported.js";
import type { InteractiveMessage } from "./interactive.js";
import type { ButtonMessage } from "./button.js";

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
