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

/** Public participant response. Graph wire `wa_id` is normalized to `waId`. */
export interface GroupParticipantWire {
  readonly waId?: string;
  readonly [key: string]: unknown;
}

/** Group metadata response from `GET /<group-id>` (camelCase public shape). */
export interface GroupDetails {
  readonly id?: string;
  readonly subject?: string;
  readonly description?: string;
  readonly joinApprovalMode?: GroupJoinApprovalMode;
  readonly suspended?: boolean;
  readonly creationTimestamp?: number;
  readonly totalParticipantCount?: number;
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
  readonly requestId?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

/** Invite-link response from `GET /<group-id>/invite_link`. */
export interface GroupInviteLinkResponse {
  readonly inviteLink?: string;
  readonly [key: string]: unknown;
}

/** A single group summary as returned by `GET /<phone-number-id>/groups`. */
export interface GroupSummaryWire {
  readonly id?: string;
  readonly subject?: string;
  readonly createdAt?: string;
  readonly [key: string]: unknown;
}

/** Active-groups listing from `GET /<phone-number-id>/groups`. */
export interface ListGroupsResponse {
  readonly data?: { readonly groups?: readonly GroupSummaryWire[] } | readonly GroupSummaryWire[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

/** A single pending join request (raw Graph wire). */
export interface GroupJoinRequestWire {
  readonly joinRequestId?: string;
  readonly waId?: string;
  readonly creationTimestamp?: number;
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

export interface ListGroupsParams {
  readonly phoneNumberId: string;
  readonly limit?: string;
  readonly after?: string;
  readonly before?: string;
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
