// WATS-94 message-template group and template-group analytics endpoints.

import { defineEndpoint } from "../../endpoint.js";
import type { EndpointInvokeOptions } from "../../endpoint.js";
import type { GraphPaging } from "../waba/types.js";
import { assertArray, assertPlainRecord, assertString, maybeString, safeJsonClone, validationError } from "./shared.js";

export interface TemplateGroupDetails {
  readonly id?: string;
  readonly name?: string;
  readonly category?: string;
  readonly language?: string;
  readonly status?: string;
  readonly template_ids?: readonly string[];
  readonly [key: string]: unknown;
}

export interface TemplateGroupListResponse {
  readonly data?: readonly TemplateGroupDetails[];
  readonly paging?: GraphPaging;
}

export interface TemplateGroupMutationResponse {
  readonly id?: string;
  readonly success?: boolean;
  readonly [key: string]: unknown;
}

export interface TemplateGroupAnalyticsPoint {
  readonly template_group_id?: string;
  readonly [key: string]: unknown;
}

export interface TemplateGroupAnalyticsResponse {
  readonly data?: readonly TemplateGroupAnalyticsPoint[];
  readonly paging?: GraphPaging;
  readonly [key: string]: unknown;
}

export interface ListTemplateGroupsInput {
  readonly wabaId: string;
  readonly fields?: string;
  readonly limit?: string;
  readonly after?: string;
  readonly before?: string;
}

export interface GetTemplateGroupInput {
  readonly templateGroupId: string;
  readonly fields?: string;
}

export interface TemplateGroupBody {
  readonly name?: string;
  readonly category?: string;
  readonly language?: string;
  readonly templateIds?: readonly string[];
  readonly [key: string]: unknown;
}

export interface CreateTemplateGroupBody extends TemplateGroupBody {
  readonly name: string;
}

export type UpdateTemplateGroupBody = TemplateGroupBody;

export interface DeleteTemplateGroupInput {
  readonly templateGroupId: string;
}

export interface TemplateGroupAnalyticsInput {
  readonly wabaId: string;
  readonly templateGroupId?: string;
  readonly start?: string;
  readonly end?: string;
  readonly granularity?: string;
  readonly metricTypes?: readonly string[];
  readonly [key: string]: unknown;
}

function normalizeOptionalQuery(record: Record<string, unknown>, helperName: string, map: readonly (readonly [string, string])[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [publicKey, graphKey] of map) {
    if (record[publicKey] !== undefined) out[graphKey] = assertString(record[publicKey], publicKey, helperName);
  }
  return out;
}

function normalizeListTemplateGroupsParams(input: ListTemplateGroupsInput): Record<string, string> {
  const helperName = "listTemplateGroups";
  const record = assertPlainRecord(input, helperName);
  return {
    wabaId: assertString(record.wabaId, "wabaId", helperName),
    ...normalizeOptionalQuery(record, helperName, [
      ["fields", "fields"],
      ["limit", "limit"],
      ["after", "after"],
      ["before", "before"]
    ])
  };
}

function normalizeGetTemplateGroupParams(input: GetTemplateGroupInput): Record<string, string> {
  const helperName = "getTemplateGroup";
  const record = assertPlainRecord(input, helperName);
  return {
    templateGroupId: assertString(record.templateGroupId, "templateGroupId", helperName),
    ...normalizeOptionalQuery(record, helperName, [["fields", "fields"]])
  };
}

function normalizeTemplateGroupIdParams(input: DeleteTemplateGroupInput, helperName: string): Record<string, string> {
  const record = assertPlainRecord(input, helperName);
  return { templateGroupId: assertString(record.templateGroupId, "templateGroupId", helperName) };
}

function mapTemplateIds(value: unknown, helperName: string): readonly string[] {
  const arr = assertArray(value, "templateIds", 1, 200, helperName);
  return arr.map((item, index) => assertString(item, `templateIds[${index}]`, helperName));
}

function buildTemplateGroupBody(input: TemplateGroupBody, helperName: string, requireName: boolean): Record<string, unknown> {
  const record = assertPlainRecord(input, helperName);
  const out: Record<string, unknown> = {};
  if (requireName || record.name !== undefined) out.name = assertString(record.name, "name", helperName);
  const category = maybeString(record.category, "category", helperName, 64);
  const language = maybeString(record.language, "language", helperName, 64);
  if (category !== undefined) out.category = category;
  if (language !== undefined) out.language = language;
  if (record.templateIds !== undefined) out.template_ids = mapTemplateIds(record.templateIds, helperName);
  for (const [key, value] of Object.entries(record)) {
    if (["name", "category", "language", "templateIds"].includes(key) || value === undefined) continue;
    out[key] = safeJsonClone(value, helperName, key);
  }
  return out;
}

function buildCreateTemplateGroupBody(input: CreateTemplateGroupBody): Record<string, unknown> {
  return buildTemplateGroupBody(input, "createTemplateGroup", true);
}

function buildUpdateTemplateGroupBody(input: UpdateTemplateGroupBody): Record<string, unknown> {
  const body = buildTemplateGroupBody(input, "updateTemplateGroup", false);
  if (Object.keys(body).length === 0) throw validationError("Invalid updateTemplateGroup input: at least one body field is required.");
  return body;
}

