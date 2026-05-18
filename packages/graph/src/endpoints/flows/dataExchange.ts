// WATS-66 WhatsApp Flow data-exchange response builders.

import type {
  FlowCloseResponse,
  FlowCloseResponseInput,
  FlowErrorResponse,
  FlowErrorResponseInput,
  FlowScreenResponse,
  FlowScreenResponseInput
} from "./types.js";
import { flowAssertPlainRecord, flowMaybeString, flowString } from "./shared.js";
import { flowJsonClone } from "./flowJson.js";

function cloneFlowResponseData(value: unknown, helperName: string): unknown {
  if (value === undefined) return undefined;
  return flowJsonClone(value, helperName, "data", { seen: new WeakSet<object>(), componentCount: 0 }, 0);
}

export function buildFlowScreenResponse(input: FlowScreenResponseInput): FlowScreenResponse {
  const record = flowAssertPlainRecord(input, "buildFlowScreenResponse");
  const out: Record<string, unknown> = { screen: flowString(record.screen, "screen", "buildFlowScreenResponse", 256) };
  const data = cloneFlowResponseData(record.data, "buildFlowScreenResponse");
  if (data !== undefined) out.data = data;
  const token = flowMaybeString(record.flowToken, "flowToken", "buildFlowScreenResponse", 2_048);
  if (token !== undefined) out.flow_token = token;
  return out as unknown as FlowScreenResponse;
}

export function buildFlowCloseResponse(input: FlowCloseResponseInput = {}): FlowCloseResponse {
  const record = flowAssertPlainRecord(input, "buildFlowCloseResponse");
  const out: Record<string, unknown> = { close_flow: true };
  const data = cloneFlowResponseData(record.data, "buildFlowCloseResponse");
  if (data !== undefined) out.data = data;
  const token = flowMaybeString(record.flowToken, "flowToken", "buildFlowCloseResponse", 2_048);
  if (token !== undefined) out.flow_token = token;
  return out as unknown as FlowCloseResponse;
}

export function buildFlowErrorResponse(input: FlowErrorResponseInput): FlowErrorResponse {
  const record = flowAssertPlainRecord(input, "buildFlowErrorResponse");
  const out: Record<string, unknown> = { error: flowString(record.error, "error", "buildFlowErrorResponse", 256) };
  const message = flowMaybeString(record.errorMessage, "errorMessage", "buildFlowErrorResponse", 2_048);
  if (message !== undefined) out.error_message = message;
  const token = flowMaybeString(record.flowToken, "flowToken", "buildFlowErrorResponse", 2_048);
  if (token !== undefined) out.flow_token = token;
  return out as unknown as FlowErrorResponse;
}
