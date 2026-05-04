// WATS-53 public message-template endpoint subpath.
//
// Thin barrel only: re-exports the existing WABA-scoped template runtime
// surface from wabaEndpoints without changing Graph behavior.

export {
  buildCreateMessageTemplateBody,
  buildUpdateMessageTemplateBody,
  buildTemplateBodyComponent,
  buildTemplateButtonComponent,
  buildTemplateFooterComponent,
  buildTemplateHeaderComponent,
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplate,
  listMessageTemplates,
  updateMessageTemplate,
  validateTemplateParameterCounts
} from "./wabaEndpoints";

export type {
  CreateMessageTemplateBody,
  DeleteMessageTemplateInput,
  GetMessageTemplateInput,
  GraphPaging,
  ListMessageTemplatesInput,
  SendTemplateComponentForValidation,
  TemplateBodyComponentInput,
  TemplateButtonInput,
  TemplateButtonsComponentInput,
  TemplateButtonType,
  TemplateCategory,
  TemplateComponent,
  TemplateDefinitionForValidation,
  TemplateDetails,
  TemplateFooterComponentInput,
  TemplateHeaderComponentInput,
  TemplateHeaderFormat,
  TemplateLanguageCode,
  TemplateListResponse,
  TemplateMutationResponse,
  TemplateParameterFormat,
  TemplateQualityScore,
  TemplateStatus,
  UpdateMessageTemplateBody
} from "./wabaEndpoints";
