// WATS-68 messages endpoint module split: interactive and status builders.

import { GraphRequestValidationError } from "../../errors.js";
import type {
  GraphMessagesInteractivePayload,
  GraphMessagesMarkMessageAsReadInput,
  GraphMessagesRequestLocationInput,
  GraphMessagesSendButtonsInput,
  GraphMessagesSendCallPermissionRequestInput,
  GraphMessagesSendCatalogInput,
  GraphMessagesSendCtaUrlInput,
  GraphMessagesSendListInput,
  GraphMessagesSendProductInput,
  GraphMessagesSendProductsInput,
  GraphMessagesStatusPayload,
  GraphMessagesTypingIndicatorInput
} from "./types.js";
import {
  GRAPH_MESSAGES_BUTTON_ID_MAX_LENGTH,
  GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH,
  GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH,
  GRAPH_MESSAGES_MAX_LIST_ROWS,
  GRAPH_MESSAGES_MAX_PRODUCT_ITEMS,
  GRAPH_MESSAGES_MAX_REPLY_BUTTONS,
  GRAPH_MESSAGES_MAX_LIST_SECTIONS,
  GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH,
  GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH,
  GRAPH_MESSAGES_ROW_DESCRIPTION_MAX_LENGTH,
  GRAPH_MESSAGES_ROW_TITLE_MAX_LENGTH,
  GRAPH_MESSAGES_SECTION_TITLE_MAX_LENGTH,
  GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH,
  applyRecipientType,
  assertBoundedArray,
  assertMessageRecipient,
  assertNonEmptyControlFreeString,
  assertOnlyKnownKeys,
  assertValidMediaLink,
  asRecordInput,
  rejectGroupRecipient,
  isPlainOptionsObject,
  mapValidatedArray,
  maybeText,
  withReplyContext
} from "./validation.js";

function interactiveBase(
  input: unknown,
  helperName: string,
  interactive: Record<string, unknown>
): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, helperName);
  rejectGroupRecipient(record, helperName, "interactive messages");
  const { to, recipientType } = assertMessageRecipient(record, helperName);
  return withReplyContext(applyRecipientType({ messaging_product: "whatsapp", to, type: "interactive", interactive }, recipientType), record);
}

