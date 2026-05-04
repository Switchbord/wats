import type { WhatsAppError } from "../errors";

export interface UnsupportedMessage {
  type: "unsupported";
  id: string;
  from: string;
  timestamp: string;
  errors?: WhatsAppError[];
  raw?: unknown;
}
