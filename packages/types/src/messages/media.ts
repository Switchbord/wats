// @switchbord/types — messages/media.ts
//
// Shared media reference shapes used by image/video/audio/document/
// sticker messages, plus the MessageContext that may accompany any
// message when it is forwarded or is a reply.

export interface MediaReference {
  id: string;
  mimeType: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}

export interface DocumentReference extends MediaReference {
  filename: string;
}

export interface MessageContext {
  messageId: string;
  from?: string;
  forwarded?: boolean;
  frequentlyForwarded?: boolean;
  /**
   * WATS-43A normalizes the wire `referred_product` object to camelCase
   * when present on inbound message contexts.
   */
  referredProduct?: { catalogId: string; productRetailerId: string };
}
