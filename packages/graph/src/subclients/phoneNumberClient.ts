// F-7 PhoneNumberClient (WATS-19 / Arch-E).
//
// Scoped sub-client that binds a `phoneNumberId` at CONSTRUCTION and
// exposes endpoint callables as methods that inject the bound id into
// the params object. Constructor validation reuses the F-6 path-param
// sanitizer (`assertSafePathParamValue` from endpoint.ts) so invalid ids
// fail at CONSTRUCTION rather than at first call.
//
// The method catalog started minimal in F-7 with `sendMessage`, expanded
// in WATS-30 with `sendText`, and expands in WATS-38 with outbound media
// and message composer helpers. All methods delegate to the F-6
// `sendMessage` endpoint-registry callable after building typed payloads.

import type { GraphClient } from "../client.js";
import type { EndpointInvokeOptions } from "../endpoint.js";
import { assertSafePathParamValue } from "../endpoint.js";
import { GraphRequestValidationError } from "../errors.js";
import {
  uploadMedia,
  type MediaUploadBody,
  type MediaUploadOptions
} from "../endpoints/media.js";
import { copyOptionalParamsObject } from "../internal/validation/options.js";
import { GroupClient } from "./groupClient.js";
import {
  getBusinessProfile as getBusinessProfileEndpoint,
  getCommerceSettings as getCommerceSettingsEndpoint,
  updateBusinessProfile as updateBusinessProfileEndpoint,
  updateCommerceSettings as updateCommerceSettingsEndpoint,
  getPhoneNumberInfo as getPhoneNumberInfoEndpoint,
  getPhoneNumberSettings as getPhoneNumberSettingsEndpoint,
  updatePhoneNumberSettings as updatePhoneNumberSettingsEndpoint,
  listBlockedUsers as listBlockedUsersEndpoint,
  blockUsers as blockUsersEndpoint,
  unblockUsers as unblockUsersEndpoint,
  getOfficialBusinessAccountStatus as getOfficialBusinessAccountStatusEndpoint,
  requestOfficialBusinessAccountReview as requestOfficialBusinessAccountReviewEndpoint,
  submitDisplayNameForReview as submitDisplayNameForReviewEndpoint,
  type BlockUsersInput,
  type BlockUsersResponse,
  type BlockedUsersResponse,
  type BusinessProfileResponse,
  type CommerceSettingsResponse,
  type GetBusinessProfileInput,
  type GetCommerceSettingsInput,
  type GetOfficialBusinessAccountStatusInput,
  type GetPhoneNumberInfoInput,
  type GetPhoneNumberSettingsInput,
  type UpdateBusinessProfileInput,
  type UpdateCommerceSettingsInput,
  type BusinessProfileUpdateResponse,
  type CommerceSettingsUpdateResponse,
  type ListBlockedUsersInput,
  type OfficialBusinessAccountReviewResponse,
  type OfficialBusinessAccountStatusResponse,
  type PhoneNumberInfo,
  type PhoneNumberSettingsResponse,
  type PhoneNumberSettingsUpdateResponse,
  type RequestOfficialBusinessAccountReviewInput,
  type SubmitDisplayNameForReviewInput,
  type SubmitDisplayNameForReviewResponse,
  type UnblockUsersInput,
  type UnblockUsersResponse,
  type UpdatePhoneNumberSettingsInput
} from "../endpoints/businessManagement.js";
import {
  acceptCall as acceptCallEndpoint,
  initiateCall as initiateCallEndpoint,
  preAcceptCall as preAcceptCallEndpoint,
  rejectCall as rejectCallEndpoint,
  terminateCall as terminateCallEndpoint,
  type AcceptCallRequest,
  type CallLifecycleResponse,
  type InitiateCallRequest,
  type PreAcceptCallRequest,
  type RejectCallRequest,
  type TerminateCallRequest
} from "../endpoints/calling.js";
import {
  createGroup as createGroupEndpoint,
  listGroups as listGroupsEndpoint,
  normalizeGroupMutationResponse,
  normalizeListGroupsResponse,
  type CreateGroupBody,
  type GroupMutationResponse,
  type ListGroupsParams,
  type ListGroupsResponse
} from "../endpoints/groups.js";
import {
  buildMarkMessageAsReadPayload,
  buildRemoveReactionPayload,
  buildRequestLocationPayload,
  buildSendAudioPayload,
  buildSendButtonsPayload,
  buildSendCallPermissionRequestPayload,
  buildSendCatalogPayload,
  buildSendContactsPayload,
  buildSendCtaUrlPayload,
  buildSendDocumentPayload,
  buildSendImagePayload,
  buildSendListPayload,
  buildSendLocationPayload,
  buildSendProductPayload,
  buildSendProductsPayload,
  buildSendReactionPayload,
  buildSendStickerPayload,
  buildSendTemplatePayload,
  sendMarketingTemplate as sendMarketingTemplateEndpoint,
  buildSendTextPayload,
  buildSendVideoPayload,
  buildTypingIndicatorPayload,
  sendMessage as sendMessageEndpoint,
  type GraphMessagesMarkMessageAsReadInput,
  type GraphMessagesRemoveReactionInput,
  type GraphMessagesRequestLocationInput,
  type GraphMessagesSendAudioInput,
  type GraphMessagesSendBody,
  type GraphMessagesSendButtonsInput,
  type GraphMessagesSendCallPermissionRequestInput,
  type GraphMessagesSendCatalogInput,
  type GraphMessagesSendContactsInput,
  type GraphMessagesSendCtaUrlInput,
  type GraphMessagesSendDocumentInput,
  type GraphMessagesSendImageInput,
  type GraphMessagesSendListInput,
  type GraphMessagesSendLocationInput,
  type GraphMessagesSendMarketingTemplateInput,
  type GraphMessagesMarketingTemplateResponse,
  type GraphMessagesSendProductInput,
  type GraphMessagesSendProductsInput,
  type GraphMessagesSendReactionInput,
  type GraphMessagesSendResponse,
  type GraphMessagesSendStickerInput,
  type GraphMessagesSendTemplateInput,
  type GraphMessagesSendTextInput,
  type GraphMessagesSendVideoInput,
  type GraphMessagesTypingIndicatorInput
} from "../endpoints/messages.js";

