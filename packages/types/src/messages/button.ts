import type { MessageContext } from "./media.js";

export interface ButtonPayload {
  text: string;
  payload?: string;
}

export interface ButtonMessage {
  type: "button";
  id: string;
  from: string;
  timestamp: string;
  button: ButtonPayload;
  context?: MessageContext;
  raw?: unknown;
}
