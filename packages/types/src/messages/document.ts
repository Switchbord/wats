import type { DocumentReference, MessageContext } from "./media.js";

export interface DocumentMessage {
  type: "document";
  id: string;
  from: string;
  timestamp: string;
  document: DocumentReference;
  context?: MessageContext;
  raw?: unknown;
}
