// WATS-132 public WhatsApp Groups API endpoint subpath.
//
// Thin compatibility barrel over the WATS-132 Groups endpoint family.
/**
 * @experimental Groups endpoint helpers may change in 0.x minors while WATS expands Groups API parity.
 */

export {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_MAX_JOIN_REQUESTS,
  GROUP_MAX_PARTICIPANTS,
  GROUP_SUBJECT_MAX_LENGTH,
  approveGroupJoinRequests,
  createGroup,
  deleteGroup,
  getGroup,
  getGroupInviteLink,
  listGroupJoinRequests,
  rejectGroupJoinRequests,
  removeGroupParticipants,
  revokeGroupInviteLink,
  updateGroup
} from "./groups/index.js";

export type {
  CreateGroupBody,
  CreateGroupParams,
  GetGroupParams,
  GraphPaging,
  GroupDetails,
  GroupIdParams,
  GroupInviteLinkResponse,
  GroupJoinApprovalMode,
  GroupJoinRequestWire,
  GroupJoinRequestsResponse,
  GroupMutationResponse,
  GroupParticipantWire,
  ListGroupJoinRequestsParams,
  ManageGroupJoinRequestsBody,
  RemoveGroupParticipantsBody,
  UpdateGroupBody
} from "./groups/index.js";
