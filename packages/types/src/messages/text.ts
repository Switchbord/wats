import type { MessageContext } from "./media.js";

export interface TextMessage {
  type: "text";
  id: string;
  from: string;
  timestamp: string;
  text: { body: string };
  context?: MessageContext;
  raw?: unknown;
}