export interface PhoneNumberClientConfig {
  readonly graphClient: GraphClient;
  readonly phoneNumberId: string;
}

/**
 * WATS-152 slice 1: one-call upload-and-send helpers for in-memory media
 * bodies (`Blob | ArrayBuffer | Uint8Array`). Each helper uploads the body
 * to Graph via `POST /{phoneNumberId}/media` and immediately sends the
 * resulting `media.id` through the corresponding `send*` composer.
 *
 * File-system path support is intentionally deferred to a follow-up slice;
 * `@wats/graph` MUST stay runtime-neutral and never import `node:fs`.
 */
export interface UploadAndSendMediaBaseInput {
  readonly to: string;
  readonly file: Blob | ArrayBuffer | Uint8Array;
  readonly mimeType: string;
  readonly replyToMessageId?: string;
}

export interface UploadAndSendImageInput extends UploadAndSendMediaBaseInput {
  readonly caption?: string;
}

export interface UploadAndSendVideoInput extends UploadAndSendMediaBaseInput {
  readonly caption?: string;
}

export interface UploadAndSendAudioInput extends UploadAndSendMediaBaseInput {
  /** Graph v24+ voice-message designation for audio sends. */
  readonly voice?: boolean;
}

export interface UploadAndSendDocumentInput extends UploadAndSendMediaBaseInput {
  readonly caption?: string;
  readonly filename?: string;
}

export type UploadAndSendStickerInput = UploadAndSendMediaBaseInput;

function hasRequestMethod(
  candidate: unknown
): candidate is { request: (...args: readonly unknown[]) => unknown } {
  if (candidate === null || typeof candidate !== "object") {
    return false;
  }
  const maybe = candidate as { request?: unknown };
  return typeof maybe.request === "function";
}

function assertNoEncodedUnsafePathParam(value: string, fieldName: string): void {
  let decoded = value;
  for (let round = 0; round < 8; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new GraphRequestValidationError(
        `Invalid PhoneNumberClient config: ${fieldName} contains malformed percent encoding.`
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
        `Invalid PhoneNumberClient config: ${fieldName} contains an unsafe path segment.`
      );
    }
  }
  throw new GraphRequestValidationError(
    `Invalid PhoneNumberClient config: ${fieldName} contains excessive percent encoding.`
  );
}

