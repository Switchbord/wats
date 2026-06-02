// WATS-136 public Groups response normalizers.
//
// Endpoint callables still send snake_case to Meta's Graph API, but public
// scoped-client/facade responses expose WATS' camelCase API contract.

import type {
  GroupDetails,
  GroupInviteLinkResponse,
  GroupJoinRequestsResponse,
  GroupMutationResponse,
  ListGroupsResponse
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact<T extends JsonRecord>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return record;
}

function camelCaseKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, ch: string) => ch.toUpperCase());
}

function normalizeJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonKeys);
  if (!isRecord(value)) return value;
  const out: JsonRecord = {};
  for (const [key, nested] of Object.entries(value)) {
    out[camelCaseKey(key)] = normalizeJsonKeys(nested);
  }
  return out;
}

function normalizeParticipant(value: unknown): { readonly waId?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const out: { waId?: string } = {};
  if (typeof value.waId === "string") out.waId = value.waId;
  else if (typeof value.wa_id === "string") out.waId = value.wa_id;
  return out;
}

export function normalizeGroupMutationResponse(response: GroupMutationResponse): GroupMutationResponse {
  if (!isRecord(response)) return response;
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(response)) {
    if (key === "request_id") out.requestId = value;
    else out[camelCaseKey(key)] = normalizeJsonKeys(value);
  }
  return out as GroupMutationResponse;
}

export function normalizeGroupDetailsResponse(response: GroupDetails): GroupDetails {
  if (!isRecord(response)) return response;
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(response)) {
    switch (key) {
      case "join_approval_mode":
        out.joinApprovalMode = value;
        break;
      case "creation_timestamp":
        out.creationTimestamp = value;
        break;
      case "total_participant_count":
        out.totalParticipantCount = value;
        break;
      case "participants":
        out.participants = Array.isArray(value) ? value.map(normalizeParticipant).filter(Boolean) : value;
        break;
      default:
        out[camelCaseKey(key)] = normalizeJsonKeys(value);
    }
  }
  return out as GroupDetails;
}

function normalizeGroupSummary(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const out: JsonRecord = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "created_at" || key === "createdAt") out.createdAt = nested;
    else out[camelCaseKey(key)] = normalizeJsonKeys(nested);
  }
  return out;
}

function normalizeJoinRequest(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const out: JsonRecord = {};
  for (const [key, nested] of Object.entries(value)) {
    switch (key) {
      case "join_request_id":
      case "joinRequestId":
        out.joinRequestId = nested;
        break;
      case "wa_id":
      case "waId":
        out.waId = nested;
        break;
      case "creation_timestamp":
      case "creationTimestamp":
        out.creationTimestamp = nested;
        break;
      default:
        out[camelCaseKey(key)] = normalizeJsonKeys(nested);
    }
  }
  return out;
}

export function normalizeGroupInviteLinkResponse(response: GroupInviteLinkResponse): GroupInviteLinkResponse {
  if (!isRecord(response)) return response;
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(response)) {
    if (key === "invite_link") out.inviteLink = value;
    else out[camelCaseKey(key)] = normalizeJsonKeys(value);
  }
  return out as GroupInviteLinkResponse;
}

export function normalizeListGroupsResponse(response: ListGroupsResponse): ListGroupsResponse {
  if (!isRecord(response)) return response;
  const out = normalizeJsonKeys(response) as JsonRecord;
  const data = response.data;
  if (Array.isArray(data)) {
    out.data = data.map(normalizeGroupSummary).filter(Boolean);
  } else if (isRecord(data) && Array.isArray(data.groups)) {
    out.data = { ...data, groups: data.groups.map(normalizeGroupSummary).filter(Boolean) };
  }
  return out as ListGroupsResponse;
}

export function normalizeGroupJoinRequestsResponse(response: GroupJoinRequestsResponse): GroupJoinRequestsResponse {
  if (!isRecord(response)) return response;
  const out = normalizeJsonKeys(response) as JsonRecord;
  if (Array.isArray(response.data)) {
    out.data = response.data.map(normalizeJoinRequest).filter(Boolean);
  }
  return out as GroupJoinRequestsResponse;
}
