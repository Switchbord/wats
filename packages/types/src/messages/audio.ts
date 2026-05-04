import type { MediaReference, MessageContext } from "./media";

export interface AudioMessage {
  type: "audio";
  id: string;
  from: string;
  timestamp: string;
  audio: MediaReference;
  context?: MessageContext;
  raw?: unknown;
}
