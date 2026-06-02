// WATS-132 WhatsApp Groups API Graph endpoint callables.
//
// Credential-free Graph parity for the Groups API. Public input is
// camelCase; Graph wire bodies/queries use snake_case only at this
// transport boundary. Group mutations are asynchronous on the Cloud API:
// callables return the `request_id` correlator and the terminal outcome
// arrives via the matching `group_*_update` webhook.

import { defineEndpoint, type EndpointInvokeOptions } from "../../endpoint.js";
import type { GraphClient } from "../../client.js";
import type {
  CreateGroupBody,
  CreateGroupParams,
  GetGroupParams,
  GroupDetails,
  GroupIdParams,
  GroupInviteLinkResponse,
  GroupJoinRequestsResponse,
  GroupMutationResponse,
  ListGroupJoinRequestsParams,
  ListGroupsParams,
  ListGroupsResponse,
  ManageGroupJoinRequestsBody,
  RemoveGroupParticipantsBody,
  UpdateGroupBody
} from "./types.js";
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_MAX_JOIN_REQUESTS,
  GROUP_MAX_PARTICIPANTS,
  GROUP_SUBJECT_MAX_LENGTH,
  groupAssertPlainRecord,
  groupError,
  groupJoinApprovalMode,
  groupMaybeString,
  groupPathParam,
  groupString,
  groupStringArray
} from "./shared.js";

type WireBody = Record<string, unknown>;

// --- body builders ------------------------------------------------------

function buildCreateGroupBody(body: CreateGroupBody): WireBody {
  const record = groupAssertPlainRecord(body, "createGroup");
  const out: WireBody = {
    messaging_product: "whatsapp",
    subject: groupString(record.subject, "subject", "createGroup", GROUP_SUBJECT_MAX_LENGTH)
  };
  const description = groupMaybeString(record.description, "description", "createGroup", GROUP_DESCRIPTION_MAX_LENGTH);
  if (description !== undefined) out.description = description;
  const mode = groupJoinApprovalMode(record.joinApprovalMode, "createGroup");
  if (mode !== undefined) out.join_approval_mode = mode;
  return out;
}

function buildUpdateGroupBody(body: UpdateGroupBody): WireBody {
  const record = groupAssertPlainRecord(body, "updateGroup");
  const out: WireBody = { messaging_product: "whatsapp" };
  const subject = groupMaybeString(record.subject, "subject", "updateGroup", GROUP_SUBJECT_MAX_LENGTH);
  if (subject !== undefined) out.subject = subject;
  const description = groupMaybeString(record.description, "description", "updateGroup", GROUP_DESCRIPTION_MAX_LENGTH);
  if (description !== undefined) out.description = description;
  const mode = groupJoinApprovalMode(record.joinApprovalMode, "updateGroup");
  if (mode !== undefined) out.join_approval_mode = mode;
  if (Object.keys(out).length === 1) {
    throw groupError(
      "Invalid updateGroup input: at least one of subject, description, or joinApprovalMode must be provided."
    );
  }
  return out;
}

function buildManageJoinRequestsBody(
  body: ManageGroupJoinRequestsBody,
  action: "approve" | "reject",
  helperName: string
): WireBody {
  const record = groupAssertPlainRecord(body, helperName);
  const ids = groupStringArray(record.joinRequestIds, "joinRequestIds", helperName, 1, GROUP_MAX_JOIN_REQUESTS);
  return {
    messaging_product: "whatsapp",
    action,
    join_requests: ids.map((id) => ({ join_request_id: id }))
  };
}

function buildRemoveParticipantsBody(body: RemoveGroupParticipantsBody): WireBody {
  const record = groupAssertPlainRecord(body, "removeGroupParticipants");
  const waIds = groupStringArray(record.waIds, "waIds", "removeGroupParticipants", 1, GROUP_MAX_PARTICIPANTS);
  return {
    messaging_product: "whatsapp",
    action: "remove",
    participants: waIds.map((wa) => ({ wa_id: wa }))
  };
}

// --- endpoints ----------------------------------------------------------

const createGroupRaw = defineEndpoint<{ phoneNumberId: string }, WireBody, GroupMutationResponse>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/groups",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

