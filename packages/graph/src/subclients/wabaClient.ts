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

import type { GraphClient } from "../client.js";
import type { EndpointInvokeOptions } from "../endpoint.js";
import { assertSafePathParamValue } from "../endpoint.js";
import { GraphRequestValidationError } from "../errors.js";
import { copyOptionalParamsObject, splitRequiredStringDataProp } from "../internal/validation/options.js";
import {
  getWabaInfo as getWabaInfoEndpoint,
  listSubscribedApps as listSubscribedAppsEndpoint,
  type GetWabaInfoInput,
  type SubscribedAppsResponse,
  type WabaInfo
} from "../endpoints/businessManagement.js";
import {
  listPhoneNumbers as listPhoneNumbersEndpoint,
  type ListPhoneNumbersInput,
  type PhoneNumberListResponse
} from "../endpoints/waba/index.js";
import {
  createMessageTemplate as createMessageTemplateEndpoint,
  deleteMessageTemplate as deleteMessageTemplateEndpoint,
  getMessageTemplate as getMessageTemplateEndpoint,
  listMessageTemplates as listMessageTemplatesEndpoint,
  updateMessageTemplate as updateMessageTemplateEndpoint,
  listTemplateGroups as listTemplateGroupsEndpoint,
  createTemplateGroup as createTemplateGroupEndpoint,
  getTemplateGroup as getTemplateGroupEndpoint,
  updateTemplateGroup as updateTemplateGroupEndpoint,
  deleteTemplateGroup as deleteTemplateGroupEndpoint,
  getTemplateGroupAnalytics as getTemplateGroupAnalyticsEndpoint,
  compareTemplates as compareTemplatesEndpoint,
  unpauseTemplate as unpauseTemplateEndpoint,
  migrateTemplates as migrateTemplatesEndpoint,
  listFlows as listFlowsEndpoint,
  getFlow as getFlowEndpoint,
  getFlowMetrics as getFlowMetricsEndpoint,
  createFlow as createFlowEndpoint,
  updateFlowMetadata as updateFlowMetadataEndpoint,
  updateFlowJson as updateFlowJsonEndpoint,
  publishFlow as publishFlowEndpoint,
  deleteFlow as deleteFlowEndpoint,
  deprecateFlow as deprecateFlowEndpoint,
  getFlowAssets as getFlowAssetsEndpoint,
  migrateFlows as migrateFlowsEndpoint,
  type CreateFlowBody,
  type CreateMessageTemplateBody,
  type DeleteMessageTemplateInput,
  type FlowAssetsResponse,
  type FlowDetails,
  type FlowListResponse,
  type FlowMetric,
  type FlowMutationResponse,
  type GetFlowAssetsInput,
  type GetFlowInput,
  type GetFlowMetricsInput,
  type GetMessageTemplateInput,
  type ListFlowsInput,
  type ListMessageTemplatesInput,
  type ListTemplateGroupsInput,
  type MigrateFlowsInput,
  type MigrateFlowsResponse,
  type TemplateDetails,
  type TemplateGroupAnalyticsInput,
  type TemplateGroupAnalyticsResponse,
  type TemplateGroupDetails,
  type TemplateGroupListResponse,
  type TemplateGroupMutationResponse,
  type TemplateListResponse,
  type TemplateMutationResponse,
  type CreateTemplateGroupBody,
  type CompareTemplatesInput,
  type DeleteTemplateGroupInput,
  type GetTemplateGroupInput,
  type MigrateTemplatesInput,
  type MigrateTemplatesResponse,
  type TemplatesCompareResult,
  type TemplateUnpauseResult,
  type UnpauseTemplateInput,
  type UpdateTemplateGroupBody,
  type UpdateFlowJsonBody,
  type UpdateFlowMetadataBody,
  type UpdateMessageTemplateBody
} from "../endpoints/wabaEndpoints.js";

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


  /** Graph `GET /{wabaId}/template_groups`. */
  async listTemplateGroups(
    params?: Omit<ListTemplateGroupsInput, "wabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateGroupListResponse> {
    const scopedParams: Record<string, unknown> = {
      ...copyOptionalParamsObject(params, "WABAClient.listTemplateGroups"),
      wabaId: this.#wabaId
    };
    return listTemplateGroupsEndpoint(
      this.#graphClient,
      scopedParams as unknown as ListTemplateGroupsInput,
      undefined,
      opts
    );
  }

  /** Graph `POST /{wabaId}/template_groups`. */
  async createTemplateGroup(
    body: CreateTemplateGroupBody,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateGroupMutationResponse> {
    return createTemplateGroupEndpoint(
      this.#graphClient,
      { wabaId: this.#wabaId },
      body,
      opts
    );
  }

  /** Graph `GET /{templateGroupId}`. */
  async getTemplateGroup(
    params: GetTemplateGroupInput,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateGroupDetails> {
    return getTemplateGroupEndpoint(
      this.#graphClient,
      params,
      undefined,
      opts
    );
  }

  /** Graph `POST /{templateGroupId}`. */
  async updateTemplateGroup(
    params: { readonly templateGroupId: string } & UpdateTemplateGroupBody,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateGroupMutationResponse> {
    const { value: templateGroupId, rest } = splitRequiredStringDataProp(
      params,
      "templateGroupId",
      "WABAClient.updateTemplateGroup"
    );
    return updateTemplateGroupEndpoint(
      this.#graphClient,
      { templateGroupId },
      rest as UpdateTemplateGroupBody,
      opts
    );
  }

  /** Graph `DELETE /{templateGroupId}`. */
  async deleteTemplateGroup(
    params: DeleteTemplateGroupInput,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateGroupMutationResponse> {
    return deleteTemplateGroupEndpoint(this.#graphClient, params, undefined, opts);
  }

  /** Graph `GET /{wabaId}/template_group_analytics`. */
  async getTemplateGroupAnalytics(
    params?: Omit<TemplateGroupAnalyticsInput, "wabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateGroupAnalyticsResponse> {
    const scopedParams: Record<string, unknown> = {
      ...copyOptionalParamsObject(params, "WABAClient.getTemplateGroupAnalytics"),
      wabaId: this.#wabaId
    };
    return getTemplateGroupAnalyticsEndpoint(
      this.#graphClient,
      scopedParams as unknown as TemplateGroupAnalyticsInput,
      undefined,
      opts
    );
  }

  /**
   * Graph `GET /{templateId}/compare` (WATS-153). Template-id scoped edge
   * that compares send/block metrics across templates. Delegates to the
   * endpoint-registry callable; the bound wabaId is not used because the
   * path is template-id scoped (mirrors getMessageTemplate).
   */
  async compareTemplates(
    params: CompareTemplatesInput,
    opts?: EndpointInvokeOptions
  ): Promise<TemplatesCompareResult> {
    return compareTemplatesEndpoint(
      this.#graphClient,
      params,
      undefined,
      opts
    );
  }

  /**
   * Graph `POST /{templateId}/unpause` (WATS-153). Template-id scoped edge
   * that unpauses a paused template. Delegates to the endpoint-registry
   * callable; the bound wabaId is not used (mirrors getMessageTemplate).
   * The endpoint/response shape is UNVERIFIED — see REFERENCE-153.md.
   */
  async unpauseTemplate(
    params: UnpauseTemplateInput,
    opts?: EndpointInvokeOptions
  ): Promise<TemplateUnpauseResult> {
    return unpauseTemplateEndpoint(
      this.#graphClient,
      params,
      undefined,
      opts
    );
  }

  /**
   * Graph `POST /{wabaId}/migrate_message_templates?source_waba_id=...`
   * (WATS-160A). Copies (not moves) message templates from a source WABA
   * into the bound destination WABA. Mirrors pywa's
   * `WhatsApp.migrate_templates`. The bound wabaId is used as the
   * destination and wins over any caller-supplied `destinationWabaId`
   * (mirrors `migrateFlows`). See REFERENCE-160 / handoff.
   */
  async migrateTemplates(
    params: Omit<MigrateTemplatesInput, "destinationWabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<MigrateTemplatesResponse> {
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      throw new GraphRequestValidationError(
        "Invalid WABAClient.migrateTemplates params: expected an options object."
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(params);
    const scopedParams: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        throw new GraphRequestValidationError(
          `Invalid WABAClient.migrateTemplates params: ${key} must not use accessors.`
        );
      }
      if (descriptor.value !== undefined) scopedParams[key] = descriptor.value;
    }
    scopedParams.destinationWabaId = this.#wabaId;
    return migrateTemplatesEndpoint(
      this.#graphClient,
      scopedParams as unknown as MigrateTemplatesInput,
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

  /**
   * Graph `GET /{flowId}?fields=metric.name(...).granularity(...)...`
   * (WATS-154). Flow-id scoped edge that returns Flow metrics; the bound
   * wabaId is not used because the path is flow-id scoped (mirrors
   * getFlow / getFlowAssets). See REFERENCE-154.md §1.
   */
  async getFlowMetrics(
    params: GetFlowMetricsInput,
    opts?: EndpointInvokeOptions
  ): Promise<FlowMetric> {
    const { flowId, rest } = splitFlowIdParams(params, "WABAClient.getFlowMetrics");
    return getFlowMetricsEndpoint(
      this.#graphClient,
      { flowId, ...rest } as unknown as GetFlowMetricsInput & Record<string, string>,
      undefined,
      opts
    );
  }

  /**
   * Graph `POST /{wabaId}/migrate_flows?source_waba_id=...&source_flow_names=...`
   * (WATS-154). Copies (not moves) Flows from a source WABA into the bound
   * destination WABA. Mirrors pywa's `WhatsApp.migrate_flows`. The bound
   * wabaId is used as the destination; see REFERENCE-154.md §2.
   */
  async migrateFlows(
    params: Omit<MigrateFlowsInput, "destinationWabaId">,
    opts?: EndpointInvokeOptions
  ): Promise<MigrateFlowsResponse> {
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      throw new GraphRequestValidationError(
        "Invalid WABAClient.migrateFlows params: expected an options object."
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(params);
    const scopedParams: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        throw new GraphRequestValidationError(
          `Invalid WABAClient.migrateFlows params: ${key} must not use accessors.`
        );
      }
      if (descriptor.value !== undefined) scopedParams[key] = descriptor.value;
    }
    scopedParams.destinationWabaId = this.#wabaId;
    return migrateFlowsEndpoint(
      this.#graphClient,
      scopedParams as unknown as MigrateFlowsInput,
      undefined,
      opts
    );
  }
}
