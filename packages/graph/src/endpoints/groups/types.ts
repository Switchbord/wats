// WATS-132 WhatsApp Groups API endpoint family types.
//
// Public input/response shapes for the Groups API endpoint family. Public
// inputs are camelCase; the snake_case Graph wire is produced only at the
// transport boundary in callables.ts. Group entity / webhook types live in
// @wats/types/groups (WATS-131); these are the request/response shapes for
// the Graph endpoints specifically.

import type { GraphPaging } from "../waba/types.js";

/**
 * Group join-approval policy. `auto_approve` lets anyone with the invite
 * link join immediately; `approval_required` routes joins through the
 * join-request approval queue. Mirrors the `GroupJoinApprovalMode` public
 * type in @wats/types/groups (WATS-131) at the Graph transport boundary.
 */
export type GroupJoinApprovalMode = "auto_approve" | "approval_required";

/** Wire-shaped participant as returned by Graph (`wa_id`). */
export interface GroupParticipantWire {
  readonly wa_id?: string;
  readonly [key: string]: unknown;
}

/** Group metadata response from `GET /<group-id>` (raw Graph wire). */
export interface GroupDetails {
  readonly id?: string;
  readonly subject?: string;
  readonly description?: string;
  readonly join_approval_mode?: GroupJoinApprovalMode;
  readonly suspended?: boolean;
  readonly creation_timestamp?: number;
  readonly total_participant_count?: number;
  readonly participants?: readonly GroupParticipantWire[];
  readonly [key: string]: unknown;
}

/**
 * Async mutation acknowledgement. Group create/update/participant/join
 * operations are asynchronous on the Cloud API: the HTTP call returns a
 * `request_id` correlator and the outcome is delivered via the matching
 * `group_*_update` webhook.
 */
export interface GroupMutationResponse {
  readonly request_id?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

/** Invite-link response from `GET /<group-id>/invite_link`. */
export interface GroupInviteLinkResponse {
  readonly invite_link?: string;
  readonly [key: string]: unknown;
}

/** A single pending join request (raw Graph wire). */
export interface GroupJoinRequestWire {
  readonly join_request_id?: string;
  readonly wa_id?: string;
  readonly creation_timestamp?: number;
  readonly [key: string]: unknown;
}

/** Join-request listing from `GET /<group-id>/join_requests`. */
export interface GroupJoinRequestsResponse {
  readonly data?: readonly GroupJoinRequestWire[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

// --- public callable inputs --------------------------------------------

export interface CreateGroupParams {
  readonly phoneNumberId: string;
}

export interface CreateGroupBody {
  readonly subject: string;
  readonly description?: string;
  readonly joinApprovalMode?: GroupJoinApprovalMode;
  readonly [key: string]: unknown;
}

export interface GetGroupParams {
  readonly groupId: string;
  readonly fields?: string;
}

export interface GroupIdParams {
  readonly groupId: string;
}

export interface UpdateGroupBody {
  readonly subject?: string;
  readonly description?: string;
  readonly joinApprovalMode?: GroupJoinApprovalMode;
  readonly [key: string]: unknown;
}

export interface ListGroupJoinRequestsParams {
  readonly groupId: string;
  readonly limit?: string;
  readonly after?: string;
}

export interface ManageGroupJoinRequestsBody {
  readonly joinRequestIds: readonly string[];
}

export interface RemoveGroupParticipantsBody {
  readonly waIds: readonly string[];
}
