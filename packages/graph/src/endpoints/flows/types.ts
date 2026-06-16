// WATS-66 WhatsApp Flow endpoint family types.

import type { GraphPaging } from "../wabaEndpoints.js";

export type FlowStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "DEPRECATED"
  | "BLOCKED"
  | "THROTTLED"
  | string;

export type FlowCategory =
  | "SIGN_UP"
  | "SIGN_IN"
  | "APPOINTMENT_BOOKING"
  | "LEAD_GENERATION"
  | "CONTACT_US"
  | "CUSTOMER_SUPPORT"
  | "SURVEY"
  | "OTHER"
  | string;

export interface FlowDetails {
  readonly id?: string;
  readonly name?: string;
  readonly status?: FlowStatus;
  readonly categories?: readonly FlowCategory[];
  readonly endpoint_uri?: string;
  readonly validation_errors?: readonly unknown[];
  readonly preview?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface FlowListResponse {
  readonly data?: readonly FlowDetails[];
  readonly paging?: GraphPaging;
}

export interface FlowMutationResponse {
  readonly id?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface FlowAssetDetails {
  readonly name?: string;
  readonly asset_type?: string;
  readonly download_url?: string;
  readonly [key: string]: unknown;
}

export interface FlowAssetsResponse {
  readonly data?: readonly FlowAssetDetails[];
  readonly paging?: GraphPaging;
}

export type FlowJson = Record<string, unknown>;

export interface ListFlowsInput {
  readonly wabaId: string;
  readonly fields?: string;
  readonly status?: FlowStatus;
  readonly name?: string;
  readonly invalidatePreview?: string;
  readonly phoneNumberId?: string;
  readonly limit?: string;
  readonly after?: string;
}

export interface GetFlowInput {
  readonly flowId: string;
  readonly fields?: string;
  readonly invalidatePreview?: string;
  readonly phoneNumberId?: string;
}

export interface CreateFlowBody {
  readonly name: string;
  readonly categories: readonly FlowCategory[];
  readonly cloneFlowId?: string;
  readonly endpointUri?: string;
  readonly flowJson?: FlowJson | Record<string, unknown>;
  readonly publish?: boolean;
  readonly [key: string]: unknown;
}

export interface UpdateFlowMetadataBody {
  readonly name?: string;
  readonly categories?: readonly FlowCategory[];
  readonly endpointUri?: string;
  readonly applicationId?: string;
  readonly [key: string]: unknown;
}

export interface UpdateFlowJsonBody {
  readonly flowJson: FlowJson | Record<string, unknown>;
  /** Defaults to Meta's stable Flow JSON asset name, `flow.json`. */
  readonly name?: string;
}

export interface GetFlowAssetsInput {
  readonly flowId: string;
  readonly fields?: string;
  readonly limit?: string;
  readonly after?: string;
}

export interface FlowScreenResponseInput {
  readonly screen: string;
  readonly data?: unknown;
  readonly flowToken?: string;
}

export interface FlowCloseResponseInput {
  readonly data?: unknown;
  readonly flowToken?: string;
}

export interface FlowErrorResponseInput {
  readonly error: string;
  readonly errorMessage?: string;
  readonly flowToken?: string;
}

export interface FlowScreenResponse {
  readonly screen: string;
  readonly data?: unknown;
  readonly flow_token?: string;
}

export interface FlowCloseResponse {
  readonly close_flow: true;
  readonly data?: unknown;
  readonly flow_token?: string;
}

export interface FlowErrorResponse {
  readonly error: string;
  readonly error_message?: string;
  readonly flow_token?: string;
}

// ── WATS-76 slice B: encrypted data-channel runtime types ───────────────────

/**
 * Decrypted Flow request action verbs. Meta sends INIT/BACK uppercase and
 * data_exchange/navigate/ping lowercase (see REFERENCE-76 §B.4).
 */
export type FlowRequestAction =
  | "INIT"
  | "BACK"
  | "data_exchange"
  | "navigate"
  | "ping";

/**
 * The encrypted request envelope as it arrives from Meta. The wire payload
 * uses snake_case keys (`encrypted_flow_data` / `encrypted_aes_key` /
 * `initial_vector`); we also accept the camelCase form so callers that have
 * already normalised the body can pass it straight through. All three values
 * are base64-encoded strings.
 */
export interface EncryptedFlowRequest {
  readonly encryptedFlowData: string;
  readonly encryptedAesKey: string;
  readonly initialVector: string;
}

export interface EncryptedFlowRequestWire {
  readonly encrypted_flow_data: string;
  readonly encrypted_aes_key: string;
  readonly initial_vector: string;
}

export type EncryptedFlowRequestInput =
  | EncryptedFlowRequest
  | EncryptedFlowRequestWire;

/**
 * A decrypted Flow data-channel request, normalised to camelCase. `screen`
 * is omitted when Meta sends `""`; `data` is omitted when Meta sends `{}`.
 */
export interface FlowRequest {
  readonly version: string;
  readonly action: FlowRequestAction;
  readonly flowToken?: string;
  readonly screen?: string;
  readonly data?: Record<string, unknown>;
}

/**
 * The plaintext object that gets encrypted into the HTTP response body. This
 * is the JSON-serialisable shape produced by the response builders in
 * dataExchange.ts (screen / close / error) plus the ping and error-ack
 * wrappers. Kept loose because the runtime only stringifies it.
 */
export type FlowResponsePayload = Record<string, unknown>;
