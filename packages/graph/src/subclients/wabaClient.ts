// F-7 WABAClient (WATS-19 / Arch-E).
//
// Scoped sub-client that binds a WhatsApp Business Account id (`wabaId`)
// at CONSTRUCTION and exposes endpoint callables as methods. Constructor
// validation mirrors PhoneNumberClient: duck-typed graphClient check,
// non-empty string wabaId, reused F-6 `assertSafePathParamValue` for the
// id taxonomy (no slashes / dot-segments / control chars).
//
// Method catalog: F-7 introduced `listPhoneNumbers`; WATS-39 adds
// credential-free message-template management helpers over the WABA scope;
// WATS-42A adds read-only business/admin inventory helpers.

import type { GraphClient } from "../client";
import type { EndpointInvokeOptions } from "../endpoint";
import { assertSafePathParamValue } from "../endpoint";
import { GraphRequestValidationError } from "../errors";
import { copyOptionalParamsObject, splitRequiredStringDataProp } from "../internal/validation/options";
import {
  getWabaInfo as getWabaInfoEndpoint,
  listSubscribedApps as listSubscribedAppsEndpoint,
  type GetWabaInfoInput,
  type ListPhoneNumbersInput,
  type SubscribedAppsResponse,
  type WabaInfo
} from "../endpoints/businessManagement";
import {
  createMessageTemplate as createMessageTemplateEndpoint,
  deleteMessageTemplate as deleteMessageTemplateEndpoint,
  getMessageTemplate as getMessageTemplateEndpoint,
  listMessageTemplates as listMessageTemplatesEndpoint,
  listPhoneNumbers as listPhoneNumbersEndpoint,
  updateMessageTemplate as updateMessageTemplateEndpoint,
  listFlows as listFlowsEndpoint,
  getFlow as getFlowEndpoint,
  createFlow as createFlowEndpoint,
  updateFlowMetadata as updateFlowMetadataEndpoint,
  updateFlowJson as updateFlowJsonEndpoint,
  publishFlow as publishFlowEndpoint,
  deleteFlow as deleteFlowEndpoint,
  deprecateFlow as deprecateFlowEndpoint,
  getFlowAssets as getFlowAssetsEndpoint,
  type CreateFlowBody,
  type CreateMessageTemplateBody,
  type DeleteMessageTemplateInput,
  type FlowAssetsResponse,
  type FlowDetails,
  type FlowListResponse,
  type FlowMutationResponse,
  type GetFlowAssetsInput,
  type GetFlowInput,
  type GetMessageTemplateInput,
  type ListFlowsInput,
  type ListMessageTemplatesInput,
  type PhoneNumberListResponse,
  type TemplateDetails,
  type TemplateListResponse,
  type TemplateMutationResponse,
  type UpdateFlowJsonBody,
  type UpdateFlowMetadataBody,
  type UpdateMessageTemplateBody
} from "../endpoints/wabaEndpoints";

export interface WABAClientConfig {
  readonly graphClient: GraphClient;
  readonly wabaId: string;
}

function hasRequestMethod(
  candidate: unknown
): candidate is { request: (...args: readonly unknown[]) => unknown } {
  if (candidate === null || typeof candidate !== "object") {
    return false;
  }
  const maybe = candidate as { request?: unknown };
  return typeof maybe.request === "function";
}

export function validateWABAClientConfig(config: WABAClientConfig): void {
  if (typeof config !== "object" || config === null) {
    throw new GraphRequestValidationError(
      "Invalid WABAClient config: expected an options object."
    );
  }
  const raw = config as { graphClient?: unknown; wabaId?: unknown };
  if (!hasRequestMethod(raw.graphClient)) {
    throw new GraphRequestValidationError(
      "Invalid WABAClient config: graphClient must expose a request() method."
    );
  }
  if (typeof raw.wabaId !== "string") {
    throw new GraphRequestValidationError(
      "Invalid WABAClient config: wabaId must be a non-empty string."
    );
  }
  if (raw.wabaId.length === 0 || raw.wabaId.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid WABAClient config: wabaId must be a non-empty string."
    );
  }
  assertSafePathParamValue("wabaId", raw.wabaId);
  assertNoEncodedUnsafePathParam(raw.wabaId, "wabaId");
}

function assertNoEncodedUnsafePathParam(value: string, fieldName: string): void {
  let decoded = value;
  for (let round = 0; round < 8; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new GraphRequestValidationError(
        `Invalid WABAClient config: ${fieldName} contains malformed percent encoding.`
      );
    }
    if (next === decoded) return;
    decoded = next;
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("?") ||
      decoded.includes("#")
    ) {
      throw new GraphRequestValidationError(
        `Invalid WABAClient config: ${fieldName} contains an unsafe path segment.`
      );
    }
  }
  throw new GraphRequestValidationError(
    `Invalid WABAClient config: ${fieldName} contains excessive percent encoding.`
  );
}

