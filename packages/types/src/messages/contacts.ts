import type { WhatsAppContact } from "../contacts";
import type { MessageContext } from "./media";

export interface ContactsMessage {
  type: "contacts";
  id: string;
  from: string;
  timestamp: string;
  contacts: WhatsAppContact[];
  context?: MessageContext;
  raw?: unknown;
}
