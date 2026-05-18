import type { MediaReference, MessageContext } from "./media.js";

export interface ImageMessage {
  type: "image";
  id: string;
  from: string;
  timestamp: string;
  image: MediaReference;
  context?: MessageContext;
  raw?: unknown;
}
