// WATS-65 message-template Graph endpoint callables.

import { defineEndpoint } from "../../endpoint";
import type { EndpointInvokeOptions } from "../../endpoint";
import type {
  CreateMessageTemplateBody,
  DeleteMessageTemplateInput,
  GetMessageTemplateInput,
  ListMessageTemplatesInput,
  TemplateDetails,
  TemplateListResponse,
  TemplateMutationResponse,
  UpdateMessageTemplateBody
} from "./types";
import { buildCreateMessageTemplateBody, buildUpdateMessageTemplateBody } from "./builders";
import { assertPlainRecord, assertString } from "./shared";


function normalizeListParams(input: ListMessageTemplatesInput): Record<string, string> {
  const record = assertPlainRecord(input, "listMessageTemplates");
  const out: Record<string, string> = { wabaId: assertString(record.wabaId, "wabaId", "listMessageTemplates") };
  for (const [publicKey, graphKey] of [
    ["fields", "fields"],
    ["status", "status"],
    ["category", "category"],
    ["language", "language"],
    ["name", "name"],
    ["content", "content"],
    ["nameOrContent", "name_or_content"],
    ["qualityScore", "quality_score"],
    ["limit", "limit"],
    ["after", "after"]
  ] as const) {
    if (record[publicKey] !== undefined) out[graphKey] = assertString(record[publicKey], publicKey, "listMessageTemplates");
  }
  return out;
}

function normalizeGetParams(input: GetMessageTemplateInput): Record<string, string> {
  const record = assertPlainRecord(input, "getMessageTemplate");
  const out: Record<string, string> = { templateId: assertString(record.templateId, "templateId", "getMessageTemplate") };
  if (record.fields !== undefined) out.fields = assertString(record.fields, "fields", "getMessageTemplate");
  return out;
}

function normalizeDeleteParams(input: DeleteMessageTemplateInput): Record<string, string> {
  const record = assertPlainRecord(input, "deleteMessageTemplate");
  const out: Record<string, string> = {
    wabaId: assertString(record.wabaId, "wabaId", "deleteMessageTemplate"),
    name: assertString(record.name, "name", "deleteMessageTemplate")
  };
  if (record.templateId !== undefined) out.hsm_id = assertString(record.templateId, "templateId", "deleteMessageTemplate");
  return out;
}

const listMessageTemplatesRaw = defineEndpoint<
  {
    wabaId: string;
    fields?: string;
    status?: string;
    category?: string;
    language?: string;
    name?: string;
    content?: string;
    name_or_content?: string;
    quality_score?: string;
    limit?: string;
    after?: string;
  },
  never,
  TemplateListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/message_templates",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    status: { in: "query" },
    category: { in: "query" },
    language: { in: "query" },
    name: { in: "query" },
    content: { in: "query" },
    name_or_content: { in: "query" },
    quality_score: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" }
  }
});

export const listMessageTemplates = Object.assign(
  async function listMessageTemplates(client: Parameters<typeof listMessageTemplatesRaw>[0], params: ListMessageTemplatesInput, body?: never, opts?: Parameters<typeof listMessageTemplatesRaw>[3]) {
    return listMessageTemplatesRaw(client, normalizeListParams(params) as Parameters<typeof listMessageTemplatesRaw>[1], body, opts);
  },
  { definition: listMessageTemplatesRaw.definition }
) as unknown as {
  (client: Parameters<typeof listMessageTemplatesRaw>[0], params: ListMessageTemplatesInput, body?: never, opts?: Parameters<typeof listMessageTemplatesRaw>[3]): Promise<TemplateListResponse>;
  readonly definition: typeof listMessageTemplatesRaw.definition;
};

const getMessageTemplateRaw = defineEndpoint<{ templateId: string; fields?: string }, never, TemplateDetails>({
  method: "GET",
  pathTemplate: "/{templateId}",
  params: { templateId: { in: "path", required: true }, fields: { in: "query" } }
});

