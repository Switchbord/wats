// WATS-133 GroupClient.
//
// Scoped sub-client that binds a WhatsApp Groups API group id at construction
// and exposes group-scoped endpoint callables as methods. The constructor
// fail-closes with the same path-param validation used by endpoint callables;
// methods inject the bound id after inspecting optional caller params so a
// caller-supplied groupId cannot override the constructor scope.

import type { GraphClient } from "../client.js";
import type { EndpointInvokeOptions } from "../endpoint.js";
import { assertSafePathParamValue } from "../endpoint.js";
import { GraphRequestValidationError } from "../errors.js";
import { copyOptionalParamsObject } from "../internal/validation/options.js";
import {
  approveGroupJoinRequests as approveGroupJoinRequestsEndpoint,
  deleteGroup as deleteGroupEndpoint,
  getGroup as getGroupEndpoint,
  getGroupInviteLink as getGroupInviteLinkEndpoint,
  listGroupJoinRequests as listGroupJoinRequestsEndpoint,
  rejectGroupJoinRequests as rejectGroupJoinRequestsEndpoint,
  removeGroupParticipants as removeGroupParticipantsEndpoint,
  resetGroupInviteLink as resetGroupInviteLinkEndpoint,
  updateGroup as updateGroupEndpoint,
  type GetGroupParams,
  type GroupDetails,
  type GroupInviteLinkResponse,
  type GroupJoinRequestsResponse,
  type GroupMutationResponse,
  type ListGroupJoinRequestsParams,
  type ManageGroupJoinRequestsBody,
  type RemoveGroupParticipantsBody,
  type UpdateGroupBody
} from "../endpoints/groups.js";

export interface GroupClientConfig {
  readonly graphClient: GraphClient;
  readonly groupId: string;
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

function assertNoEncodedUnsafePathParam(value: string, fieldName: string): void {
  let decoded = value;
  for (let round = 0; round < 8; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new GraphRequestValidationError(
        `Invalid GroupClient config: ${fieldName} contains malformed percent encoding.`
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
        `Invalid GroupClient config: ${fieldName} contains an unsafe path segment.`
      );
    }
  }
  throw new GraphRequestValidationError(
    `Invalid GroupClient config: ${fieldName} contains excessive percent encoding.`
  );
}

export function validateGroupClientConfig(config: GroupClientConfig): void {
  if (typeof config !== "object" || config === null) {
    throw new GraphRequestValidationError(
      "Invalid GroupClient config: expected an options object."
    );
  }
  const raw = config as { graphClient?: unknown; groupId?: unknown };
  if (!hasRequestMethod(raw.graphClient)) {
    throw new GraphRequestValidationError(
      "Invalid GroupClient config: graphClient must expose a request() method."
    );
  }
  if (typeof raw.groupId !== "string") {
    throw new GraphRequestValidationError(
      "Invalid GroupClient config: groupId must be a non-empty string."
    );
  }
  if (raw.groupId.length === 0 || raw.groupId.trim().length === 0) {
    throw new GraphRequestValidationError(
      "Invalid GroupClient config: groupId must be a non-empty string."
    );
  }
  assertSafePathParamValue("groupId", raw.groupId);
  assertNoEncodedUnsafePathParam(raw.groupId, "groupId");
}

export class GroupClient {
  readonly #graphClient: GraphClient;
  readonly #groupId: string;

  constructor(config: GroupClientConfig) {
    validateGroupClientConfig(config);
    this.#graphClient = config.graphClient;
    this.#groupId = config.groupId;
  }

  get groupId(): string {
    return this.#groupId;
  }

  get graphClient(): GraphClient {
    return this.#graphClient;
  }

  /** Graph `GET /{groupId}` — returns group metadata and participant fields. */
  async getInfo(
    params?: Omit<GetGroupParams, "groupId">,
    opts?: EndpointInvokeOptions
  ): Promise<GroupDetails> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "GroupClient.getInfo"
    );
    scopedParams.groupId = this.#groupId;
    return getGroupEndpoint(
      this.#graphClient,
      scopedParams as unknown as GetGroupParams,
      undefined,
      opts
    );
  }

  /** Graph `POST /{groupId}` — update subject, description, or join approval mode. */
  async update(
    body: UpdateGroupBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return updateGroupEndpoint(
      this.#graphClient,
      { groupId: this.#groupId },
      body,
      opts
    );
  }

  /** Graph `DELETE /{groupId}`. */
  async delete(
    params?: Record<string, never>,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    copyOptionalParamsObject(params, "GroupClient.delete");
    return deleteGroupEndpoint(
      this.#graphClient,
      { groupId: this.#groupId },
      undefined,
      opts
    );
  }

  /** Graph `GET /{groupId}/invite_link`. */
  async getInviteLink(
    params?: Record<string, never>,
    opts?: EndpointInvokeOptions
  ): Promise<GroupInviteLinkResponse> {
    copyOptionalParamsObject(params, "GroupClient.getInviteLink");
    return getGroupInviteLinkEndpoint(
      this.#graphClient,
      { groupId: this.#groupId },
      undefined,
      opts
    );
  }

  /** Graph `POST /{groupId}/invite_link` — resets the invite link. */
  async resetInviteLink(
    params?: Record<string, never>,
    opts?: EndpointInvokeOptions
  ): Promise<GroupInviteLinkResponse> {
    copyOptionalParamsObject(params, "GroupClient.resetInviteLink");
    return resetGroupInviteLinkEndpoint(
      this.#graphClient,
      { groupId: this.#groupId },
      undefined,
      opts
    );
  }

  /** Graph `DELETE /{groupId}/participants` — remove up to 8 participants. */
  async removeParticipants(
    body: RemoveGroupParticipantsBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return removeGroupParticipantsEndpoint(
      this.#graphClient,
      { groupId: this.#groupId },
      body,
      opts
    );
  }

  /** Graph `GET /{groupId}/join_requests`. */
  async getJoinRequests(
    params?: Omit<ListGroupJoinRequestsParams, "groupId">,
    opts?: EndpointInvokeOptions
  ): Promise<GroupJoinRequestsResponse> {
    const scopedParams: Record<string, unknown> = copyOptionalParamsObject(
      params,
      "GroupClient.getJoinRequests"
    );
    scopedParams.groupId = this.#groupId;
    return listGroupJoinRequestsEndpoint(
      this.#graphClient,
      scopedParams as unknown as ListGroupJoinRequestsParams,
      undefined,
      opts
    );
  }

  /** Graph `POST /{groupId}/join_requests` — approve pending join requests. */
  async approveJoinRequests(
    body: ManageGroupJoinRequestsBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return approveGroupJoinRequestsEndpoint(
      this.#graphClient,
      { groupId: this.#groupId },
      body,
      opts
    );
  }

  /** Graph `DELETE /{groupId}/join_requests` — reject pending join requests. */
  async rejectJoinRequests(
    body: ManageGroupJoinRequestsBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return rejectGroupJoinRequestsEndpoint(
      this.#graphClient,
      { groupId: this.#groupId },
      body,
      opts
    );
  }
}
