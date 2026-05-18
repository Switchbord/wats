// F-7/WATS-39 WABA-scope endpoints.
//
// WATS-39 adds credential-free WhatsApp Business Account message-template
// management parity. All operations are ordinary Graph endpoint callables
// layered on defineEndpoint and MockTransport-testable without live WABA
// credentials.

export { listPhoneNumbers } from "./waba/index.js";

export type {
  GraphPaging,
  PhoneNumberListEntry,
  PhoneNumberListResponse
} from "./waba/index.js";

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
} from "./templates/index.js";

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
} from "./templates/index.js";


// ---------------------------------------------------------------------------
// WATS-40 WhatsApp Flows endpoint parity.
// ---------------------------------------------------------------------------

export {
  FLOW_JSON_MAX_ARRAY_LENGTH,
  FLOW_JSON_MAX_BYTES,
  FLOW_JSON_MAX_COMPONENTS,
  FLOW_JSON_MAX_DEPTH,
  FLOW_JSON_MAX_SCREENS,
  FLOW_JSON_MAX_STRING_LENGTH,
  FLOW_MAX_CATEGORIES,
  buildFlowCloseResponse,
  buildFlowErrorResponse,
  buildFlowJson,
  buildFlowScreenResponse,
  createFlow,
  deleteFlow,
  deprecateFlow,
  getFlow,
  getFlowAssets,
  listFlows,
  publishFlow,
  updateFlowJson,
  updateFlowMetadata,
  validateFlowJson
} from "./flows/index.js";

export type {
  CreateFlowBody,
  FlowAssetDetails,
  FlowAssetsResponse,
  FlowCategory,
  FlowCloseResponse,
  FlowCloseResponseInput,
  FlowDetails,
  FlowErrorResponse,
  FlowErrorResponseInput,
  FlowJson,
  FlowListResponse,
  FlowMutationResponse,
  FlowScreenResponse,
  FlowScreenResponseInput,
  FlowStatus,
  GetFlowAssetsInput,
  GetFlowInput,
  ListFlowsInput,
  UpdateFlowJsonBody,
  UpdateFlowMetadataBody
} from "./flows/index.js";
