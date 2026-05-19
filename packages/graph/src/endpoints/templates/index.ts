// WATS-65 message-template endpoint family barrel.

export {
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplate,
  listMessageTemplates,
  updateMessageTemplate
} from "./callables.js";

export {
  buildCreateMessageTemplateBody,
  buildUpdateMessageTemplateBody,
  buildTemplateBodyComponent,
  buildTemplateButtonComponent,
  buildTemplateFooterComponent,
  buildTemplateHeaderComponent
} from "./builders.js";

export { validateTemplateParameterCounts } from "./validation.js";

export type { GraphPaging } from "../wabaEndpoints.js";

export type {
  CreateMessageTemplateBody,
  DeleteMessageTemplateInput,
  GetMessageTemplateInput,
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
  TemplateOtpType,
  TemplateParameterFormat,
  TemplateQualityScore,
  TemplateStatus,
  TemplateSupportedAppInput,
  UpdateMessageTemplateBody
} from "./types.js";
