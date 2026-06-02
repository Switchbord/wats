// WATS-68 messages endpoint module split.
//
// Public compatibility remains `@wats/graph/endpoints/messages` and root
// `@wats/graph`; this focused module directory keeps the broad message
// composer implementation maintainable without payload behavior changes.

export * from "./types.js";
export {
  GRAPH_MESSAGES_TEXT_BODY_MAX_LENGTH,
  GRAPH_MESSAGES_RECIPIENT_MAX_DIGITS,
  GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH,
  GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH,
  GRAPH_MESSAGES_MEDIA_LINK_MAX_LENGTH,
  GRAPH_MESSAGES_MEDIA_CAPTION_MAX_LENGTH,
  GRAPH_MESSAGES_DOCUMENT_FILENAME_MAX_LENGTH,
  GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH,
  GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH,
  GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH,
  GRAPH_MESSAGES_BUTTON_ID_MAX_LENGTH,
  GRAPH_MESSAGES_SECTION_TITLE_MAX_LENGTH,
  GRAPH_MESSAGES_ROW_TITLE_MAX_LENGTH,
  GRAPH_MESSAGES_ROW_DESCRIPTION_MAX_LENGTH,
  GRAPH_MESSAGES_MAX_REPLY_BUTTONS,
  GRAPH_MESSAGES_MAX_LIST_SECTIONS,
  GRAPH_MESSAGES_MAX_LIST_ROWS,
  GRAPH_MESSAGES_MAX_CONTACTS,
  GRAPH_MESSAGES_MAX_PRODUCT_ITEMS
} from "./validation.js";
export {
  buildSendTextPayload,
  buildSendImagePayload,
  buildSendVideoPayload,
  buildSendAudioPayload,
  buildSendDocumentPayload,
  buildSendStickerPayload,
  buildSendLocationPayload,
  buildSendContactsPayload,
  buildSendReactionPayload,
  buildRemoveReactionPayload,
  buildSendPinPayload
} from "./builders-basic.js";
export {
  buildSendButtonsPayload,
  buildSendListPayload,
  buildSendCtaUrlPayload,
  buildSendCallPermissionRequestPayload,
  buildSendProductPayload,
  buildSendProductsPayload,
  buildSendCatalogPayload,
  buildRequestLocationPayload,
  buildMarkMessageAsReadPayload,
  buildTypingIndicatorPayload
} from "./builders-interactive.js";
export {
  buildSendTemplatePayload,
  buildSendMarketingTemplatePayload
} from "./builders-template.js";
export {
  buildSendMessagePayload,
  sendMarketingTemplate,
  sendMessage,
  GraphMessagesEndpoint
} from "./callables.js";
