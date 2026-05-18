// WATS-66 WhatsApp Flow Graph endpoint callables.

import { defineEndpoint } from "../../endpoint.js";
import type {
  CreateFlowBody,
  FlowAssetsResponse,
  FlowDetails,
  FlowListResponse,
  FlowMutationResponse,
  GetFlowAssetsInput,
  GetFlowInput,
  ListFlowsInput,
  UpdateFlowJsonBody,
  UpdateFlowMetadataBody
} from "./types.js";
import {
  flowNormalizePathParams,
  mapCreateFlowBody,
  mapUpdateFlowJsonBody,
  mapUpdateFlowMetadataBody,
  normalizeFlowAssetsParams,
  normalizeGetFlowParams,
  normalizeListFlowsParams
} from "./flowJson.js";

const listFlowsRaw = defineEndpoint<
  { wabaId: string; fields?: string; status?: string; name?: string; invalidate_preview?: string; phone_number_id?: string; limit?: string; after?: string },
  never,
  FlowListResponse
>({
  method: "GET",
  pathTemplate: "/{wabaId}/flows",
  params: {
    wabaId: { in: "path", required: true },
    fields: { in: "query" },
    status: { in: "query" },
    name: { in: "query" },
    invalidate_preview: { in: "query" },
    phone_number_id: { in: "query" },
    limit: { in: "query" },
    after: { in: "query" }
  }
});

export const listFlows = Object.assign(
  async function listFlows(client: Parameters<typeof listFlowsRaw>[0], params: ListFlowsInput, body?: never, opts?: Parameters<typeof listFlowsRaw>[3]) {
    return listFlowsRaw(client, normalizeListFlowsParams(params) as Parameters<typeof listFlowsRaw>[1], body, opts);
  },
  { definition: listFlowsRaw.definition }
) as unknown as {
  (client: Parameters<typeof listFlowsRaw>[0], params: ListFlowsInput, body?: never, opts?: Parameters<typeof listFlowsRaw>[3]): Promise<FlowListResponse>;
  readonly definition: typeof listFlowsRaw.definition;
};

const getFlowRaw = defineEndpoint<{ flowId: string; fields?: string; invalidate_preview?: string; phone_number_id?: string }, never, FlowDetails>({
  method: "GET",
  pathTemplate: "/{flowId}",
  params: { flowId: { in: "path", required: true }, fields: { in: "query" }, invalidate_preview: { in: "query" }, phone_number_id: { in: "query" } }
});

export const getFlow = Object.assign(
  async function getFlow(client: Parameters<typeof getFlowRaw>[0], params: GetFlowInput, body?: never, opts?: Parameters<typeof getFlowRaw>[3]) {
    return getFlowRaw(client, normalizeGetFlowParams(params) as Parameters<typeof getFlowRaw>[1], body, opts);
  },
  { definition: getFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof getFlowRaw>[0], params: GetFlowInput, body?: never, opts?: Parameters<typeof getFlowRaw>[3]): Promise<FlowDetails>;
  readonly definition: typeof getFlowRaw.definition;
};

const createFlowRaw = defineEndpoint<{ wabaId: string }, CreateFlowBody, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{wabaId}/flows",
  params: { wabaId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: mapCreateFlowBody
});

export const createFlow = Object.assign(
  async function createFlow(client: Parameters<typeof createFlowRaw>[0], params: { readonly wabaId: string }, body: CreateFlowBody, opts?: Parameters<typeof createFlowRaw>[3]) {
    return createFlowRaw(client, flowNormalizePathParams(params, "createFlow", "wabaId") as Parameters<typeof createFlowRaw>[1], body, opts);
  },
  { definition: createFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof createFlowRaw>[0], params: { readonly wabaId: string }, body: CreateFlowBody, opts?: Parameters<typeof createFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof createFlowRaw.definition;
};

const updateFlowMetadataRaw = defineEndpoint<{ flowId: string }, UpdateFlowMetadataBody, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}",
  params: { flowId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: mapUpdateFlowMetadataBody
});

export const updateFlowMetadata = Object.assign(
  async function updateFlowMetadata(client: Parameters<typeof updateFlowMetadataRaw>[0], params: { readonly flowId: string }, body: UpdateFlowMetadataBody, opts?: Parameters<typeof updateFlowMetadataRaw>[3]) {
    return updateFlowMetadataRaw(client, flowNormalizePathParams(params, "updateFlowMetadata", "flowId") as Parameters<typeof updateFlowMetadataRaw>[1], body, opts);
  },
  { definition: updateFlowMetadataRaw.definition }
) as unknown as {
  (client: Parameters<typeof updateFlowMetadataRaw>[0], params: { readonly flowId: string }, body: UpdateFlowMetadataBody, opts?: Parameters<typeof updateFlowMetadataRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof updateFlowMetadataRaw.definition;
};

const updateFlowJsonRaw = defineEndpoint<{ flowId: string }, UpdateFlowJsonBody, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}/assets",
  params: { flowId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: mapUpdateFlowJsonBody
});

