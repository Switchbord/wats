// WATS-53/WATS-66 public WhatsApp Flow endpoint subpath.
//
// Thin compatibility barrel over the WATS-66 Flow endpoint family modules.
/**
 * @experimental Flow DSL and data-channel helpers may change in 0.x minors while WATS expands Flow parity.
 */

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
  GraphPaging,
  ListFlowsInput,
  UpdateFlowJsonBody,
  UpdateFlowMetadataBody
} from "./flows/index.js";
