import type { MessageContext } from "./media";

export interface TextMessage {
  type: "text";
  id: string;
  from: string;
  timestamp: string;
  text: { body: string };
  context?: MessageContext;
  raw?: unknown;
}
