import type { MediaReference, MessageContext } from "./media.js";

export interface AudioMessage {
  type: "audio";
  id: string;
  from: string;
  timestamp: string;
  audio: MediaReference;
  context?: MessageContext;
  raw?: unknown;
}
