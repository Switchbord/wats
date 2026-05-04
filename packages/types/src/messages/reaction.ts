import type { MessageContext } from "./media";

export interface ReactionPayload {
  messageId: string;
  emoji: string;
}

export interface ReactionMessage {
  type: "reaction";
  id: string;
  from: string;
  timestamp: string;
  reaction: ReactionPayload;
  context?: MessageContext;
  raw?: unknown;
}
