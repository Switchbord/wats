// F-7/WATS-39 WABA-scope endpoints.
//
// WATS-39 adds credential-free WhatsApp Business Account message-template
// management parity. All operations are ordinary Graph endpoint callables
// layered on defineEndpoint and MockTransport-testable without live WABA
// credentials.

import { defineEndpoint } from "../endpoint";
import { GraphRequestValidationError } from "../errors";
import type { EndpointInvokeOptions } from "../endpoint";
import {
  normalizeListPhoneNumbersParams,
  sanitizeBusinessManagementOptions,
  type ListPhoneNumbersInput
} from "./businessManagement";

export interface PhoneNumberListEntry {
  readonly id: string;
  readonly display_phone_number?: string;
  readonly verified_name?: string;
  readonly quality_rating?: string;
}

export interface PhoneNumberListResponse {
  readonly data?: readonly PhoneNumberListEntry[];
  readonly paging?: GraphPaging;
}

export interface GraphPaging {
  readonly cursors?: {
    readonly before?: string;
    readonly after?: string;
  };
  readonly next?: string;
  readonly previous?: string;
}

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
} from "./templates/index";

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
} from "./templates/index";


const listPhoneNumbersRaw = defineEndpoint<
  { wabaId: string; fields?: string; limit?: string; after?: string; before?: string },
  never,
  PhoneNumberListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/phone_numbers",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" },
    before: { in: "query" }
  }
});

export const listPhoneNumbers = Object.assign(
  async function listPhoneNumbers(
    client: Parameters<typeof listPhoneNumbersRaw>[0],
    params: ListPhoneNumbersInput,
    body?: never,
    opts?: EndpointInvokeOptions
  ) {
    if (body !== undefined) {
      throw new GraphRequestValidationError("Invalid listPhoneNumbers input: GET endpoints do not accept a body.");
    }
    return listPhoneNumbersRaw(
      client,
      normalizeListPhoneNumbersParams(params) as Parameters<typeof listPhoneNumbersRaw>[1],
      undefined,
      sanitizeBusinessManagementOptions(opts, "listPhoneNumbers")
    );
  },
  { definition: listPhoneNumbersRaw.definition }
) as unknown as {
  (client: Parameters<typeof listPhoneNumbersRaw>[0], params: ListPhoneNumbersInput, body?: never, opts?: EndpointInvokeOptions): Promise<PhoneNumberListResponse>;
  readonly definition: typeof listPhoneNumbersRaw.definition;
};

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
} from "./flows/index";

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
} from "./flows/index";