export const createGroup = Object.assign(
  async function createGroup(
    client: GraphClient,
    params: CreateGroupParams,
    body: CreateGroupBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return createGroupRaw(
      client,
      { phoneNumberId: groupPathParam(params, "createGroup", "phoneNumberId") },
      buildCreateGroupBody(body),
      opts
    );
  },
  { definition: createGroupRaw.definition }
);

const listGroupsRaw = defineEndpoint<
  { phoneNumberId: string; limit?: string; after?: string; before?: string },
  never,
  ListGroupsResponse
>({
  method: "GET",
  pathTemplate: "/{phoneNumberId}/groups",
  params: {
    phoneNumberId: { in: "path", required: true },
    limit: { in: "query" },
    after: { in: "query" },
    before: { in: "query" }
  }
});

export const listGroups = Object.assign(
  async function listGroups(
    client: GraphClient,
    params: ListGroupsParams,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<ListGroupsResponse> {
    const record = groupAssertPlainRecord(params, "listGroups", "params");
    const query: { phoneNumberId: string; limit?: string; after?: string; before?: string } = {
      phoneNumberId: groupPathParam(params, "listGroups", "phoneNumberId")
    };
    if (record.limit !== undefined) {
      query.limit = groupString(record.limit, "limit", "listGroups", 32);
    }
    if (record.after !== undefined) {
      query.after = groupString(record.after, "after", "listGroups", 4096);
    }
    if (record.before !== undefined) {
      query.before = groupString(record.before, "before", "listGroups", 4096);
    }
    return listGroupsRaw(client, query, body, opts);
  },
  { definition: listGroupsRaw.definition }
);

const getGroupRaw = defineEndpoint<{ groupId: string; fields?: string }, never, GroupDetails>({
  method: "GET",
  pathTemplate: "/{groupId}",
  params: { groupId: { in: "path", required: true }, fields: { in: "query" } }
});

export const getGroup = Object.assign(
  async function getGroup(
    client: GraphClient,
    params: GetGroupParams,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<GroupDetails> {
    const record = groupAssertPlainRecord(params, "getGroup", "params");
    const query: { groupId: string; fields?: string } = {
      groupId: groupPathParam(params, "getGroup", "groupId")
    };
    if (record.fields !== undefined) {
      query.fields = groupString(record.fields, "fields", "getGroup", 4096);
    }
    return getGroupRaw(client, query, body, opts);
  },
  { definition: getGroupRaw.definition }
);

const updateGroupRaw = defineEndpoint<{ groupId: string }, WireBody, GroupMutationResponse>({
  method: "POST",
  pathTemplate: "/{groupId}",
  params: { groupId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

export const updateGroup = Object.assign(
  async function updateGroup(
    client: GraphClient,
    params: GroupIdParams,
    body: UpdateGroupBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return updateGroupRaw(
      client,
      { groupId: groupPathParam(params, "updateGroup", "groupId") },
      buildUpdateGroupBody(body),
      opts
    );
  },
  { definition: updateGroupRaw.definition }
);

const deleteGroupRaw = defineEndpoint<{ groupId: string }, never, GroupMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{groupId}",
  params: { groupId: { in: "path", required: true } }
});

export const deleteGroup = Object.assign(
  async function deleteGroup(
    client: GraphClient,
    params: GroupIdParams,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return deleteGroupRaw(
      client,
      { groupId: groupPathParam(params, "deleteGroup", "groupId") },
      body,
      opts
    );
  },
  { definition: deleteGroupRaw.definition }
);

const getGroupInviteLinkRaw = defineEndpoint<{ groupId: string }, never, GroupInviteLinkResponse>({
  method: "GET",
  pathTemplate: "/{groupId}/invite_link",
  params: { groupId: { in: "path", required: true } }
});

export const getGroupInviteLink = Object.assign(
  async function getGroupInviteLink(
    client: GraphClient,
    params: GroupIdParams,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<GroupInviteLinkResponse> {
    return getGroupInviteLinkRaw(
      client,
      { groupId: groupPathParam(params, "getGroupInviteLink", "groupId") },
      body,
      opts
    );
  },
  { definition: getGroupInviteLinkRaw.definition }
);

const resetGroupInviteLinkRaw = defineEndpoint<{ groupId: string }, WireBody, GroupInviteLinkResponse>({
  method: "POST",
  pathTemplate: "/{groupId}/invite_link",
  params: { groupId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

export const resetGroupInviteLink = Object.assign(
  async function resetGroupInviteLink(
    client: GraphClient,
    params: GroupIdParams,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<GroupInviteLinkResponse> {
    return resetGroupInviteLinkRaw(
      client,
      { groupId: groupPathParam(params, "resetGroupInviteLink", "groupId") },
      { messaging_product: "whatsapp" },
      opts
    );
  },
  { definition: resetGroupInviteLinkRaw.definition }
);

const listGroupJoinRequestsRaw = defineEndpoint<
  { groupId: string; limit?: string; after?: string },
  never,
  GroupJoinRequestsResponse
>({
  method: "GET",
  pathTemplate: "/{groupId}/join_requests",
  params: {
    groupId: { in: "path", required: true },
    limit: { in: "query" },
    after: { in: "query" }
  }
});

export const listGroupJoinRequests = Object.assign(
  async function listGroupJoinRequests(
    client: GraphClient,
    params: ListGroupJoinRequestsParams,
    body?: never,
    opts?: EndpointInvokeOptions
  ): Promise<GroupJoinRequestsResponse> {
    const record = groupAssertPlainRecord(params, "listGroupJoinRequests", "params");
    const query: { groupId: string; limit?: string; after?: string } = {
      groupId: groupPathParam(params, "listGroupJoinRequests", "groupId")
    };
    if (record.limit !== undefined) {
      query.limit = groupString(record.limit, "limit", "listGroupJoinRequests", 32);
    }
    if (record.after !== undefined) {
      query.after = groupString(record.after, "after", "listGroupJoinRequests", 4096);
    }
    return listGroupJoinRequestsRaw(client, query, body, opts);
  },
  { definition: listGroupJoinRequestsRaw.definition }
);

const approveGroupJoinRequestsRaw = defineEndpoint<{ groupId: string }, WireBody, GroupMutationResponse>({
  method: "POST",
  pathTemplate: "/{groupId}/join_requests",
  params: { groupId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

const rejectGroupJoinRequestsRaw = defineEndpoint<{ groupId: string }, WireBody, GroupMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{groupId}/join_requests",
  params: { groupId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

export const approveGroupJoinRequests = Object.assign(
  async function approveGroupJoinRequests(
    client: GraphClient,
    params: GroupIdParams,
    body: ManageGroupJoinRequestsBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return approveGroupJoinRequestsRaw(
      client,
      { groupId: groupPathParam(params, "approveGroupJoinRequests", "groupId") },
      buildManageJoinRequestsBody(body, "approve", "approveGroupJoinRequests"),
      opts
    );
  },
  { definition: approveGroupJoinRequestsRaw.definition }
);

export const rejectGroupJoinRequests = Object.assign(
  async function rejectGroupJoinRequests(
    client: GraphClient,
    params: GroupIdParams,
    body: ManageGroupJoinRequestsBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return rejectGroupJoinRequestsRaw(
      client,
      { groupId: groupPathParam(params, "rejectGroupJoinRequests", "groupId") },
      buildManageJoinRequestsBody(body, "reject", "rejectGroupJoinRequests"),
      opts
    );
  },
  { definition: rejectGroupJoinRequestsRaw.definition }
);

const removeGroupParticipantsRaw = defineEndpoint<{ groupId: string }, WireBody, GroupMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{groupId}/participants",
  params: { groupId: { in: "path", required: true } },
  bodyContentType: "application/json"
});

export const removeGroupParticipants = Object.assign(
  async function removeGroupParticipants(
    client: GraphClient,
    params: GroupIdParams,
    body: RemoveGroupParticipantsBody,
    opts?: EndpointInvokeOptions
  ): Promise<GroupMutationResponse> {
    return removeGroupParticipantsRaw(
      client,
      { groupId: groupPathParam(params, "removeGroupParticipants", "groupId") },
      buildRemoveParticipantsBody(body),
      opts
    );
  },
  { definition: removeGroupParticipantsRaw.definition }
);
