// WATS-68 messages endpoint module split: endpoint callables and legacy compatibility class.

import type { GraphClient, GraphRequestOptions } from "../../client.js";
import { defineEndpoint, type EndpointInvokeOptions } from "../../endpoint.js";
import { GraphRequestValidationError } from "../../errors.js";
import type {
  GraphMessagesMarketingTemplateResponse,
  GraphMessagesSendBody,
  GraphMessagesSendMarketingTemplateInput,
  GraphMessagesSendMessageInput,
  GraphMessagesSendResponse,
  GraphMessagesTextPayload
} from "./types.js";
import { buildSendMarketingTemplatePayload } from "./builders-template.js";
import {
  assertNonEmptyControlFreeString,
  assertValidGroupId,
  rejectGroupRecipient
} from "./validation.js";

interface GraphRequestExecutor {
  request<TResponse>(options: GraphRequestOptions): Promise<TResponse>;
}

const sendMarketingTemplateEndpoint = defineEndpoint<
  { phoneNumberId: string },
  GraphMessagesSendMarketingTemplateInput,
  GraphMessagesMarketingTemplateResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/marketing_messages",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: buildSendMarketingTemplatePayload
});

export async function sendMarketingTemplate(
  client: GraphClient,
  params: { phoneNumberId: string },
  body: GraphMessagesSendMarketingTemplateInput,
  opts?: EndpointInvokeOptions
): Promise<GraphMessagesMarketingTemplateResponse> {
  if (body === undefined) {
    throw new GraphRequestValidationError("Invalid sendMarketingTemplate input: body is required.");
  }
  return sendMarketingTemplateEndpoint(client, params, body, opts);
}

sendMarketingTemplate.definition = sendMarketingTemplateEndpoint.definition;

export function buildSendMessagePayload(
  input: GraphMessagesSendMessageInput
): GraphMessagesTextPayload {
  const payload: GraphMessagesTextPayload = {
    messaging_product: "whatsapp",
    to: input.to,
    type: "text",
    text: {
      body: input.text
    }
  };

  if (typeof input.previewUrl === "boolean") {
    payload.text.preview_url = input.previewUrl;
  }

  return payload;
}

// F-4 typed validation: numeric, trimmed, non-empty phoneNumberId. The
// error message is kept byte-for-byte identical to preserve backward
// compatibility with existing consumer assertions.
function normalizePhoneNumberId(phoneNumberId: string): string {
  const normalized = phoneNumberId.trim();

  if (!/^\d+$/.test(normalized)) {
    throw new GraphRequestValidationError(
      "Invalid phoneNumberId. Expected a numeric Graph phone number ID path segment."
    );
  }

  return normalized;
}

// --- endpoint-registry callable ----------------------------------------

/**
 * `sendMessage` — Graph `POST /{phoneNumberId}/messages`.
 *
 * Built via `defineEndpoint`, so path-template parsing, param validation,
 * control-char rejection, body passthrough, and F-5 error registry
 * routing are handled uniformly.
 */
export const sendMessage = defineEndpoint<
  { phoneNumberId: string },
  GraphMessagesSendBody,
  GraphMessagesSendResponse
>({
  method: "POST",
  pathTemplate: "/{phoneNumberId}/messages",
  params: { phoneNumberId: { in: "path", required: true } },
  bodyContentType: "application/json",
  buildBody: (body) => {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new GraphRequestValidationError("Invalid sendMessage input: body must be an object.");
    }
    const record = body as unknown as Record<string, unknown>;
    if (record.recipient_type === "group") {
      if (record.type === "interactive") {
        rejectGroupRecipient({ recipientType: "group" }, "sendMessage", "interactive messages");
      }
      assertValidGroupId(record.to, "sendMessage");
      if (record.type === "pin") {
        const pin = record.pin;
        if (typeof pin !== "object" || pin === null || Array.isArray(pin)) {
          throw new GraphRequestValidationError("Invalid sendMessage input: group pin body must be an object.");
        }
        const pinRecord = pin as Record<string, unknown>;
        if (pinRecord.type !== "pin" && pinRecord.type !== "unpin") {
          throw new GraphRequestValidationError("Invalid sendMessage input: group pin.type must be pin or unpin.");
        }
        assertNonEmptyControlFreeString(pinRecord.message_id, "pin.message_id", 256, "sendMessage");
        const expirationDays = pinRecord.expiration_days;
        if (typeof expirationDays !== "number" || !Number.isInteger(expirationDays) || expirationDays < 1 || expirationDays > 30) {
          throw new GraphRequestValidationError("Invalid sendMessage input: group pin.expiration_days must be an integer between 1 and 30.");
        }
      }
    }
    return body;
  }
});

// --- legacy class-based endpoint (backward-compat) ---------------------

export class GraphMessagesEndpoint {
  private readonly requestExecutor: GraphRequestExecutor;

  constructor(requestExecutor: GraphRequestExecutor) {
    this.requestExecutor = requestExecutor;
  }

  async sendMessage(
    input: GraphMessagesSendMessageInput
  ): Promise<GraphMessagesSendResponse> {
    // Preserve the F-4 typed-error guarantee (message string is part of
    // our public contract surface): validate the phoneNumberId first
    // with a dedicated error message before delegating into the
    // endpoint-registry callable (which would otherwise surface a
    // generic "path traversal"/"control chars" message from the
    // pathParam sanitizer).
    const phoneNumberId = normalizePhoneNumberId(input.phoneNumberId);

    if (typeof (this.requestExecutor as { request: unknown }).request !== "function") {
      throw new GraphRequestValidationError(
        "Invalid GraphMessagesEndpoint: requestExecutor must expose a request() method."
      );
    }
    // Delegate to the endpoint-registry callable. The callable only
    // needs the executor's `request<T>(options)` shape — it never
    // touches GraphClient internals — so the structural cast is safe
    // and the legacy `GraphRequestExecutor` test doubles keep working.
    return sendMessage(
      this.requestExecutor as unknown as GraphClient,
      { phoneNumberId },
      buildSendMessagePayload({ ...input, phoneNumberId })
    );
  }
}
