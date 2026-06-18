// WATS-53/WATS-65 public message-template endpoint subpath.
//
// Thin compatibility barrel over the WATS-65 template endpoint family modules.

export {
  buildCreateMessageTemplateBody,
  buildUpdateMessageTemplateBody,
  buildTemplateBodyComponent,
  buildTemplateButtonComponent,
  buildTemplateFooterComponent,
  buildTemplateHeaderComponent,
  createMessageTemplate,
  createTemplateGroup,
  compareTemplates,
  deleteMessageTemplate,
  deleteTemplateGroup,
  getMessageTemplate,
  getTemplateGroup,
  getTemplateGroupAnalytics,
  listMessageTemplates,
  listTemplateGroups,
  unpauseTemplate,
  updateMessageTemplate,
  updateTemplateGroup,
  validateTemplateParameterCounts,
  COMPARE_TEMPLATES_MAX_IDS,
  KNOWN_TEMPLATE_TOP_BLOCK_REASONS
} from "./templates/index.js";

export type {
  CreateMessageTemplateBody,
  CreateTemplateGroupBody,
  DeleteMessageTemplateInput,
  DeleteTemplateGroupInput,
  GetMessageTemplateInput,
  GetTemplateGroupInput,
  GraphPaging,
  ListMessageTemplatesInput,
  ListTemplateGroupsInput,
  SendTemplateComponentForValidation,
  TemplateBodyComponentInput,
  TemplateButtonInput,
  TemplateButtonsComponentInput,
  TemplateButtonType,
  TemplateCategory,
  TemplateComponent,
  TemplateDefinitionForValidation,
  TemplateDetails,
  TemplateGroupAnalyticsInput,
  TemplateGroupAnalyticsPoint,
  TemplateGroupAnalyticsResponse,
  TemplateGroupBody,
  TemplateGroupDetails,
  TemplateGroupListResponse,
  TemplateGroupMutationResponse,
  TemplateFooterComponentInput,
  TemplateHeaderComponentInput,
  TemplateHeaderFormat,
  TemplateLanguageCode,
  TemplateListResponse,
  TemplateMutationResponse,
  TemplateParameterFormat,
  TemplateQualityScore,
  TemplateStatus,
  UpdateMessageTemplateBody,
  UpdateTemplateGroupBody
} from "./templates/index.js";

export type {
  CompareTemplatesInput,
  TemplateTopBlockReason,
  TemplateUnpauseResult,
  TemplatesCompareResult,
  UnpauseTemplateInput
} from "./templates/index.js";
