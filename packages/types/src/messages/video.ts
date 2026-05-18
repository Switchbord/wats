import type { MediaReference, MessageContext } from "./media.js";

export interface VideoMessage {
  type: "video";
  id: string;
  from: string;
  timestamp: string;
  video: MediaReference;
  context?: MessageContext;
  raw?: unknown;
}
