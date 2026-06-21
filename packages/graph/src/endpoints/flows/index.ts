// WATS-66 WhatsApp Flow endpoint family barrel.

export {
  createFlow,
  deleteFlow,
  deprecateFlow,
  getFlow,
  getFlowAssets,
  listFlows,
  publishFlow,
  updateFlowJson,
  updateFlowMetadata
} from "./callables.js";

export {
  FLOW_JSON_MAX_ARRAY_LENGTH,
  FLOW_JSON_MAX_BYTES,
  FLOW_JSON_MAX_COMPONENTS,
  FLOW_JSON_MAX_DEPTH,
  FLOW_JSON_MAX_SCREENS,
  FLOW_JSON_MAX_STRING_LENGTH,
  FLOW_MAX_CATEGORIES
} from "./shared.js";

export { buildFlowJson, validateFlowJson } from "./flowJson.js";

export {
  FLOW_DSL_MAX_CONTROL_DEPTH,
  calendarPicker,
  checkboxGroup,
  chipsSelector,
  completeAction,
  dataExchangeAction,
  dataSource,
  datePicker,
  documentPicker,
  dropdown,
  embeddedLink,
  flowJson,
  footer,
  form,
  ifComponent,
  image,
  imageCarousel,
  imageCarouselItem,
  navigateAction,
  navigationItem,
  navigationList,
  openUrlAction,
  optIn,
  photoPicker,
  radioButtonsGroup,
  richText,
  screen,
  singleColumnLayout,
  switchComponent,
  textArea,
  textBody,
  textCaption,
  textHeading,
  textInput,
  textSubheading,
  updateDataAction
} from "./flowDsl.js";

export type {
  FlowJsonProps,
  FormProps,
  IfProps,
  ImageCarouselItemProps,
  NavigateActionProps,
  NavigationItemProps,
  ScreenProps,
  SwitchProps
} from "./flowDsl.js";

export {
  buildFlowCloseResponse,
  buildFlowErrorResponse,
  buildFlowScreenResponse
} from "./dataExchange.js";

export {
  FLOW_DATA_CHANNEL_MAX_BYTES,
  FLOW_ENDPOINT_STATUS,
  FlowCryptoUnavailableError,
  FlowRequestDecryptionError,
  FlowSignatureError,
  FlowTokenNoLongerValidError,
  buildFlowErrorAckResponse,
  buildFlowPingResponse,
  decryptRequest,
  encryptResponse,
  flowRequestHasError,
  handleFlowRequest
} from "./dataChannel.js";

export type {
  DecryptedFlowRequest,
  FlowEndpointResult,
  FlowRequestHandler,
  HandleFlowRequestOptions
} from "./dataChannel.js";

// WATS-151 Flow media-upload (PhotoPicker / DocumentPicker) AES-256-CBC +
// HMAC-SHA256 + PKCS#7 decryption runtime.
export {
  FLOW_MEDIA_MAX_BYTES,
  FlowMediaCryptoUnavailableError,
  FlowMediaDecryptionError,
  decryptFlowMedia,
  decryptFlowMediaFile
} from "./flowMediaUpload.js";

export type {
  DecryptedFlowMedia,
  FlowMediaEncryptedFile,
  FlowMediaEncryptionMetadata
} from "./flowMediaUpload.js";

// WATS-154 Flow metrics & migration helpers (slice 1).
export {
  buildFlowMetricField,
  getFlowMetrics,
  migrateFlows
} from "./metricsMigration.js";

// Constants live on the types module (where they are declared) so the
// metrics/migration callables and the barrel can both reference them
// without a re-export chain.
export {
  KNOWN_FLOW_METRIC_NAMES,
  KNOWN_FLOW_METRIC_GRANULARITIES,
  MIGRATE_FLOWS_MAX_NAMES,
  MIGRATE_FLOWS_NAME_MAX_LENGTH
} from "./types.js";

export type { GraphPaging } from "../wabaEndpoints.js";

export type {
  CreateFlowBody,
  EncryptedFlowRequest,
  EncryptedFlowRequestInput,
  EncryptedFlowRequestWire,
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
  FlowMetric,
  FlowMetricDataPoint,
  FlowMetricGranularity,
  FlowMetricName,
  FlowMutationResponse,
  FlowRequest,
  FlowRequestAction,
  FlowResponsePayload,
  FlowScreenResponse,
  FlowScreenResponseInput,
  FlowStatus,
  GetFlowAssetsInput,
  GetFlowInput,
  GetFlowMetricsInput,
  ListFlowsInput,
  MigratedFlow,
  MigratedFlowError,
  MigrateFlowsInput,
  MigrateFlowsResponse,
  UpdateFlowJsonBody,
  UpdateFlowMetadataBody
} from "./types.js";