export function validatePhoneNumberClientConfig(
  config: PhoneNumberClientConfig
): void {
  if (typeof config !== "object" || config === null) {
    throw new GraphRequestValidationError(
      "Invalid PhoneNumberClient config: expected an options object."
    );
  }
  const raw = config as {
    graphClient?: unknown;
    phoneNumberId?: unknown;
  };
  if (!hasRequestMethod(raw.graphClient)) {
    throw new GraphRequestValidationError(
      "Invalid PhoneNumberClient config: graphClient must expose a request() method."
    );
  }
  if (typeof raw.phoneNumberId !== "string") {
    throw new GraphRequestValidationError(
      "Invalid PhoneNumberClient config: phoneNumberId must be a non-empty string."
    );
  }
  if (raw.phoneNumberId.length === 0 || raw.phoneNumberId.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid PhoneNumberClient config: phoneNumberId must be a non-empty string."
    );
  }
  // Reuse the F-6 path-param sanitizer so the same rules apply at
  // CONSTRUCTION as would fire at call time — fail early.
  assertSafePathParamValue("phoneNumberId", raw.phoneNumberId);
  assertNoEncodedUnsafePathParam(raw.phoneNumberId, "phoneNumberId");
}

export class PhoneNumberClient {
  readonly #graphClient: GraphClient;
  readonly #phoneNumberId: string;

  constructor(config: PhoneNumberClientConfig) {
    validatePhoneNumberClientConfig(config);
    this.#graphClient = config.graphClient;
    this.#phoneNumberId = config.phoneNumberId;
  }

  get phoneNumberId(): string {
    return this.#phoneNumberId;
  }

  get graphClient(): GraphClient {
    return this.#graphClient;
  }

  /** Return a group-scoped client bound to a validated WhatsApp group id. */
  group(groupId: string): GroupClient {
    return new GroupClient({ graphClient: this.#graphClient, groupId });
  }

  /** Graph `POST /{phoneNumberId}/groups` — create an invite-only business group. */
  async createGroup(
    body: CreateGroupBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    const response = await createGroupEndpoint(
      this.#graphClient,
      { phoneNumberId: this.#phoneNumberId },
      body,
      opts
    );
    return normalizeGroupMutationResponse(response);
  }

  /** Graph `GET /{phoneNumberId}/groups` — list groups owned by this business number. */
  async listGroups(
    params?: Omit<ListGroupsParams, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<ListGroupsResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.listGroups"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    const response = await listGroupsEndpoint(
      this.#graphClient,
      scopedParams as unknown as ListGroupsParams,
      undefined,
      opts
    );
    return normalizeListGroupsResponse(response);
  }

  /** Graph `GET /{phoneNumberId}` — returns phone-number inventory/profile fields. */
  async getInfo(
    params?: Omit<GetPhoneNumberInfoInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<PhoneNumberInfo> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.getInfo"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return getPhoneNumberInfoEndpoint(
      this.#graphClient,
      scopedParams as unknown as GetPhoneNumberInfoInput,
      undefined,
      opts
    );
  }

  /** Graph `GET /{phoneNumberId}/settings`; includeSipCredentials responses may be sensitive. */
  async getSettings(
    params?: Omit<GetPhoneNumberSettingsInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<PhoneNumberSettingsResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.getSettings"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return getPhoneNumberSettingsEndpoint(
      this.#graphClient,
      scopedParams as unknown as GetPhoneNumberSettingsInput,
      undefined,
      opts
    );
  }


