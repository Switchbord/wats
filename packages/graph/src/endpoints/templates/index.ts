// WATS-65 message-template endpoint family barrel.

export {
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplate,
  listMessageTemplates,
  updateMessageTemplate
} from "./callables";

export {
  buildCreateMessageTemplateBody,
  buildUpdateMessageTemplateBody,
  buildTemplateBodyComponent,
  buildTemplateButtonComponent,
  buildTemplateFooterComponent,
  buildTemplateHeaderComponent
} from "./builders";

export { validateTemplateParameterCounts } from "./validation";

export type { GraphPaging } from "../wabaEndpoints";

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
  TemplateParameterFormat,
  TemplateQualityScore,
  TemplateStatus,
  UpdateMessageTemplateBody
} from "./types";
