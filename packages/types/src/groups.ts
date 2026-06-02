// @wats/types — WhatsApp Groups API types (WATS-131).
//
// Type foundation for the Groups API endpoint family (Meta Cloud API,
// GA on Graph v25.0). Groups hang off the BUSINESS PHONE NUMBER ID, are
// small (max 8 participants excluding the business), invite-only, and
// business-owned. These are camelCase public types over Meta's snake_case
// wire; normalization of wire payloads happens in @wats/core (WATS-135),
// not here. No runtime behavior beyond the documentation manifest.

/**
 * Group join-approval policy. `auto_approve` (default on the wire) lets
 * anyone with the invite link join immediately; `approval_required`
 * routes joins through the join-request approval queue.
 */
export type GroupJoinApprovalMode = "auto_approve" | "approval_required";

/**
 * Message recipient addressing dimension. The Cloud API Messages
 * endpoint accepts `recipient_type: "individual" | "group"`; for a
 * group send the `to` value is the opaque group id, not a phone number.
 */
export type GroupRecipientType = "individual" | "group";

/** A single group participant, identified by WhatsApp id (wa_id). */
export interface GroupParticipant {
  /** WhatsApp id of the participant (wire: `wa_id`). */
  waId: string;
}

/**
 * Group metadata as returned by `GET /<group-id>`. The business creator
 * is the sole admin and is excluded from `totalParticipantCount`.
 */
export interface WatsGroup {
  /** Opaque group id (wire: `id`). */
  id: string;
  /** Group subject/name (wire: `subject`), max 128 chars. */
  subject: string;
  /** Optional group description (wire: `description`), max 2048 chars. */
  description?: string;
  /** Join-approval policy (wire: `join_approval_mode`). */
  joinApprovalMode: GroupJoinApprovalMode;
  /** Whether the group is suspended by moderation (wire: `suspended`). */
  suspended: boolean;
  /** UNIX creation timestamp (wire: `creation_timestamp`). */
  creationTimestamp: number;
  /** Participant count excluding the business (wire: `total_participant_count`). */
  totalParticipantCount: number;
  /** Current participants (wire: `participants`), excluding the business. */
  participants: GroupParticipant[];
}

/** A pending group join request (wire under `GET /<group-id>/join_requests`). */
export interface GroupJoinRequest {
  /** Opaque join-request id (wire: `join_request_id`). */
  joinRequestId: string;
  /** WhatsApp id of the requester (wire: `wa_id`). */
  waId: string;
  /** UNIX request creation timestamp (wire: `creation_timestamp`). */
  creationTimestamp: number;
}

/** Group invite link (wire under `GET|POST /<group-id>/invite_link`). */
export interface GroupInviteLink {
  /** Invite URL, always prefixed `https://chat.whatsapp.com/` (wire: `invite_link`). */
  inviteLink: string;
}

/**
 * `group_lifecycle_update` webhook value — group create/delete outcomes.
 * On a successful create, `groupId` and `inviteLink` are delivered here
 * (the create HTTP call does NOT return them synchronously).
 */
export interface WhatsAppGroupLifecycleUpdateValue {
  messagingProduct: "whatsapp";
  metadata: {
    displayPhoneNumber: string;
    phoneNumberId: string;
  };
  /** Lifecycle event type (wire: `type`), e.g. `group_create`, group delete. */
  type: string;
  /** Correlates an async outcome to the originating request (wire: `request_id`). */
  requestId?: string;
  groupId?: string;
  subject?: string;
  inviteLink?: string;
  joinApprovalMode?: GroupJoinApprovalMode;
  /** Present on a failed lifecycle operation. */
  errors?: unknown[];
  raw?: unknown;
}

/**
 * `group_participants_update` webhook value — add (via invite link),
 * join-request created/revoked, and remove (including a participant
 * leaving, surfaced as a remove initiated by that user).
 */
export interface WhatsAppGroupParticipantsUpdateValue {
  messagingProduct: "whatsapp";
  metadata: {
    displayPhoneNumber: string;
    phoneNumberId: string;
  };
  groupId: string;
  /**
   * Event type (wire: `type`): `group_participants_add`,
   * `group_join_request_created`, `group_join_request_revoked`,
   * `group_participants_remove`.
   */
  type: string;
  /** e.g. `invite_link` for adds (wire: `reason`). */
  reason?: string;
  /** Who initiated a removal (wire: `initiated_by`), e.g. `business`. */
  initiatedBy?: string;
  requestId?: string;
  joinRequestId?: string;
  waId?: string;
  addedParticipants?: GroupParticipant[];
  removedParticipants?: { input?: string; waId?: string }[];
  failedParticipants?: { input?: string; waId?: string; errors?: unknown[] }[];
  errors?: unknown[];
  raw?: unknown;
}

/**
 * `group_settings_update` webhook value — per-field success/failure for
 * subject, description, and profile photo updates.
 */
export interface WhatsAppGroupSettingsUpdateValue {
  messagingProduct: "whatsapp";
  metadata: {
    displayPhoneNumber: string;
    phoneNumberId: string;
  };
  groupId: string;
  type: string;
  groupSubject?: { text?: string; updateSuccessful: boolean; errors?: unknown[] };
  groupDescription?: { text?: string; updateSuccessful: boolean; errors?: unknown[] };
  profilePicture?: { mimeType?: string; sha256?: string; updateSuccessful: boolean; errors?: unknown[] };
  errors?: unknown[];
  raw?: unknown;
}

/**
 * `group_status_update` webhook value — moderation lifecycle, e.g.
 * `group_suspend` / `group_suspend_cleared`.
 */
export interface WhatsAppGroupStatusUpdateValue {
  messagingProduct: "whatsapp";
  metadata: {
    displayPhoneNumber: string;
    phoneNumberId: string;
  };
  groupId: string;
  /** Status event type (wire: `type`): `group_suspend`, `group_suspend_cleared`. */
  type: string;
  raw?: unknown;
}

/**
 * Documentation manifest of the public Groups type surface. Mirrors the
 * other `WATS_TYPES_*_EXPORTS` contract arrays so external consumers can
 * assert the documented surface without reaching into the module.
 */
export const WATS_TYPES_GROUPS_EXPORTS = [
  "WatsGroup",
  "GroupParticipant",
  "GroupJoinRequest",
  "GroupInviteLink",
  "GroupJoinApprovalMode",
  "GroupRecipientType",
  "WhatsAppGroupLifecycleUpdateValue",
  "WhatsAppGroupParticipantsUpdateValue",
  "WhatsAppGroupSettingsUpdateValue",
  "WhatsAppGroupStatusUpdateValue"
] as const;