function addHeaderFooter(target: Record<string, unknown>, record: Record<string, unknown>, helperName: string): void {
  const headerText = maybeText(record.headerText, "headerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, helperName);
  if (headerText !== undefined) target.header = { type: "text", text: headerText };
  if (footerText !== undefined) target.footer = { text: footerText };
}

export function buildSendButtonsPayload(input: GraphMessagesSendButtonsInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendButtons");
  const buttons = mapValidatedArray(assertBoundedArray(record.buttons, "buttons", 1, GRAPH_MESSAGES_MAX_REPLY_BUTTONS, "sendButtons"), (entry) => {
    if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError("Invalid sendButtons input: button entries must be objects.");
    const button = entry as Record<string, unknown>;
    return { type: "reply", reply: { id: assertNonEmptyControlFreeString(button.id, "button.id", GRAPH_MESSAGES_BUTTON_ID_MAX_LENGTH, "sendButtons"), title: assertNonEmptyControlFreeString(button.title, "button.title", GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH, "sendButtons") } };
  });
  const interactive: Record<string, unknown> = { type: "button", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendButtons") }, action: { buttons } };
  addHeaderFooter(interactive, record, "sendButtons");
  return interactiveBase(input, "sendButtons", interactive);
}

export function buildSendListPayload(input: GraphMessagesSendListInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendList");
  let totalRows = 0;
  const sections = mapValidatedArray(assertBoundedArray(record.sections, "sections", 1, GRAPH_MESSAGES_MAX_LIST_SECTIONS, "sendList"), (entry) => {
    if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError("Invalid sendList input: section entries must be objects.");
    const section = entry as Record<string, unknown>;
    const rows = mapValidatedArray(assertBoundedArray(section.rows, "section.rows", 1, GRAPH_MESSAGES_MAX_LIST_ROWS, "sendList"), (rowEntry) => {
      totalRows += 1;
      if (!isPlainOptionsObject(rowEntry)) throw new GraphRequestValidationError("Invalid sendList input: row entries must be objects.");
      const row = rowEntry as Record<string, unknown>;
      const normalized: Record<string, unknown> = { id: assertNonEmptyControlFreeString(row.id, "row.id", GRAPH_MESSAGES_BUTTON_ID_MAX_LENGTH, "sendList"), title: assertNonEmptyControlFreeString(row.title, "row.title", GRAPH_MESSAGES_ROW_TITLE_MAX_LENGTH, "sendList") };
      const desc = maybeText(row.description, "row.description", GRAPH_MESSAGES_ROW_DESCRIPTION_MAX_LENGTH, "sendList");
      if (desc !== undefined) normalized.description = desc;
      return normalized;
    });
    const normalized: Record<string, unknown> = { rows };
    const title = maybeText(section.title, "section.title", GRAPH_MESSAGES_SECTION_TITLE_MAX_LENGTH, "sendList");
    if (title !== undefined) normalized.title = title;
    return normalized;
  });
  if (totalRows > GRAPH_MESSAGES_MAX_LIST_ROWS) throw new GraphRequestValidationError(`Invalid sendList input: total row count exceeds ${GRAPH_MESSAGES_MAX_LIST_ROWS}.`);
  const interactive: Record<string, unknown> = { type: "list", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendList") }, action: { button: assertNonEmptyControlFreeString(record.buttonText, "buttonText", GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH, "sendList"), sections } };
  addHeaderFooter(interactive, record, "sendList");
  return interactiveBase(input, "sendList", interactive);
}

export function buildSendCtaUrlPayload(input: GraphMessagesSendCtaUrlInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendCtaUrl");
  const interactive: Record<string, unknown> = { type: "cta_url", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendCtaUrl") }, action: { name: "cta_url", parameters: { display_text: assertNonEmptyControlFreeString(record.displayText, "displayText", GRAPH_MESSAGES_BUTTON_TITLE_MAX_LENGTH, "sendCtaUrl"), url: assertValidMediaLink(record.url, "sendCtaUrl") } } };
  addHeaderFooter(interactive, record, "sendCtaUrl");
  return interactiveBase(input, "sendCtaUrl", interactive);
}

export function buildSendCallPermissionRequestPayload(input: GraphMessagesSendCallPermissionRequestInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendCallPermissionRequest");
  assertOnlyKnownKeys(record, ["to", "bodyText", "footerText", "replyToMessageId"], "sendCallPermissionRequest");
  const interactive: Record<string, unknown> = {
    type: "call_permission_request",
    body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendCallPermissionRequest") },
    action: { name: "call_permission_request" }
  };
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendCallPermissionRequest");
  if (footerText !== undefined) interactive.footer = { text: footerText };
  return interactiveBase(input, "sendCallPermissionRequest", interactive);
}

export function buildSendProductPayload(input: GraphMessagesSendProductInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendProduct");
  const interactive: Record<string, unknown> = { type: "product", action: { catalog_id: assertNonEmptyControlFreeString(record.catalogId, "catalogId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProduct"), product_retailer_id: assertNonEmptyControlFreeString(record.productRetailerId, "productRetailerId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProduct") } };
  const bodyText = maybeText(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendProduct");
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendProduct");
  if (bodyText !== undefined) interactive.body = { text: bodyText };
  if (footerText !== undefined) interactive.footer = { text: footerText };
  return interactiveBase(input, "sendProduct", interactive);
}

export function buildSendProductsPayload(input: GraphMessagesSendProductsInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendProducts");
  let totalItems = 0;
  const sections = mapValidatedArray(assertBoundedArray(record.sections, "sections", 1, 10, "sendProducts"), (entry) => {
    if (!isPlainOptionsObject(entry)) throw new GraphRequestValidationError("Invalid sendProducts input: section entries must be objects.");
    const section = entry as Record<string, unknown>;
    const productItems = mapValidatedArray(assertBoundedArray(section.productItems, "section.productItems", 1, GRAPH_MESSAGES_MAX_PRODUCT_ITEMS, "sendProducts"), (itemEntry) => {
      totalItems += 1;
      if (!isPlainOptionsObject(itemEntry)) throw new GraphRequestValidationError("Invalid sendProducts input: product item entries must be objects.");
      const item = itemEntry as Record<string, unknown>;
      return { product_retailer_id: assertNonEmptyControlFreeString(item.productRetailerId, "productRetailerId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProducts") };
    });
    return { title: assertNonEmptyControlFreeString(section.title, "section.title", GRAPH_MESSAGES_SECTION_TITLE_MAX_LENGTH, "sendProducts"), product_items: productItems };
  });
  if (totalItems > GRAPH_MESSAGES_MAX_PRODUCT_ITEMS) throw new GraphRequestValidationError(`Invalid sendProducts input: total product item count exceeds ${GRAPH_MESSAGES_MAX_PRODUCT_ITEMS}.`);
  const interactive: Record<string, unknown> = { type: "product_list", header: { type: "text", text: assertNonEmptyControlFreeString(record.headerText, "headerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendProducts") }, body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendProducts") }, action: { catalog_id: assertNonEmptyControlFreeString(record.catalogId, "catalogId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendProducts"), sections } };
  const footerText = maybeText(record.footerText, "footerText", GRAPH_MESSAGES_SHORT_LABEL_MAX_LENGTH, "sendProducts");
  if (footerText !== undefined) interactive.footer = { text: footerText };
  return interactiveBase(input, "sendProducts", interactive);
}

export function buildSendCatalogPayload(input: GraphMessagesSendCatalogInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "sendCatalog");
  const action: Record<string, unknown> = { name: "catalog_message" };
  const thumbnail = maybeText(record.thumbnailProductRetailerId, "thumbnailProductRetailerId", GRAPH_MESSAGES_MEDIA_ID_MAX_LENGTH, "sendCatalog");
  if (thumbnail !== undefined) action.parameters = { thumbnail_product_retailer_id: thumbnail };
  const interactive: Record<string, unknown> = { type: "catalog_message", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "sendCatalog") }, action };
  addHeaderFooter(interactive, record, "sendCatalog");
  return interactiveBase(input, "sendCatalog", interactive);
}

export function buildRequestLocationPayload(input: GraphMessagesRequestLocationInput): GraphMessagesInteractivePayload {
  const record = asRecordInput(input, "requestLocation");
  return interactiveBase(input, "requestLocation", { type: "location_request_message", body: { text: assertNonEmptyControlFreeString(record.bodyText, "bodyText", GRAPH_MESSAGES_GENERAL_TEXT_MAX_LENGTH, "requestLocation") }, action: { name: "send_location" } });
}

export function buildMarkMessageAsReadPayload(input: GraphMessagesMarkMessageAsReadInput): GraphMessagesStatusPayload {
  const record = asRecordInput(input, "markMessageAsRead");
  return { messaging_product: "whatsapp", status: "read", message_id: assertNonEmptyControlFreeString(record.messageId, "messageId", GRAPH_MESSAGES_REPLY_TO_MESSAGE_ID_MAX_LENGTH, "markMessageAsRead") };
}

export function buildTypingIndicatorPayload(input: GraphMessagesTypingIndicatorInput): GraphMessagesStatusPayload {
  const payload = buildMarkMessageAsReadPayload(input);
  return { ...payload, typing_indicator: { type: "text" } };
}
