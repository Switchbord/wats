// WATS-68 messages endpoint module split: public types for the messages family.

export interface GraphMessagesSendMessageInput {
  phoneNumberId: string;
  to: string;
  text: string;
  previewUrl?: boolean;
}

export type GraphMessagesRecipientType = "individual" | "group";

export interface GraphMessagesRecipientInput {
  readonly to: string;
  readonly recipientType?: GraphMessagesRecipientType;
}

export interface GraphMessagesSendTextInput extends GraphMessagesRecipientInput {
  readonly text: string;
  readonly previewUrl?: boolean;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendMediaInput extends GraphMessagesRecipientInput {
  readonly mediaId?: string;
  readonly link?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCaptionedMediaInput extends GraphMessagesSendMediaInput {
  readonly caption?: string;
}

export interface GraphMessagesSendDocumentInput extends GraphMessagesSendCaptionedMediaInput {
  readonly filename?: string;
}

export type GraphMessagesSendImageInput = GraphMessagesSendCaptionedMediaInput;
export type GraphMessagesSendVideoInput = GraphMessagesSendCaptionedMediaInput;
export interface GraphMessagesSendAudioInput extends GraphMessagesSendMediaInput {
  /** Graph v24+ voice-message designation for audio sends. Defaults to omitted/false. */
  readonly voice?: boolean;
}
export type GraphMessagesSendStickerInput = GraphMessagesSendMediaInput;

export interface GraphMessagesSendLocationInput extends GraphMessagesRecipientInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly name?: string;
  readonly address?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesContactNameInput {
  readonly formattedName?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly middleName?: string;
  readonly suffix?: string;
  readonly prefix?: string;
}

export interface GraphMessagesContactPhoneInput {
  readonly phone?: string;
  readonly type?: string;
  readonly waId?: string;
}

export interface GraphMessagesContactEmailInput {
  readonly email: string;
  readonly type?: string;
}

export interface GraphMessagesContactUrlInput {
  readonly url: string;
  readonly type?: string;
}

export interface GraphMessagesContactAddressInput {
  readonly street?: string;
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
  readonly country?: string;
  readonly countryCode?: string;
  readonly type?: string;
}

export interface GraphMessagesContactOrgInput {
  readonly company?: string;
  readonly department?: string;
  readonly title?: string;
}

export interface GraphMessagesContactInput {
  readonly name: GraphMessagesContactNameInput;
  readonly phones?: readonly GraphMessagesContactPhoneInput[];
  readonly emails?: readonly GraphMessagesContactEmailInput[];
  readonly urls?: readonly GraphMessagesContactUrlInput[];
  readonly addresses?: readonly GraphMessagesContactAddressInput[];
  readonly org?: GraphMessagesContactOrgInput;
  readonly birthday?: string;
}

export interface GraphMessagesSendContactsInput extends GraphMessagesRecipientInput {
  readonly contacts: readonly GraphMessagesContactInput[];
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendReactionInput extends GraphMessagesRecipientInput {
  readonly messageId: string;
  readonly emoji: string;
}

export interface GraphMessagesRemoveReactionInput extends GraphMessagesRecipientInput {
  readonly messageId: string;
}

export interface GraphMessagesSendButtonsInput extends GraphMessagesRecipientInput {
  readonly bodyText: string;
  readonly buttons: readonly { readonly id: string; readonly title: string }[];
  readonly headerText?: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendListInput extends GraphMessagesRecipientInput {
  readonly bodyText: string;
  readonly buttonText: string;
  readonly sections: readonly {
    readonly title?: string;
    readonly rows: readonly { readonly id: string; readonly title: string; readonly description?: string }[];
  }[];
  readonly headerText?: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCtaUrlInput extends GraphMessagesRecipientInput {
  readonly bodyText: string;
  readonly displayText: string;
  readonly url: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCallPermissionRequestInput extends GraphMessagesRecipientInput {
  readonly bodyText: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendProductInput extends GraphMessagesRecipientInput {
  readonly catalogId: string;
  readonly productRetailerId: string;
  readonly bodyText?: string;
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendProductsInput extends GraphMessagesRecipientInput {
  readonly catalogId: string;
  readonly headerText: string;
  readonly bodyText: string;
  readonly sections: readonly {
    readonly title: string;
    readonly productItems: readonly { readonly productRetailerId: string }[];
  }[];
  readonly footerText?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesSendCatalogInput extends GraphMessagesRecipientInput {
  readonly bodyText: string;
  readonly footerText?: string;
  readonly thumbnailProductRetailerId?: string;
  readonly replyToMessageId?: string;
}

export interface GraphMessagesRequestLocationInput extends GraphMessagesRecipientInput {
  readonly bodyText: string;
  readonly replyToMessageId?: string;
}


export interface GraphMessagesSendPinInput extends GraphMessagesRecipientInput {
  readonly pinType: "pin" | "unpin";
  readonly messageId: string;
  readonly expirationDays: number;
}

export interface GraphMessagesMarkMessageAsReadInput {
  readonly messageId: string;
}

export type GraphMessagesTypingIndicatorInput = GraphMessagesMarkMessageAsReadInput;

export interface GraphMessagesTemplateComponentInput {
  readonly type: string;
  readonly parameters?: readonly Record<string, unknown>[];
  readonly subType?: string;
  readonly index?: string;
}

export interface GraphMessagesSendTemplateInput extends GraphMessagesRecipientInput {
  readonly name: string;
  readonly languageCode: string;
  readonly components?: readonly GraphMessagesTemplateComponentInput[];
  readonly replyToMessageId?: string;
}

export type GraphMessagesMarketingProductPolicy = "CLOUD_API_FALLBACK" | "STRICT";
export type GraphMessagesMarketingMessageStatus = "accepted" | "held_for_quality_assessment" | "paused" | string;

export interface GraphMessagesSendMarketingTemplateInput {
  readonly to?: string;
  readonly recipientType?: GraphMessagesRecipientType;
  readonly recipient?: string;
  readonly name: string;
  readonly languageCode: string;
  readonly components?: readonly GraphMessagesTemplateComponentInput[];
  readonly productPolicy?: GraphMessagesMarketingProductPolicy;
  readonly messageActivitySharing?: boolean;
}

export interface GraphMessagesSendResponse {
  messaging_product?: string;
  contacts?: Array<{
    input?: string;
    wa_id?: string;
  }>;
  messages?: Array<{
    id: string;
  }>;
}

export interface GraphMessagesMarketingTemplateResponse {
  messaging_product?: string;
  contacts?: Array<{
    input?: string;
    wa_id?: string;
    /** WATS-98 BSUID response field returned for Business-Scoped User ID sends. */
    user_id?: string;
  }>;
  messages?: Array<{
    id: string;
    /** WATS-98 /marketing_messages status: accepted, held_for_quality_assessment, or paused. */
    message_status?: GraphMessagesMarketingMessageStatus;
  }>;
}

export interface GraphMessagesMarketingTemplatePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to?: string;
  recipient?: string;
  type: "template";
  template: Record<string, unknown>;
  product_policy?: GraphMessagesMarketingProductPolicy;
  message_activity_sharing?: boolean;
}

export interface GraphMessagesTextPayload {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "text";
  text: {
    body: string;
    preview_url?: boolean;
  };
  context?: {
    message_id: string;
  };
}

export type GraphMessagesMediaType = "image" | "video" | "audio" | "document" | "sticker";

interface GraphMessagesMediaReferencePayload {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

interface GraphMessagesAudioReferencePayload extends GraphMessagesMediaReferencePayload {
  voice?: boolean;
}

export type GraphMessagesImagePayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "image";
  image: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesVideoPayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "video";
  video: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesAudioPayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "audio";
  audio: GraphMessagesAudioReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesDocumentPayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "document";
  document: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesStickerPayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "sticker";
  sticker: GraphMessagesMediaReferencePayload;
  context?: { message_id: string };
};

export type GraphMessagesMediaPayload =
  | GraphMessagesImagePayload
  | GraphMessagesVideoPayload
  | GraphMessagesAudioPayload
  | GraphMessagesDocumentPayload
  | GraphMessagesStickerPayload;

export type GraphMessagesLocationPayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "location";
  location: { latitude: number; longitude: number; name?: string; address?: string };
  context?: { message_id: string };
};

export type GraphMessagesContactsPayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "contacts";
  contacts: readonly Record<string, unknown>[];
  context?: { message_id: string };
};

export type GraphMessagesReactionPayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "reaction";
  reaction: { message_id: string; emoji: string };
};

export type GraphMessagesInteractivePayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "interactive";
  interactive: Record<string, unknown>;
  context?: { message_id: string };
};

export type GraphMessagesTemplatePayload = {
  messaging_product: "whatsapp";
  recipient_type?: GraphMessagesRecipientType;
  to: string;
  type: "template";
  template: Record<string, unknown>;
  context?: { message_id: string };
};

export type GraphMessagesStatusPayload = {
  messaging_product: "whatsapp";
  status: "read";
  message_id: string;
  typing_indicator?: { type: "text" };
};

export type GraphMessagesPinPayload = {
  messaging_product: "whatsapp";
  recipient_type: "group";
  to: string;
  type: "pin";
  pin: { type: "pin" | "unpin"; message_id: string; expiration_days: number };
};

export type GraphMessagesRemainingPayload =
  | GraphMessagesLocationPayload
  | GraphMessagesContactsPayload
  | GraphMessagesReactionPayload
  | GraphMessagesInteractivePayload
  | GraphMessagesTemplatePayload
  | GraphMessagesStatusPayload
  | GraphMessagesPinPayload;

// Structural body shape accepted by the endpoint-registry callable. The
// class-based adapter builds this internally via buildSendMessagePayload.
export type GraphMessagesSendBody = GraphMessagesTextPayload | GraphMessagesMediaPayload | GraphMessagesRemainingPayload;