function normalizeTemplateGroupAnalyticsParams(input: TemplateGroupAnalyticsInput): Record<string, string> {
  const helperName = "getTemplateGroupAnalytics";
  const record = assertPlainRecord(input, helperName);
  const out: Record<string, string> = { wabaId: assertString(record.wabaId, "wabaId", helperName) };
  const simple = normalizeOptionalQuery(record, helperName, [
    ["templateGroupId", "template_group_id"],
    ["start", "start"],
    ["end", "end"],
    ["granularity", "granularity"]
  ]);
  Object.assign(out, simple);
  if (record.metricTypes !== undefined) {
    const arr = assertArray(record.metricTypes, "metricTypes", 1, 50, helperName);
    out.metric_types = arr.map((item, index) => assertString(item, `metricTypes[${index}]`, helperName)).join(",");
  }
  for (const [key, value] of Object.entries(record)) {
    if (["wabaId", "templateGroupId", "start", "end", "granularity", "metricTypes"].includes(key) || value === undefined) continue;
    out[key] = assertString(value, key, helperName);
  }
  return out;
}

const listTemplateGroupsRaw = defineEndpoint<
  { wabaId: string; fields?: string; limit?: string; after?: string; before?: string },
  never,
  TemplateGroupListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/template_groups",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" },
    before: { in: "query" }
  }
});

const createTemplateGroupRaw = defineEndpoint<{ wabaId: string }, CreateTemplateGroupBody, TemplateGroupMutationResponse>({
  method: "POST",
  pathTemplate: "/{wabaId}/template_groups",
  params: { wabaId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildCreateTemplateGroupBody
});

const getTemplateGroupRaw = defineEndpoint<{ templateGroupId: string; fields?: string }, never, TemplateGroupDetails>({
  method: "GET",
  pathTemplate: "/{templateGroupId}",
  params: { templateGroupId: { in: "path", required: true }, fields: { in: "query" } }
});

const updateTemplateGroupRaw = defineEndpoint<{ templateGroupId: string }, UpdateTemplateGroupBody, TemplateGroupMutationResponse>({
  method: "POST",
  pathTemplate: "/{templateGroupId}",
  params: { templateGroupId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUpdateTemplateGroupBody
});

const deleteTemplateGroupRaw = defineEndpoint<{ templateGroupId: string }, never, TemplateGroupMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{templateGroupId}",
  params: { templateGroupId: { in: "path", required: true } }
});

const getTemplateGroupAnalyticsRaw = defineEndpoint<
  Record<string, string> & { wabaId: string },
  never,
  TemplateGroupAnalyticsResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/template_group_analytics",
  params: {
    wabaId: { in: "path", required: true },
    template_group_id: { in: "query" },
    start: { in: "query" },
    end: { in: "query" },
    granularity: { in: "query" },
    metric_types: { in: "query" }
  }
});

export const listTemplateGroups = Object.assign(
  async function listTemplateGroups(client: Parameters<typeof listTemplateGroupsRaw>[0], params: ListTemplateGroupsInput, body?: never, opts?: EndpointInvokeOptions): Promise<TemplateGroupListResponse> {
    return listTemplateGroupsRaw(client, normalizeListTemplateGroupsParams(params) as Parameters<typeof listTemplateGroupsRaw>[1], body, opts);
  },
  { definition: listTemplateGroupsRaw.definition }
);

export const createTemplateGroup = Object.assign(
  async function createTemplateGroup(client: Parameters<typeof createTemplateGroupRaw>[0], params: { readonly wabaId: string }, body: CreateTemplateGroupBody, opts?: EndpointInvokeOptions): Promise<TemplateGroupMutationResponse> {
    const record = assertPlainRecord(params, "createTemplateGroup", "params");
    return createTemplateGroupRaw(client, { wabaId: assertString(record.wabaId, "wabaId", "createTemplateGroup") }, body, opts);
  },
  { definition: createTemplateGroupRaw.definition }
);

export const getTemplateGroup = Object.assign(
  async function getTemplateGroup(client: Parameters<typeof getTemplateGroupRaw>[0], params: GetTemplateGroupInput, body?: never, opts?: EndpointInvokeOptions): Promise<TemplateGroupDetails> {
    return getTemplateGroupRaw(client, normalizeGetTemplateGroupParams(params) as Parameters<typeof getTemplateGroupRaw>[1], body, opts);
  },
  { definition: getTemplateGroupRaw.definition }
);

export const updateTemplateGroup = Object.assign(
  async function updateTemplateGroup(client: Parameters<typeof updateTemplateGroupRaw>[0], params: { readonly templateGroupId: string }, body: UpdateTemplateGroupBody, opts?: EndpointInvokeOptions): Promise<TemplateGroupMutationResponse> {
    return updateTemplateGroupRaw(client, normalizeTemplateGroupIdParams(params, "updateTemplateGroup") as Parameters<typeof updateTemplateGroupRaw>[1], body, opts);
  },
  { definition: updateTemplateGroupRaw.definition }
);

export const deleteTemplateGroup = Object.assign(
  async function deleteTemplateGroup(client: Parameters<typeof deleteTemplateGroupRaw>[0], params: DeleteTemplateGroupInput, body?: never, opts?: EndpointInvokeOptions): Promise<TemplateGroupMutationResponse> {
    return deleteTemplateGroupRaw(client, normalizeTemplateGroupIdParams(params, "deleteTemplateGroup") as Parameters<typeof deleteTemplateGroupRaw>[1], body, opts);
  },
  { definition: deleteTemplateGroupRaw.definition }
);

export const getTemplateGroupAnalytics = Object.assign(
  async function getTemplateGroupAnalytics(client: Parameters<typeof getTemplateGroupAnalyticsRaw>[0], params: TemplateGroupAnalyticsInput, body?: never, opts?: EndpointInvokeOptions): Promise<TemplateGroupAnalyticsResponse> {
    return getTemplateGroupAnalyticsRaw(client, normalizeTemplateGroupAnalyticsParams(params) as Parameters<typeof getTemplateGroupAnalyticsRaw>[1], body, opts);
  },
  { definition: getTemplateGroupAnalyticsRaw.definition }
);