export const updateFlowJson = Object.assign(
  async function updateFlowJson(client: Parameters<typeof updateFlowJsonRaw>[0], params: { readonly flowId: string }, body: UpdateFlowJsonBody, opts?: Parameters<typeof updateFlowJsonRaw>[3]) {
    return updateFlowJsonRaw(client, flowNormalizePathParams(params, "updateFlowJson", "flowId") as Parameters<typeof updateFlowJsonRaw>[1], body, opts);
  },
  { definition: updateFlowJsonRaw.definition }
) as unknown as {
  (client: Parameters<typeof updateFlowJsonRaw>[0], params: { readonly flowId: string }, body: UpdateFlowJsonBody, opts?: Parameters<typeof updateFlowJsonRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof updateFlowJsonRaw.definition;
};

const publishFlowRaw = defineEndpoint<{ flowId: string }, never, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}/publish",
  params: { flowId: { in: "path", required: true } }
});

export const publishFlow = Object.assign(
  async function publishFlow(client: Parameters<typeof publishFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof publishFlowRaw>[3]) {
    return publishFlowRaw(client, flowNormalizePathParams(params, "publishFlow", "flowId") as Parameters<typeof publishFlowRaw>[1], body, opts);
  },
  { definition: publishFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof publishFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof publishFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof publishFlowRaw.definition;
};

const deleteFlowRaw = defineEndpoint<{ flowId: string }, never, FlowMutationResponse>({
  method: "DELETE",
  pathTemplate: "/{flowId}",
  params: { flowId: { in: "path", required: true } }
});

export const deleteFlow = Object.assign(
  async function deleteFlow(client: Parameters<typeof deleteFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deleteFlowRaw>[3]) {
    return deleteFlowRaw(client, flowNormalizePathParams(params, "deleteFlow", "flowId") as Parameters<typeof deleteFlowRaw>[1], body, opts);
  },
  { definition: deleteFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof deleteFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deleteFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof deleteFlowRaw.definition;
};

const deprecateFlowRaw = defineEndpoint<{ flowId: string }, never, FlowMutationResponse>({
  method: "POST",
  pathTemplate: "/{flowId}/deprecate",
  params: { flowId: { in: "path", required: true } }
});

export const deprecateFlow = Object.assign(
  async function deprecateFlow(client: Parameters<typeof deprecateFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deprecateFlowRaw>[3]) {
    return deprecateFlowRaw(client, flowNormalizePathParams(params, "deprecateFlow", "flowId") as Parameters<typeof deprecateFlowRaw>[1], body, opts);
  },
  { definition: deprecateFlowRaw.definition }
) as unknown as {
  (client: Parameters<typeof deprecateFlowRaw>[0], params: { readonly flowId: string }, body?: never, opts?: Parameters<typeof deprecateFlowRaw>[3]): Promise<FlowMutationResponse>;
  readonly definition: typeof deprecateFlowRaw.definition;
};

const getFlowAssetsRaw = defineEndpoint<{ flowId: string; fields?: string; limit?: string; after?: string }, never, FlowAssetsResponse>({
  method: "GET",
  pathTemplate: "/{flowId}/assets",
  params: { flowId: { in: "path", required: true }, fields: { in: "query" }, limit: { in: "query" }, after: { in: "query" } }
});

export const getFlowAssets = Object.assign(
  async function getFlowAssets(client: Parameters<typeof getFlowAssetsRaw>[0], params: GetFlowAssetsInput, body?: never, opts?: Parameters<typeof getFlowAssetsRaw>[3]) {
    return getFlowAssetsRaw(client, normalizeFlowAssetsParams(params) as Parameters<typeof getFlowAssetsRaw>[1], body, opts);
  },
  { definition: getFlowAssetsRaw.definition }
) as unknown as {
  (client: Parameters<typeof getFlowAssetsRaw>[0], params: GetFlowAssetsInput, body?: never, opts?: Parameters<typeof getFlowAssetsRaw>[3]): Promise<FlowAssetsResponse>;
  readonly definition: typeof getFlowAssetsRaw.definition;
};