  /** Graph `POST /{phoneNumberId}/settings`; WATS-93 local-storage settings update. */
  async updateSettings(
    params: Omit<UpdatePhoneNumberSettingsInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<PhoneNumberSettingsUpdateResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.updateSettings"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return updatePhoneNumberSettingsEndpoint(
      this.#graphClient,
      scopedParams as unknown as UpdatePhoneNumberSettingsInput,
      undefined,
      opts
    );
  }

  /** Graph `GET /{phoneNumberId}/whatsapp_business_profile`. */
  async getBusinessProfile(
    params?: Omit<GetBusinessProfileInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<BusinessProfileResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.getBusinessProfile"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return getBusinessProfileEndpoint(
      this.#graphClient,
      scopedParams as unknown as GetBusinessProfileInput,
      undefined,
      opts
    );
  }

  /** Graph `GET /{phoneNumberId}/whatsapp_commerce_settings`. */
  async getCommerceSettings(
    params?: Omit<GetCommerceSettingsInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<CommerceSettingsResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.getCommerceSettings"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return getCommerceSettingsEndpoint(
      this.#graphClient,
      scopedParams as unknown as GetCommerceSettingsInput,
      undefined,
      opts
    );
  }

  /** Graph `POST /{phoneNumberId}/whatsapp_business_profile`. */
  async updateBusinessProfile(
    params: Omit<UpdateBusinessProfileInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<BusinessProfileUpdateResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.updateBusinessProfile"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return updateBusinessProfileEndpoint(
      this.#graphClient,
      scopedParams as unknown as UpdateBusinessProfileInput,
      undefined,
      opts
    );
  }

  /** Graph `POST /{phoneNumberId}/whatsapp_commerce_settings`. */
  async updateCommerceSettings(
    params: Omit<UpdateCommerceSettingsInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<CommerceSettingsUpdateResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.updateCommerceSettings"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return updateCommerceSettingsEndpoint(
      this.#graphClient,
      scopedParams as unknown as UpdateCommerceSettingsInput,
      undefined,
      opts
    );
  }

  /** Graph `GET /{phoneNumberId}/block_users`. */
  async listBlockedUsers(
    params?: Omit<ListBlockedUsersInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<BlockedUsersResponse> {
    copyOptionalParamsObject(params, "PhoneNumberClient.listBlockedUsers");
    return listBlockedUsersEndpoint(
      this.#graphClient,
      { phoneNumberId: this.#phoneNumberId },
      undefined,
      opts
    );
  }

  /** Graph `POST /{phoneNumberId}/block_users`. */
  async blockUsers(
    params: Omit<BlockUsersInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<BlockUsersResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.blockUsers"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return blockUsersEndpoint(
      this.#graphClient,
      scopedParams as unknown as BlockUsersInput,
      undefined,
      opts
    );
  }

  /** Graph `DELETE /{phoneNumberId}/block_users`. */
  async unblockUsers(
    params: Omit<UnblockUsersInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<UnblockUsersResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.unblockUsers"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return unblockUsersEndpoint(
      this.#graphClient,
      scopedParams as unknown as UnblockUsersInput,
      undefined,
      opts
    );
  }

  /** Graph `GET /{phoneNumberId}/official_business_account`. */
  async getOfficialBusinessAccountStatus(
    params?: Omit<GetOfficialBusinessAccountStatusInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<OfficialBusinessAccountStatusResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.getOfficialBusinessAccountStatus"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return getOfficialBusinessAccountStatusEndpoint(
      this.#graphClient,
      scopedParams as unknown as GetOfficialBusinessAccountStatusInput,
      undefined,
      opts
    );
  }

  /** Graph `POST /{phoneNumberId}/official_business_account`. */
  async requestOfficialBusinessAccountReview(
    params: Omit<RequestOfficialBusinessAccountReviewInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<OfficialBusinessAccountReviewResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.requestOfficialBusinessAccountReview"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return requestOfficialBusinessAccountReviewEndpoint(
      this.#graphClient,
      scopedParams as unknown as RequestOfficialBusinessAccountReviewInput,
      undefined,
      opts
    );
  }

  /** Graph `POST /{phoneNumberId}` with Graph `new_display_name`. */
  async submitDisplayNameForReview(
    params: Omit<SubmitDisplayNameForReviewInput, "phoneNumberId">,
    opts?: EndpointInvokeOptions
  ): Promise<SubmitDisplayNameForReviewResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "PhoneNumberClient.submitDisplayNameForReview"
    );
    scopedParams.phoneNumberId = this.#phoneNumberId;
    return submitDisplayNameForReviewEndpoint(
      this.#graphClient,
      scopedParams as unknown as SubmitDisplayNameForReviewInput,
      undefined,
      opts
    );
  }

  /**
   * Graph `POST /{phoneNumberId}/messages` — delegates to the F-6
   * endpoint-registry `sendMessage` callable with the bound
   * phoneNumberId injected automatically.
   */
  async sendMessage(
    body: GraphMessagesSendBody,
    opts?: EndpointInvokeOptions
  ): Promise<GraphMessagesSendResponse> {
    return sendMessageEndpoint(
      this.#graphClient,
      { phoneNumberId: this.#phoneNumberId },
      body,
      opts
    );
  }

  /**
   * Ergonomic text helper for starting or continuing a chat with any
   * phone-number-like recipient. Does not consult contacts; it validates
   * the public JS input shape and delegates to `POST /{phoneNumberId}/messages`.
   */
  async sendText(
    input: GraphMessagesSendTextInput,
    opts?: EndpointInvokeOptions
  ): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendTextPayload(input), opts);
  }

  async sendImage(input: GraphMessagesSendImageInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendImagePayload(input), opts);
  }

  async sendVideo(input: GraphMessagesSendVideoInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendVideoPayload(input), opts);
  }

  async sendAudio(input: GraphMessagesSendAudioInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendAudioPayload(input), opts);
  }

  async sendCallPermissionRequest(input: GraphMessagesSendCallPermissionRequestInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendCallPermissionRequestPayload(input), opts);
  }

  async sendDocument(input: GraphMessagesSendDocumentInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendDocumentPayload(input), opts);
  }

  async sendSticker(input: GraphMessagesSendStickerInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendStickerPayload(input), opts);
  }

  async sendLocation(input: GraphMessagesSendLocationInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendLocationPayload(input), opts);
  }

  async sendContacts(input: GraphMessagesSendContactsInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendContactsPayload(input), opts);
  }

  async sendReaction(input: GraphMessagesSendReactionInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendReactionPayload(input), opts);
  }

  async removeReaction(input: GraphMessagesRemoveReactionInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildRemoveReactionPayload(input), opts);
  }

  async sendButtons(input: GraphMessagesSendButtonsInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendButtonsPayload(input), opts);
  }

  async sendList(input: GraphMessagesSendListInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendListPayload(input), opts);
  }

  async sendCtaUrl(input: GraphMessagesSendCtaUrlInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendCtaUrlPayload(input), opts);
  }

  async sendProduct(input: GraphMessagesSendProductInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendProductPayload(input), opts);
  }

  async sendProducts(input: GraphMessagesSendProductsInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendProductsPayload(input), opts);
  }

  async sendCatalog(input: GraphMessagesSendCatalogInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendCatalogPayload(input), opts);
  }

  async requestLocation(input: GraphMessagesRequestLocationInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildRequestLocationPayload(input), opts);
  }

  async markMessageAsRead(input: GraphMessagesMarkMessageAsReadInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildMarkMessageAsReadPayload(input), opts);
  }

  async indicateTyping(input: GraphMessagesTypingIndicatorInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildTypingIndicatorPayload(input), opts);
  }

  async sendTemplate(input: GraphMessagesSendTemplateInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesSendResponse> {
    return this.sendMessage(buildSendTemplatePayload(input), opts);
  }

  async sendMarketingTemplate(input: GraphMessagesSendMarketingTemplateInput, opts?: EndpointInvokeOptions): Promise<GraphMessagesMarketingTemplateResponse> {
    try {
      if (typeof input !== "object" || input === null) {
        throw new GraphRequestValidationError("Invalid PhoneNumberClient.sendMarketingTemplate input: expected an options object.");
      }
      if (Array.isArray(input)) {
        throw new GraphRequestValidationError("Invalid PhoneNumberClient.sendMarketingTemplate input: expected an options object.");
      }
      const record = input as unknown as Record<string, unknown>;
      const descriptors = Object.getOwnPropertyDescriptors(record);
      const body: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
          throw new GraphRequestValidationError(`Invalid PhoneNumberClient.sendMarketingTemplate input: ${key} must not use accessors.`);
        }
        if (key !== "phoneNumberId" && descriptor.value !== undefined) body[key] = descriptor.value;
      }
      return sendMarketingTemplateEndpoint(
        this.#graphClient,
        { phoneNumberId: this.#phoneNumberId },
        body as unknown as GraphMessagesSendMarketingTemplateInput,
        opts
      );
    } catch (error) {
      if (error instanceof GraphRequestValidationError) throw error;
      throw new GraphRequestValidationError("Invalid PhoneNumberClient.sendMarketingTemplate input: body could not be inspected.");
    }
  }

  async initiateCall(input: InitiateCallRequest, opts?: EndpointInvokeOptions): Promise<CallLifecycleResponse> {
    return initiateCallEndpoint(this.#graphClient, { phoneNumberId: this.#phoneNumberId }, input, opts);
  }

  async preAcceptCall(input: PreAcceptCallRequest, opts?: EndpointInvokeOptions): Promise<CallLifecycleResponse> {
    return preAcceptCallEndpoint(this.#graphClient, { phoneNumberId: this.#phoneNumberId }, input, opts);
  }

  async acceptCall(input: AcceptCallRequest, opts?: EndpointInvokeOptions): Promise<CallLifecycleResponse> {
    return acceptCallEndpoint(this.#graphClient, { phoneNumberId: this.#phoneNumberId }, input, opts);
  }

  async rejectCall(input: RejectCallRequest, opts?: EndpointInvokeOptions): Promise<CallLifecycleResponse> {
    return rejectCallEndpoint(this.#graphClient, { phoneNumberId: this.#phoneNumberId }, input, opts);
  }

  async terminateCall(input: TerminateCallRequest, opts?: EndpointInvokeOptions): Promise<CallLifecycleResponse> {
    return terminateCallEndpoint(this.#graphClient, { phoneNumberId: this.#phoneNumberId }, input, opts);
  }

  /**
   * WATS-152 slice 1: upload an in-memory media body to Graph and send the
   * returned media id as the corresponding message type. Performs exactly
   * two sequential Graph requests:
   *   1. `POST /{phoneNumberId}/media` (multipart/form-data upload)
   *   2. `POST /{phoneNumberId}/messages` (send by `media.id`)
   *
   * Accepts `Blob | ArrayBuffer | Uint8Array`; filesystem paths are NOT
   * supported in this slice (`@wats/graph` is runtime-neutral).
   */
  async #uploadInMemoryMedia(
    file: Blob | ArrayBuffer | Uint8Array,
    mimeType: string,
    options?: MediaUploadOptions
  ): Promise<string> {
    const body: MediaUploadBody = {
      file,
      type: mimeType,
      messagingProduct: "whatsapp"
    };
    const response = await uploadMedia(
      this.#graphClient,
      { phoneNumberId: this.#phoneNumberId },
      body,
      options
    );
    return response.id;
  }

  async uploadAndSendImage(
    input: UploadAndSendImageInput,
    opts?: EndpointInvokeOptions
  ): Promise<GraphMessagesSendResponse> {
    const mediaId = await this.#uploadInMemoryMedia(input.file, input.mimeType, opts);
    return this.sendImage(
      {
        to: input.to,
        mediaId,
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.replyToMessageId !== undefined
          ? { replyToMessageId: input.replyToMessageId }
          : {})
      },
      opts
    );
  }

  async uploadAndSendVideo(
    input: UploadAndSendVideoInput,
    opts?: EndpointInvokeOptions
  ): Promise<GraphMessagesSendResponse> {
    const mediaId = await this.#uploadInMemoryMedia(input.file, input.mimeType, opts);
    return this.sendVideo(
      {
        to: input.to,
        mediaId,
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.replyToMessageId !== undefined
          ? { replyToMessageId: input.replyToMessageId }
          : {})
      },
      opts
    );
  }

  async uploadAndSendAudio(
    input: UploadAndSendAudioInput,
    opts?: EndpointInvokeOptions
  ): Promise<GraphMessagesSendResponse> {
    const mediaId = await this.#uploadInMemoryMedia(input.file, input.mimeType, opts);
    return this.sendAudio(
      {
        to: input.to,
        mediaId,
        ...(input.voice !== undefined ? { voice: input.voice } : {}),
        ...(input.replyToMessageId !== undefined
          ? { replyToMessageId: input.replyToMessageId }
          : {})
      },
      opts
    );
  }

  async uploadAndSendDocument(
    input: UploadAndSendDocumentInput,
    opts?: EndpointInvokeOptions
  ): Promise<GraphMessagesSendResponse> {
    const mediaId = await this.#uploadInMemoryMedia(input.file, input.mimeType, opts);
    return this.sendDocument(
      {
        to: input.to,
        mediaId,
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.filename !== undefined ? { filename: input.filename } : {}),
        ...(input.replyToMessageId !== undefined
          ? { replyToMessageId: input.replyToMessageId }
          : {})
      },
      opts
    );
  }

  async uploadAndSendSticker(
    input: UploadAndSendStickerInput,
    opts?: EndpointInvokeOptions
  ): Promise<GraphMessagesSendResponse> {
    const mediaId = await this.#uploadInMemoryMedia(input.file, input.mimeType, opts);
    return this.sendSticker(
      {
        to: input.to,
        mediaId,
        ...(input.replyToMessageId !== undefined
          ? { replyToMessageId: input.replyToMessageId }
          : {})
      },
      opts
    );
  }
}
