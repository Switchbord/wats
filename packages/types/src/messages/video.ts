import type { MediaReference, MessageContext } from "./media";

export interface VideoMessage {
  type: "video";
  id: string;
  from: string;
  timestamp: string;
  video: MediaReference;
  context?: MessageContext;
  raw?: unknown;
}
