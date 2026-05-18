import type { WhatsAppContact } from "../contacts.js";
import type { MessageContext } from "./media.js";

export interface ContactsMessage {
  type: "contacts";
  id: string;
  from: string;
  timestamp: string;
  contacts: WhatsAppContact[];
  context?: MessageContext;
  raw?: unknown;
}