export const getMessageTemplate = Object.assign(
  async function getMessageTemplate(client: Parameters<typeof getMessageTemplateRaw>[0], params: GetMessageTemplateInput, body?: never, opts?: Parameters<typeof getMessageTemplateRaw>[3]) {
    return getMessageTemplateRaw(client, normalizeGetParams(params) as Parameters<typeof getMessageTemplateRaw>[1], body, opts);
  },
  { definition: getMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof getMessageTemplateRaw>[0], params: GetMessageTemplateInput, body?: never, opts?: Parameters<typeof getMessageTemplateRaw>[3]): Promise<TemplateDetails>;
  readonly definition: typeof getMessageTemplateRaw.definition;
};

const createMessageTemplateRaw = defineEndpoint<
  { wabaId: string },
  CreateMessageTemplateBody,
  TemplateMutationResponse
>({
  method: "POST",
  pathTemplate: "/{wabaId}/message_templates",
  params: { wabaId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildCreateMessageTemplateBody
});

export const createMessageTemplate = Object.assign(
  async function createMessageTemplate(client: Parameters<typeof createMessageTemplateRaw>[0], params: { readonly wabaId: string }, body: CreateMessageTemplateBody, opts?: Parameters<typeof createMessageTemplateRaw>[3]) {
    const record = assertPlainRecord(params, "createMessageTemplate", "params");
    return createMessageTemplateRaw(client, { wabaId: assertString(record.wabaId, "wabaId", "createMessageTemplate") }, body, opts);
  },
  { definition: createMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof createMessageTemplateRaw>[0], params: { readonly wabaId: string }, body: CreateMessageTemplateBody, opts?: Parameters<typeof createMessageTemplateRaw>[3]): Promise<TemplateMutationResponse>;
  readonly definition: typeof createMessageTemplateRaw.definition;
};

const updateMessageTemplateRaw = defineEndpoint<
  { templateId: string },
  UpdateMessageTemplateBody,
  TemplateMutationResponse
>({
  method: "POST",
  pathTemplate: "/{templateId}",
  params: { templateId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildUpdateMessageTemplateBody
});

export const updateMessageTemplate = Object.assign(
  async function updateMessageTemplate(client: Parameters<typeof updateMessageTemplateRaw>[0], params: { readonly templateId: string }, body: UpdateMessageTemplateBody, opts?: Parameters<typeof updateMessageTemplateRaw>[3]) {
    const record = assertPlainRecord(params, "updateMessageTemplate", "params");
    return updateMessageTemplateRaw(client, { templateId: assertString(record.templateId, "templateId", "updateMessageTemplate") }, body, opts);
  },
  { definition: updateMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof updateMessageTemplateRaw>[0], params: { readonly templateId: string }, body: UpdateMessageTemplateBody, opts?: Parameters<typeof updateMessageTemplateRaw>[3]): Promise<TemplateMutationResponse>;
  readonly definition: typeof updateMessageTemplateRaw.definition;
};

const deleteMessageTemplateRaw = defineEndpoint<{ wabaId: string; name: string; hsm_id?: string }, never, TemplateMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{wabaId}/message_templates",
  params: { wabaId: { in: "path", required: true }, name: { in: "query", required: true }, hsm_id: { in: "query" } }
});

export const deleteMessageTemplate = Object.assign(
  async function deleteMessageTemplate(client: Parameters<typeof deleteMessageTemplateRaw>[0], params: DeleteMessageTemplateInput, body?: never, opts?: Parameters<typeof deleteMessageTemplateRaw>[3]) {
    return deleteMessageTemplateRaw(client, normalizeDeleteParams(params) as Parameters<typeof deleteMessageTemplateRaw>[1], body, opts);
  },
  { definition: deleteMessageTemplateRaw.definition }
) as unknown as {
  (client: Parameters<typeof deleteMessageTemplateRaw>[0], params: DeleteMessageTemplateInput, body?: never, opts?: Parameters<typeof deleteMessageTemplateRaw>[3]): Promise<TemplateMutationResponse>;
  readonly definition: typeof deleteMessageTemplateRaw.definition;
};
