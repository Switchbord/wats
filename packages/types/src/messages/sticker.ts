import type { MediaReference, MessageContext } from "./media";

export interface StickerMessage {
  type: "sticker";
  id: string;
  from: string;
  timestamp: string;
  sticker: MediaReference;
  context?: MessageContext;
  raw?: unknown;
}
