import type { WhatsAppError } from "../errors.js";

export interface UnsupportedMessageDetail {
  type?: string;
  title?: string;
  description?: string;
  raw?: unknown;
}

export interface UnsupportedMessage {
  type: "unsupported";
  id: string;
  from: string;
  timestamp: string;
  unsupported?: UnsupportedMessageDetail;
  errors?: WhatsAppError[];
  raw?: unknown;
}