function splitFlowIdParams(
  params: unknown,
  helperName: string
): { readonly flowId: string; readonly rest: Record<string, unknown> } {
  const split = splitRequiredStringDataProp(params, "flowId", helperName);
  return { flowId: split.value, rest: split.rest };
}

export class WABAClient {
  readonly #graphClient: GraphClient;
  readonly #wabaId: string;

  constructor(config: WABAClientConfig) {
    validateWABAClientConfig(config);
    this.#graphClient = config.graphClient;
    this.#wabaId = config.wabaId;
  }

  get wabaId(): string {
    return this.#wabaId;
  }

  get graphClient(): GraphClient {
    return this.#graphClient;
  }

  /** Graph `GET /{wabaId}` — returns WABA inventory/profile fields. */
  async getInfo(
    params?: Omit<GetWabaInfoInput, "wabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<WabaInfo> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "WABAClient.getInfo"
    );
    scopedParams.wabaId = this.#wabaId;
    return getWabaInfoEndpoint(
      this.#graphClient,
      scopedParams as unknown as GetWabaInfoInput,
      undefined,
      opts
    );
  }

  /** Graph `GET /{wabaId}/subscribed_apps`. */
  async listSubscribedApps(
    params?: Record<string, never>,
    opts?: EndpointInvokeOptions
  ): Promise<SubscribedAppsResponse> {
    copyOptionalParamsObject(params, "WABAClient.listSubscribedApps");
    return listSubscribedAppsEndpoint(
      this.#graphClient,
      { wabaId: this.#wabaId },
      undefined,
      opts
    );
  }

  /**
   * Graph `GET /{wabaId}/phone_numbers` — returns the phone numbers
   * attached to this WABA. Delegates to the F-6 `listPhoneNumbers`
   * endpoint-registry callable with the bound wabaId injected.
   */
  async listPhoneNumbers(
    params?: Omit<ListPhoneNumbersInput, "wabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<PhoneNumberListResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "WABAClient.listPhoneNumbers"
    );
    scopedParams.wabaId = this.#wabaId;
    return listPhoneNumbersEndpoint(
      this.#graphClient,
      scopedParams as unknown as ListPhoneNumbersInput,
      undefined,
      opts
    );
  }

  /** Graph `GET /{wabaId}/message_templates`. */
  async listMessageTemplates(
    params?: Omit<ListMessageTemplatesInput, "wabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateListResponse> {
    const scopedParams: Record<string, unknown> = {
      ...copyOptionalParamsObject(params, "WABAClient.listMessageTemplates"),
      wabaId: this.#wabaId
    };
    return listMessageTemplatesEndpoint(
      this.#graphClient,
      scopedParams as ListMessageTemplatesInput & Record<string, string>,
      undefined,
      opts
    );
  }

  /** Graph `POST /{wabaId}/message_templates`. */
  async createMessageTemplate(
    body: CreateMessageTemplateBody,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateMutationResponse> {
    return createMessageTemplateEndpoint(
      this.#graphClient,
      { wabaId: this.#wabaId },
      body,
      opts
    );
  }

  /** Graph `GET /{templateId}`. */
  async getMessageTemplate(
    params: GetMessageTemplateInput,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateDetails> {
    return getMessageTemplateEndpoint(
      this.#graphClient,
      params as GetMessageTemplateInput & Record<string, string>,
      undefined,
      opts
    );
  }

  /** Graph `POST /{templateId}`. */
  async updateMessageTemplate(
    params: { readonly templateId: string } & UpdateMessageTemplateBody,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateMutationResponse> {
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      throw new GraphRequestValidationError(
        "Invalid WABAClient.updateMessageTemplate params: expected an options object."
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(params);
    const templateIdDescriptor = descriptors.templateId;
    if (
      templateIdDescriptor === undefined ||
      typeof templateIdDescriptor.get === "function" ||
      typeof templateIdDescriptor.set === "function" ||
      typeof templateIdDescriptor.value !== "string"
    ) {
      throw new GraphRequestValidationError(
        "Invalid WABAClient.updateMessageTemplate params: templateId must be a string data property."
      );
    }
    const body: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === "templateId") continue;
      if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        throw new GraphRequestValidationError(
          "Invalid WABAClient.updateMessageTemplate params: accessors are not allowed."
        );
      }
      if (descriptor.value !== undefined) body[key] = descriptor.value;
    }
    return updateMessageTemplateEndpoint(
      this.#graphClient,
      { templateId: templateIdDescriptor.value },
      body as UpdateMessageTemplateBody,
      opts
    );
  }

  /** Graph `DELETE /{wabaId}/message_templates?name=...&hsm_id=...`. */
  async deleteMessageTemplate(
    params: Omit<DeleteMessageTemplateInput, "wabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateMutationResponse> {
    const scopedParams: Record<string, unknown> = {
      ...copyOptionalParamsObject(params, "WABAClient.deleteMessageTemplate"),
      wabaId: this.#wabaId
    };
    return deleteMessageTemplateEndpoint(
      this.#graphClient,
      scopedParams as DeleteMessageTemplateInput & Record<string, string>,
      undefined,
      opts
    );
  }

  /** Graph `GET /{wabaId}/flows`. */
  async listFlows(
    params?: Omit<ListFlowsInput, "wabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<FlowListResponse> {
    const scopedParams: Record<string, unknown> = {
      ...copyOptionalParamsObject(params, "WABAClient.listFlows"),
      wabaId: this.#wabaId
    };
    return listFlowsEndpoint(
      this.#graphClient,
      scopedParams as ListFlowsInput & Record<string, string>,
      undefined,
      opts
    );
  }

  /** Graph `POST /{wabaId}/flows`. */
  async createFlow(
    body: CreateFlowBody,
    opts?: EndpointInvokeOptions
  ): Promise<FlowMutationResponse> {
    return createFlowEndpoint(
      this.#graphClient,
      { wabaId: this.#wabaId },
      body,
      opts
    );
  }

  /** Graph `GET /{flowId}`. */
  async getFlow(
    params: GetFlowInput,
    opts?: EndpointInvokeOptions
  ): Promise<FlowDetails> {
    const { flowId, rest } = splitFlowIdParams(params, "WABAClient.getFlow");
    return getFlowEndpoint(
      this.#graphClient,
      { flowId, ...rest } as GetFlowInput & Record<string, string>,
      undefined,
      opts
    );
  }

  /** Graph `POST /{flowId}` metadata update. */
  async updateFlowMetadata(
    params: { readonly flowId: string } & UpdateFlowMetadataBody,
    opts?: EndpointInvokeOptions
  ): Promise<FlowMutationResponse> {
    const { flowId, rest } = splitFlowIdParams(params, "WABAClient.updateFlowMetadata");
    return updateFlowMetadataEndpoint(
      this.#graphClient,
      { flowId },
      rest as UpdateFlowMetadataBody,
      opts
    );
  }

  /** Graph `POST /{flowId}/assets` Flow JSON update. */
  async updateFlowJson(
    params: { readonly flowId: string } & UpdateFlowJsonBody,
    opts?: EndpointInvokeOptions
  ): Promise<FlowMutationResponse> {
    const { flowId, rest } = splitFlowIdParams(params, "WABAClient.updateFlowJson");
    return updateFlowJsonEndpoint(
      this.#graphClient,
      { flowId },
      rest as unknown as UpdateFlowJsonBody,
      opts
    );
  }

  /** Graph `POST /{flowId}/publish`. */
  async publishFlow(
    params: { readonly flowId: string },
    opts?: EndpointInvokeOptions
  ): Promise<FlowMutationResponse> {
    const { flowId } = splitFlowIdParams(params, "WABAClient.publishFlow");
    return publishFlowEndpoint(this.#graphClient, { flowId }, undefined, opts);
  }

  /** Graph `DELETE /{flowId}`. */
  async deleteFlow(
    params: { readonly flowId: string },
    opts?: EndpointInvokeOptions
  ): Promise<FlowMutationResponse> {
    const { flowId } = splitFlowIdParams(params, "WABAClient.deleteFlow");
    return deleteFlowEndpoint(this.#graphClient, { flowId }, undefined, opts);
  }

  /** Graph `POST /{flowId}/deprecate`. */
  async deprecateFlow(
    params: { readonly flowId: string },
    opts?: EndpointInvokeOptions
  ): Promise<FlowMutationResponse> {
    const { flowId } = splitFlowIdParams(params, "WABAClient.deprecateFlow");
    return deprecateFlowEndpoint(this.#graphClient, { flowId }, undefined, opts);
  }

  /** Graph `GET /{flowId}/assets`. */
  async getFlowAssets(
    params: GetFlowAssetsInput,
    opts?: EndpointInvokeOptions
  ): Promise<FlowAssetsResponse> {
    const { flowId, rest } = splitFlowIdParams(params, "WABAClient.getFlowAssets");
    return getFlowAssetsEndpoint(
      this.#graphClient,
      { flowId, ...rest } as GetFlowAssetsInput & Record<string, string>,
      undefined,
      opts
    );
  }
}
