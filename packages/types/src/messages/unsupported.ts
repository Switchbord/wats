import type { WhatsAppError } from "../errors.js";

export interface UnsupportedMessage {
  type: "unsupported";
  id: string;
  from: string;
  timestamp: string;
  errors?: WhatsAppError[];
  raw?: unknown;
}
