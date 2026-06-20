// WATS-65 message-template endpoint family barrel.

export {
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplate,
  listMessageTemplates,
  updateMessageTemplate
} from "./callables.js";

export {
  createTemplateGroup,
  deleteTemplateGroup,
  getTemplateGroup,
  getTemplateGroupAnalytics,
  listTemplateGroups,
  updateTemplateGroup
} from "./groups.js";

export {
  compareTemplates,
  migrateTemplates,
  unpauseTemplate,
  archiveTemplates,
  unarchiveTemplates,
  ARCHIVE_TEMPLATES_MAX_IDS,
  COMPARE_TEMPLATES_MAX_IDS,
  KNOWN_TEMPLATE_TOP_BLOCK_REASONS
} from "./advanced.js";

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

export type {
  CreateTemplateGroupBody,
  DeleteTemplateGroupInput,
  GetTemplateGroupInput,
  ListTemplateGroupsInput,
  TemplateGroupAnalyticsInput,
  TemplateGroupAnalyticsPoint,
  TemplateGroupAnalyticsResponse,
  TemplateGroupBody,
  TemplateGroupDetails,
  TemplateGroupListResponse,
  TemplateGroupMutationResponse,
  UpdateTemplateGroupBody
} from "./groups.js";

export type {
  ArchiveTemplatesInput,
  ArchiveTemplatesResponse,
  CompareTemplatesInput,
  FailedTemplateEntry,
  MigrateTemplatesInput,
  MigrateTemplatesResponse,
  MigratedTemplateEntry,
  TemplateTopBlockReason,
  TemplateUnpauseResult,
  TemplatesCompareResult,
  UnarchiveTemplatesInput,
  UnarchiveTemplatesResponse,
  UnpauseTemplateInput
} from "./advanced.js";
