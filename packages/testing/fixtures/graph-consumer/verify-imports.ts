// Consumer fixture for @switchbord/graph.
//
// Imports ONLY through the published package specifiers (never through
// relative paths). Exercises the Transport seam via createMockTransport,
// asserts construction-time validation, baseUrl pathname preservation,
// scrubErrorCause Bearer redaction, AND — in F-5 — the error code
// registry + seeded subclass identity. Emits a single-line JSON report
// ending with the success sentinel `graph-consumer:ok`.

import * as rootEntrypoint from "@switchbord/graph";
import * as messagesSubpath from "@switchbord/graph/endpoints/messages";
import * as mediaSubpath from "@switchbord/graph/endpoints/media";
import * as templatesSubpath from "@switchbord/graph/endpoints/templates";
import * as flowsSubpath from "@switchbord/graph/endpoints/flows";
import * as callingSubpath from "@switchbord/graph/endpoints/calling";
import * as businessManagementSubpath from "@switchbord/graph/endpoints/business-management";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRateLimitError,
  GraphRequestValidationError,
  GraphMessagesEndpoint,
  InvalidParameterError,
  initiateCall,
  preAcceptCall,
  acceptCall,
  rejectCall,
  terminateCall,
  getWabaInfo,
  listSubscribedApps,
  getPhoneNumberInfo,
  getPhoneNumberSettings,
  getBusinessProfile,
  getCommerceSettings,
  MediaCryptoError,
  MediaIntegrityError,
  MediaValidationError,
  PaginationError,
  PhoneNumberClient,
  TemplateParamCountMismatchError,
  ToManyAPICallsError,
  WABAClient,
  clearErrorRegistry,
  createGraphApiError,
  createFetchTransport,
  decryptEncryptedMedia,
  deleteMedia,
  defineEndpoint,
  downloadMedia,
  downloadMediaBytes,
  createUploadSession,
  uploadFileToSession,
  getUploadSession,
  listPhoneNumbers,
  paginate,
  paginateAll,
  registerBuiltInErrorCodes,
  registerErrorCode,
  resolveRegisteredError,
  scrubErrorCause,
  sendMessage,
  buildSendImagePayload,
  buildSendVideoPayload,
  buildSendAudioPayload,
  buildSendDocumentPayload,
  buildSendStickerPayload,
  buildSendLocationPayload,
  buildSendContactsPayload,
  buildSendReactionPayload,
  buildSendButtonsPayload,
  buildSendTemplatePayload,
  buildTemplateBodyComponent,
  buildTemplateButtonComponent,
  buildTemplateFooterComponent,
  buildTemplateHeaderComponent,
  buildFlowCloseResponse,
  buildFlowErrorResponse,
  buildFlowJson,
  buildFlowScreenResponse,
  createFlow,
  createMessageTemplate,
  deleteFlow,
  deleteMessageTemplate,
  deprecateFlow,
  getFlow,
  getFlowAssets,
  getMessageTemplate,
  listFlows,
  listMessageTemplates,
  publishFlow,
  updateFlowJson,
  updateFlowMetadata,
  updateMessageTemplate,
  validateFlowJson,
  validateTemplateParameterCounts,
  uploadMedia,
  DEFAULT_MAX_MEDIA_UPLOAD_BYTES,
  DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_SESSION_BYTES,
  DEFAULT_GRAPH_BASE_URL,
  type GraphErrorFactoryContext,
  type PaginatedPage,
  type Transport,
  type WabaInfo,
  type SubscribedAppsResponse,
  type PhoneNumberInfo,
  type PhoneNumberSettingsResponse,
  type BusinessProfileResponse,
  type CommerceSettingsResponse
} from "@switchbord/graph";
import { createMockTransport } from "@switchbord/graph/testing";

interface VerifyReportOk {
  readonly ok: true;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly sentinel: "graph-consumer:ok";
  readonly moduleKeys: Readonly<Record<string, readonly string[]>>;
}


function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  return bytesToBase64(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.slice() as BufferSource)));
}

async function verify(): Promise<VerifyReportOk> {
  const checks: Record<string, boolean> = {};

  checks["rootEntrypoint is a module namespace"] =
    typeof rootEntrypoint === "object" && rootEntrypoint !== null;
  checks["GraphClient is a class"] = typeof GraphClient === "function";
  checks["GraphClient exposes requestRaw for resolved media URLs"] =
    typeof GraphClient.prototype.requestRaw === "function";
  checks["createFetchTransport is a function"] =
    typeof createFetchTransport === "function";
  checks["createMockTransport is a function"] =
    typeof createMockTransport === "function";
  checks["scrubErrorCause is a function"] =
    typeof scrubErrorCause === "function";
  checks["DEFAULT_GRAPH_BASE_URL is a URL string"] =
    typeof DEFAULT_GRAPH_BASE_URL === "string" &&
    DEFAULT_GRAPH_BASE_URL.startsWith("https://graph.facebook.com");

  // F-5: error-registry API surface.
  checks["registerErrorCode is a function"] =
    typeof registerErrorCode === "function";
  checks["resolveRegisteredError is a function"] =
    typeof resolveRegisteredError === "function";
  checks["InvalidParameterError is a class"] =
    typeof InvalidParameterError === "function";
  checks["ToManyAPICallsError is a class"] =
    typeof ToManyAPICallsError === "function";
  checks["TemplateParamCountMismatchError is a class"] =
    typeof TemplateParamCountMismatchError === "function";

  // F-5: seeded built-in codes resolve without an explicit clear.
  const invalidParamEntry = resolveRegisteredError(100, undefined);
  checks["built-in code 100 resolves to a registry entry"] =
    invalidParamEntry !== undefined &&
    invalidParamEntry.errorName === "InvalidParameterError";

  const tooManyEntry = resolveRegisteredError(4, undefined);
  checks["built-in code 4 resolves to a registry entry"] =
    tooManyEntry !== undefined && tooManyEntry.errorName === "ToManyAPICallsError";

  // F-5: createGraphApiError routes through the registry and returns
  // the correct subclass identity, with sibling NOT checks.
  const invalidParamInstance = createGraphApiError({
    status: 400,
    payload: { message: "Invalid parameter.", code: 100 }
  });
  checks["createGraphApiError code 100 → InvalidParameterError"] =
    invalidParamInstance instanceof InvalidParameterError &&
    invalidParamInstance instanceof GraphApiError &&
    !(invalidParamInstance instanceof GraphAuthError) &&
    !(invalidParamInstance instanceof GraphRateLimitError);

  const tooManyInstance = createGraphApiError({
    status: 429,
    payload: { message: "Throttled", code: 4 }
  });
  checks["createGraphApiError code 4 @ 429 → ToManyAPICallsError"] =
    tooManyInstance instanceof ToManyAPICallsError &&
    tooManyInstance instanceof GraphRateLimitError &&
    !(tooManyInstance instanceof GraphAuthError);

  // F-5: OAuth-on-5xx does NOT classify as auth.
  const oauth500 = createGraphApiError({
    status: 500,
    payload: { message: "Stray OAuthException at 5xx", type: "OAuthException" }
  });
  checks["OAuth-type at 5xx does NOT classify as GraphAuthError"] =
    !(oauth500 instanceof GraphAuthError) && oauth500 instanceof GraphApiError;

  // F-5: ClientError vs ServerError classification axis.
  const unknown400 = createGraphApiError({
    status: 400,
    payload: { message: "unknown client" }
  });
  const unknown500 = createGraphApiError({
    status: 500,
    payload: { message: "unknown server" }
  });
  checks["unknown code @ 4xx has classification ClientError"] =
    (unknown400 as GraphApiError & { classification?: string }).classification ===
    "ClientError";
  checks["unknown code @ 5xx has classification ServerError"] =
    (unknown500 as GraphApiError & { classification?: string }).classification ===
    "ServerError";

  // F-5: consumer-side custom registration round-trip.
  clearErrorRegistry();
  class ConsumerCustomError extends GraphApiError {
    static readonly errorCode = 424242;
    constructor(ctx: GraphErrorFactoryContext) {
      const payload = ctx.payload;
      super({
        message:
          payload !== undefined && typeof payload.message === "string"
            ? payload.message
            : "consumer-custom",
        status: ctx.status,
        ...(ctx.payload !== undefined ? { payload: ctx.payload } : {})
      });
      this.name = "ConsumerCustomError";
    }
  }
  registerErrorCode({
    code: 424242,
    errorName: "ConsumerCustomError",
    factory: (ctx) => new ConsumerCustomError(ctx)
  });
  const customEntry = resolveRegisteredError(424242, undefined);
  checks["consumer registerErrorCode({ code: 424242, ... }) round-trips"] =
    customEntry !== undefined && customEntry.errorName === "ConsumerCustomError";
  // Restore the built-in seeds before downstream checks.
  registerBuiltInErrorCodes();

  // Construction-time validation: invalid accessToken is rejected with
  // GraphRequestValidationError (typed name + status 400).
  let ctorThrew: unknown;
  try {
    new GraphClient({
      accessToken: "",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com"
    });
  } catch (error) {
    ctorThrew = error;
  }
  checks["empty accessToken rejected with GraphRequestValidationError"] =
    ctorThrew instanceof GraphRequestValidationError &&
    (ctorThrew as GraphRequestValidationError).name === "GraphRequestValidationError" &&
    (ctorThrew as GraphRequestValidationError).status === 400;

  // Transport injection: a GraphClient built with MockTransport routes
  // request() through the mock; requests.length === 1 after one call.
  const handle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    }
  });
  const mockClient = new GraphClient({
    accessToken: "test-token",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: handle.transport as Transport
  });
  const mockRes = await mockClient.request<{ ok: boolean }>({
    method: "GET",
    path: "/me"
  });
  checks["MockTransport returns the configured default response"] =
    mockRes.ok === true;
  checks["MockTransport records exactly one request"] =
    handle.requests.length === 1;
  checks["MockTransport request bears the Bearer authorization header"] =
    handle.requests[0]?.headers.get("authorization") === "Bearer test-token";

  const rawHandle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3])
    }
  });
  const rawClient = new GraphClient({
    accessToken: "test-token",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: rawHandle.transport as Transport
  });
  const rawResponse = await rawClient.requestRaw({
    method: "GET",
    url: "https://lookaside.example.test/media/abc?token=redacted"
  });
  checks["GraphClient.requestRaw returns a raw TransportResponse"] =
    rawResponse.status === 200 && typeof rawResponse.arrayBuffer === "function";
  checks["GraphClient.requestRaw uses absolute URL without apiVersion prefix"] =
    rawHandle.requests[0]?.url ===
    "https://lookaside.example.test/media/abc?token=redacted";
  checks["GraphClient.requestRaw applies managed Bearer authorization"] =
    rawHandle.requests[0]?.headers.get("authorization") === "Bearer test-token";

  let rawValidationThrew: unknown;
  try {
    await rawClient.requestRaw({
      method: "GET",
      url: "https://lookaside.example.test/media/abc",
      headers: { authorization: "Bearer evil" }
    });
  } catch (error) {
    rawValidationThrew = error;
  }
  checks["GraphClient.requestRaw rejects authorization override"] =
    rawValidationThrew instanceof GraphRequestValidationError;

  // baseUrl pathname preservation: proxy path survives into request URL.
  const proxyHandle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    }
  });
  const proxyClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://proxy.example.com/api",
    transport: proxyHandle.transport as Transport
  });
  await proxyClient.request({ method: "GET", path: "/me" });
  const proxyUrl = proxyHandle.requests[0]?.url ?? "";
  checks["baseUrl pathname preserved (/api/v25.0/me)"] =
    proxyUrl === "https://proxy.example.com/api/v25.0/me";

  // scrubErrorCause: Bearer token in string input redacted.
  const scrubbedString = scrubErrorCause(
    "Authorization: Bearer *** at line 1"
  );
  checks["scrubErrorCause redacts Bearer in string"] =
    typeof scrubbedString === "string" &&
    (scrubbedString as string).includes("Bearer ***") &&
    !(scrubbedString as string).includes("EAAxxxyyy");

  // scrubErrorCause: Bearer token in Error instance redacted, prototype
  // preserved (instanceof Error still true).
  const raw = new Error("call failed: Bearer SECRET_123 returned 401");
  const scrubbed = scrubErrorCause(raw);
  checks["scrubErrorCause preserves Error prototype"] =
    scrubbed instanceof Error;
  checks["scrubErrorCause redacts Bearer in Error message"] =
    scrubbed instanceof Error &&
    scrubbed.message.includes("Bearer ***") &&
    !scrubbed.message.includes("SECRET_123");

  // F-6: defineEndpoint primitive and endpoint-registry sendMessage.
  checks["defineEndpoint is a function"] =
    typeof defineEndpoint === "function";
  checks["sendMessage is a function"] =
    typeof sendMessage === "function";
  checks["sendMessage exposes .definition introspection"] =
    typeof (sendMessage as { definition?: unknown }).definition === "object" &&
    (sendMessage as { definition: { pathTemplate: string } }).definition
      .pathTemplate === "/{phoneNumberId}/messages";
  checks["WATS-38 message payload builders are functions"] =
    typeof buildSendImagePayload === "function" &&
    typeof buildSendVideoPayload === "function" &&
    typeof buildSendAudioPayload === "function" &&
    typeof buildSendDocumentPayload === "function" &&
    typeof buildSendStickerPayload === "function" &&
    typeof buildSendLocationPayload === "function" &&
    typeof buildSendContactsPayload === "function" &&
    typeof buildSendReactionPayload === "function" &&
    typeof buildSendButtonsPayload === "function" &&
    typeof buildSendTemplatePayload === "function";
  checks["buildSendImagePayload emits exact image Graph body"] =
    JSON.stringify(
      buildSendImagePayload({
        to: "15551230000",
        mediaId: "IMG_ID",
        caption: "hello"
      })
    ) ===
    JSON.stringify({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "image",
      image: { id: "IMG_ID", caption: "hello" }
    });

  checks["buildSendLocationPayload emits exact location Graph body"] =
    JSON.stringify(
      buildSendLocationPayload({ to: "15551230000", latitude: 1, longitude: 2 })
    ) ===
    JSON.stringify({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "location",
      location: { latitude: 1, longitude: 2 }
    });
  checks["buildSendButtonsPayload emits interactive button body"] =
    JSON.stringify(
      buildSendButtonsPayload({ to: "15551230000", bodyText: "Pick", buttons: [{ id: "a", title: "A" }] })
    ) ===
    JSON.stringify({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "interactive",
      interactive: { type: "button", body: { text: "Pick" }, action: { buttons: [{ type: "reply", reply: { id: "a", title: "A" } }] } }
    });
  checks["buildSendTemplatePayload emits template body"] =
    JSON.stringify(
      buildSendTemplatePayload({ to: "15551230000", name: "hello_world", languageCode: "en_US" })
    ) ===
    JSON.stringify({
      messaging_product: "whatsapp",
      to: "15551230000",
      type: "template",
      template: { name: "hello_world", language: { code: "en_US" } }
    });

  checks["WATS-39 template management exports are functions"] =
    typeof listMessageTemplates === "function" &&
    typeof getMessageTemplate === "function" &&
    typeof createMessageTemplate === "function" &&
    typeof updateMessageTemplate === "function" &&
    typeof deleteMessageTemplate === "function" &&
    typeof buildTemplateHeaderComponent === "function" &&
    typeof buildTemplateBodyComponent === "function" &&
    typeof buildTemplateFooterComponent === "function" &&
    typeof buildTemplateButtonComponent === "function" &&
    typeof validateTemplateParameterCounts === "function";
  checks["WATS-53 templates subpath exports runtime surface"] =
    templatesSubpath.listMessageTemplates === listMessageTemplates &&
    templatesSubpath.getMessageTemplate === getMessageTemplate &&
    templatesSubpath.createMessageTemplate === createMessageTemplate &&
    templatesSubpath.updateMessageTemplate === updateMessageTemplate &&
    templatesSubpath.deleteMessageTemplate === deleteMessageTemplate &&
    templatesSubpath.buildTemplateHeaderComponent === buildTemplateHeaderComponent &&
    templatesSubpath.validateTemplateParameterCounts === validateTemplateParameterCounts;

  const templateBody = buildTemplateBodyComponent({ text: "Hi {{1}}" });
  checks["buildTemplateBodyComponent emits Graph BODY component"] =
    JSON.stringify(templateBody) === JSON.stringify({ type: "BODY", text: "Hi {{1}}" });
  checks["buildTemplateFooterComponent emits Graph FOOTER component"] =
    JSON.stringify(buildTemplateFooterComponent({ text: "Footer" })) ===
    JSON.stringify({ type: "FOOTER", text: "Footer" });
  checks["validateTemplateParameterCounts passes matching positional sends"] = (() => {
    try {
      validateTemplateParameterCounts(
        { components: [templateBody] },
        [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }]
      );
      return true;
    } catch {
      return false;
    }
  })();

  checks["WATS-40 Flow management exports are functions"] =
    typeof listFlows === "function" &&
    typeof getFlow === "function" &&
    typeof createFlow === "function" &&
    typeof updateFlowMetadata === "function" &&
    typeof updateFlowJson === "function" &&
    typeof publishFlow === "function" &&
    typeof deleteFlow === "function" &&
    typeof deprecateFlow === "function" &&
    typeof getFlowAssets === "function" &&
    typeof buildFlowJson === "function" &&
    typeof validateFlowJson === "function" &&
    typeof buildFlowScreenResponse === "function" &&
    typeof buildFlowCloseResponse === "function" &&
    typeof buildFlowErrorResponse === "function";
  checks["WATS-53 flows subpath exports runtime surface"] =
    flowsSubpath.listFlows === listFlows &&
    flowsSubpath.getFlow === getFlow &&
    flowsSubpath.createFlow === createFlow &&
    flowsSubpath.updateFlowJson === updateFlowJson &&
    flowsSubpath.publishFlow === publishFlow &&
    flowsSubpath.buildFlowJson === buildFlowJson &&
    typeof flowsSubpath.FLOW_JSON_MAX_BYTES === "number" &&
    flowsSubpath.FLOW_JSON_MAX_BYTES > 0;

  const flowJson = buildFlowJson({
    version: "7.0",
    screens: [{ id: "WELCOME", layout: { type: "SingleColumnLayout", children: [{ type: "TextHeading", text: "Hi" }] } }]
  });
  checks["buildFlowJson clones a minimal Flow JSON"] =
    JSON.stringify(flowJson) ===
    JSON.stringify({ version: "7.0", screens: [{ id: "WELCOME", layout: { type: "SingleColumnLayout", children: [{ type: "TextHeading", text: "Hi" }] } }] });
  checks["buildFlowScreenResponse emits data-exchange screen response"] =
    JSON.stringify(buildFlowScreenResponse({ screen: "WELCOME", data: { ok: true }, flowToken: "tok" })) ===
    JSON.stringify({ screen: "WELCOME", data: { ok: true }, flow_token: "tok" });

  checks["WATS-41 Calling API exports are functions"] =
    typeof initiateCall === "function" &&
    typeof preAcceptCall === "function" &&
    typeof acceptCall === "function" &&
    typeof rejectCall === "function" &&
    typeof terminateCall === "function";
  checks["WATS-54 messages subpath exports runtime surface"] =
    messagesSubpath.sendMessage === sendMessage &&
    messagesSubpath.GraphMessagesEndpoint === GraphMessagesEndpoint &&
    typeof messagesSubpath.buildSendTemplatePayload === "function";
  checks["WATS-54 calling subpath exports runtime surface"] =
    callingSubpath.initiateCall === initiateCall &&
    callingSubpath.preAcceptCall === preAcceptCall &&
    callingSubpath.acceptCall === acceptCall &&
    callingSubpath.rejectCall === rejectCall &&
    callingSubpath.terminateCall === terminateCall &&
    typeof callingSubpath.CALL_BIZ_OPAQUE_CALLBACK_DATA_MAX_LENGTH === "number";

  const callingHandle = createMockTransport({
    responses: [
      { status: 200, headers: { "content-type": "application/json" }, body: { id: "call-fixture" } },
      { status: 200, headers: { "content-type": "application/json" }, body: { success: true } },
      { status: 200, headers: { "content-type": "application/json" }, body: { success: true } }
    ]
  });
  const callingClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: callingHandle.transport
  });
  const callSession = { sdpType: "offer", sdp: "v=0\r\n" };
  const initiatedCall = await initiateCall(
    callingClient,
    { phoneNumberId: "555000111" },
    { to: "15551230000", session: callSession, bizOpaqueCallbackData: "fixture" }
  );
  const phoneForCalls = new PhoneNumberClient({
    graphClient: callingClient,
    phoneNumberId: "555000111"
  });
  await phoneForCalls.acceptCall({ callId: "call-fixture", session: callSession });
  await phoneForCalls.terminateCall({ callId: "call-fixture" });
  checks["Calling callables and PhoneNumberClient methods emit /calls Graph paths"] =
    initiatedCall.id === "call-fixture" &&
    callingHandle.requests[0]?.url === "https://graph.facebook.com/v25.0/555000111/calls" &&
    callingHandle.requests[1]?.url === "https://graph.facebook.com/v25.0/555000111/calls" &&
    callingHandle.requests[2]?.url === "https://graph.facebook.com/v25.0/555000111/calls";
  const initiatedCallBody = JSON.parse(String(callingHandle.requests[0]?.body)) as {
    readonly action?: string;
    readonly session?: { readonly sdp_type?: string; readonly sdp?: string };
    readonly biz_opaque_callback_data?: string;
  };
  checks["initiateCall maps camelCase session/tracker to Graph snake_case"] =
    initiatedCallBody.action === "connect" &&
    initiatedCallBody.session?.sdp_type === "offer" &&
    initiatedCallBody.biz_opaque_callback_data === "fixture";

  const templateHandle = createMockTransport({
    responses: [
      { status: 200, headers: { "content-type": "application/json" }, body: { data: [] } },
      { status: 200, headers: { "content-type": "application/json" }, body: { id: "tpl1" } },
      { status: 200, headers: { "content-type": "application/json" }, body: { success: true } }
    ]
  });
  const templateClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: templateHandle.transport
  });
  await listMessageTemplates(templateClient, { wabaId: "999", status: "APPROVED" });
  await createMessageTemplate(
    templateClient,
    { wabaId: "999" },
    { name: "order_ready", language: "en_US", category: "UTILITY", components: [templateBody] }
  );
  const wabaClient = new WABAClient({ graphClient: templateClient, wabaId: "999" });
  await wabaClient.deleteMessageTemplate({ name: "order_ready", templateId: "tpl1" });
  checks["template callables and WABAClient emit Graph paths"] =
    templateHandle.requests[0]?.url ===
      "https://graph.facebook.com/v25.0/999/message_templates?status=APPROVED" &&
    templateHandle.requests[1]?.url ===
      "https://graph.facebook.com/v25.0/999/message_templates" &&
    templateHandle.requests[2]?.url ===
      "https://graph.facebook.com/v25.0/999/message_templates?name=order_ready&hsm_id=tpl1";

  // Define a trivial custom endpoint and invoke it via MockTransport to
  // verify the path-template + query-encoding + body-passthrough contract
  // flows end-to-end across the published package boundary.
  const customEndpoint = defineEndpoint<
    { accountId: string; cursor?: string },
    { probe: string },
    { ok: boolean }
  >({
    method: "POST",
    pathTemplate: "/{accountId}/custom",
    params: {
      accountId: { in: "path", required: true },
      cursor: { in: "query", required: false }
    },
    bodyContentType: "application/json"
  });
  const customHandle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true }
    }
  });
  const customClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: customHandle.transport as Transport
  });
  const customRes = await customEndpoint(
    customClient,
    { accountId: "42", cursor: "abc" },
    { probe: "hi" }
  );
  checks["custom defineEndpoint invokes without throwing"] =
    customRes.ok === true;
  const customUrl = customHandle.requests[0]?.url ?? "";
  checks["custom defineEndpoint builds path + query correctly"] =
    customUrl === "https://graph.facebook.com/v25.0/42/custom?cursor=abc";
  const customBody = customHandle.requests[0]?.body;
  checks["custom defineEndpoint passes body through as JSON"] =
    typeof customBody === "string" &&
    JSON.parse(customBody).probe === "hi";
  checks["custom defineEndpoint applied bodyContentType header"] =
    customHandle.requests[0]?.headers.get("content-type") ===
    "application/json";

  // F-7: scoped sub-clients — PhoneNumberClient + WABAClient.
  checks["PhoneNumberClient is a class"] =
    typeof PhoneNumberClient === "function";
  checks["WABAClient is a class"] = typeof WABAClient === "function";
  checks["listPhoneNumbers is a function"] =
    typeof listPhoneNumbers === "function";

  // F-7: invalid phoneNumberId rejected at CONSTRUCTION, not first call.
  let pnThrew: unknown;
  try {
    const h = createMockTransport({
      defaultResponse: { status: 200, body: { ok: true } }
    });
    const c = new GraphClient({
      accessToken: "t",
      apiVersion: "v25.0",
      baseUrl: "https://graph.facebook.com",
      transport: h.transport as Transport
    });
    new PhoneNumberClient({ graphClient: c, phoneNumberId: "../evil" });
  } catch (error) {
    pnThrew = error;
  }
  checks["PhoneNumberClient rejects unsafe phoneNumberId at construction"] =
    pnThrew instanceof GraphRequestValidationError;

  // F-7: PhoneNumberClient round-trip substitutes bound id into URL.
  const pnHandle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messaging_product: "whatsapp", messages: [{ id: "wamid.P" }] }
    }
  });
  const pnGraphClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: pnHandle.transport as Transport
  });
  const phone = new PhoneNumberClient({
    graphClient: pnGraphClient,
    phoneNumberId: "555000111"
  });
  const pnRes = await phone.sendMessage({
    messaging_product: "whatsapp",
    to: "15551230000",
    type: "text",
    text: { body: "hi" }
  });
  checks["PhoneNumberClient.sendMessage returns parsed response"] =
    pnRes.messages?.[0]?.id === "wamid.P";
  checks["PhoneNumberClient.sendMessage URL contains bound phoneNumberId"] =
    pnHandle.requests[0]?.url ===
    "https://graph.facebook.com/v25.0/555000111/messages";

  pnHandle.reset();
  const pnTextRes = await phone.sendText({
    to: "15551230001",
    text: "fixture start chat",
    previewUrl: false
  });
  const pnTextBody = JSON.parse(String(pnHandle.requests[0]?.body)) as {
    readonly to?: string;
    readonly type?: string;
    readonly text?: { readonly body?: string; readonly preview_url?: boolean };
  };
  checks["PhoneNumberClient.sendText returns parsed response"] =
    pnTextRes.messages?.[0]?.id === "wamid.P";
  checks["PhoneNumberClient.sendText accepts arbitrary recipient via @switchbord/graph"] =
    pnHandle.requests[0]?.url ===
      "https://graph.facebook.com/v25.0/555000111/messages" &&
    pnTextBody.to === "15551230001" &&
    pnTextBody.type === "text" &&
    pnTextBody.text?.body === "fixture start chat" &&
    pnTextBody.text?.preview_url === false;

  pnHandle.reset();
  await phone.sendImage({
    to: "15551230002",
    link: "https://cdn.example.test/image.jpg",
    caption: "fixture image"
  });
  const pnImageBody = JSON.parse(String(pnHandle.requests[0]?.body)) as {
    readonly type?: string;
    readonly image?: { readonly link?: string; readonly caption?: string };
  };
  checks["PhoneNumberClient.sendImage sends exact media payload via @switchbord/graph"] =
    pnHandle.requests[0]?.url ===
      "https://graph.facebook.com/v25.0/555000111/messages" &&
    pnImageBody.type === "image" &&
    pnImageBody.image?.link === "https://cdn.example.test/image.jpg" &&
    pnImageBody.image?.caption === "fixture image";

  pnHandle.reset();
  await phone.sendButtons({
    to: "15551230002",
    bodyText: "fixture buttons",
    buttons: [{ id: "yes", title: "Yes" }]
  });
  const pnButtonsBody = JSON.parse(String(pnHandle.requests[0]?.body)) as {
    readonly type?: string;
    readonly interactive?: { readonly type?: string; readonly action?: { readonly buttons?: readonly unknown[] } };
  };
  checks["PhoneNumberClient.sendButtons sends interactive payload via @switchbord/graph"] =
    pnButtonsBody.type === "interactive" &&
    pnButtonsBody.interactive?.type === "button" &&
    pnButtonsBody.interactive?.action?.buttons?.length === 1;

  // F-7: WABAClient round-trip — listPhoneNumbers under /{wabaId}/phone_numbers.
  const wabaHandle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { data: [{ id: "111" }, { id: "222" }] }
    }
  });
  const wabaGraphClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: wabaHandle.transport as Transport
  });
  const waba = new WABAClient({
    graphClient: wabaGraphClient,
    wabaId: "9876543210"
  });
  const wabaRes = await waba.listPhoneNumbers();
  checks["WABAClient.listPhoneNumbers returns parsed response"] =
    (wabaRes.data?.length ?? 0) === 2;
  checks["WABAClient.listPhoneNumbers URL contains bound wabaId"] =
    wabaHandle.requests[0]?.url ===
    "https://graph.facebook.com/v25.0/9876543210/phone_numbers";
  checks["WABAClient.listPhoneNumbers method is GET"] =
    wabaHandle.requests[0]?.method === "GET";

  // F-7: WABAClient rejects unsafe wabaId at CONSTRUCTION.
  let wabaThrew: unknown;
  try {
    new WABAClient({ graphClient: wabaGraphClient, wabaId: "x\r\ny" });
  } catch (error) {
    wabaThrew = error;
  }
  checks["WABAClient rejects CR/LF wabaId at construction"] =
    wabaThrew instanceof GraphRequestValidationError;

  // F-13: pagination primitive round-trip — 3 pages with cursors.
  checks["paginate is a function"] = typeof paginate === "function";
  checks["paginateAll is a function"] = typeof paginateAll === "function";
  checks["PaginationError is a class"] =
    typeof PaginationError === "function";

  const pageEndpoint = defineEndpoint<
    { accountId: string; after?: string },
    never,
    PaginatedPage<{ readonly id: string }>
  >({
    method: "GET",
    pathTemplate: "/{accountId}/items",
    params: {
      accountId: { in: "path", required: true },
      after: { in: "query", required: false }
    }
  });

  const pageBody = (
    ids: readonly string[],
    nextCursor?: string
  ): {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: PaginatedPage<{ readonly id: string }>;
  } => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: {
      data: ids.map((id) => ({ id })),
      paging:
        nextCursor !== undefined
          ? {
              cursors: { after: nextCursor },
              next: `https://graph.facebook.com/v25.0/acct/items?after=${nextCursor}`
            }
          : { cursors: {} }
    }
  });

  const pageHandle = createMockTransport({
    responses: [
      pageBody(["p1a", "p1b"], "cur1"),
      pageBody(["p2a"], "cur2"),
      pageBody(["p3a", "p3b"])
    ]
  });
  const pageClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: pageHandle.transport as Transport
  });
  const pageCollected: string[] = [];
  for await (const item of paginate(
    pageClient,
    pageEndpoint,
    { accountId: "acct" }
  )) {
    pageCollected.push(item.id);
  }
  checks["paginate iterates 3 pages with cursors in order"] =
    pageCollected.join(",") === "p1a,p1b,p2a,p3a,p3b";
  checks["paginate extracts cursor from paging.next across requests"] =
    pageHandle.requests.length === 3 &&
    (pageHandle.requests[1]?.url.includes("after=cur1") ?? false) &&
    (pageHandle.requests[2]?.url.includes("after=cur2") ?? false);

  // F-13: paginateAll round-trip + pageLimitReached flag.
  const allHandle = createMockTransport({
    responses: [
      pageBody(["x1"], "c1"),
      pageBody(["x2"], "c2"),
      pageBody(["x3"], "c3"),
      pageBody(["x4"])
    ]
  });
  const allClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: allHandle.transport as Transport
  });
  const allResult = await paginateAll(
    allClient,
    pageEndpoint,
    { accountId: "acct" },
    { maxPages: 2 }
  );
  checks["paginateAll respects maxPages cap with pageLimitReached=true"] =
    allResult.pagesConsumed === 2 &&
    allResult.pageLimitReached === true &&
    allResult.items.length === 2;

  // F-13: PaginationError taxonomy surfaces to consumers.
  let paginateThrew: unknown;
  try {
    const gen = paginate(
      pageClient,
      pageEndpoint,
      { accountId: "acct" },
      { maxPages: 0 }
    );
    await gen.next();
  } catch (error) {
    paginateThrew = error;
  }
  checks["paginate(maxPages:0) rejects with PaginationError(invalid_max_pages)"] =
    paginateThrew instanceof PaginationError &&
    (paginateThrew as PaginationError).code === "invalid_max_pages";

  // WATS-37: media runtime — upload/download/delete/decrypt/session helpers
  // work through MockTransport without live Meta credentials.
  checks["uploadMedia is a function"] = typeof uploadMedia === "function";
  checks["downloadMedia is a function"] =
    typeof downloadMedia === "function";
  checks["deleteMedia is a function"] = typeof deleteMedia === "function";
  checks["decryptEncryptedMedia is a function"] =
    typeof decryptEncryptedMedia === "function";
  checks["MediaValidationError is a class"] =
    typeof MediaValidationError === "function";
  checks["DEFAULT_MAX_MEDIA_UPLOAD_BYTES is finite positive integer"] =
    Number.isInteger(DEFAULT_MAX_MEDIA_UPLOAD_BYTES) &&
    DEFAULT_MAX_MEDIA_UPLOAD_BYTES > 0 &&
    Number.isFinite(DEFAULT_MAX_MEDIA_UPLOAD_BYTES);
  checks["WATS-53 media subpath exports runtime surface"] =
    mediaSubpath.uploadMedia === uploadMedia &&
    mediaSubpath.downloadMedia === downloadMedia &&
    mediaSubpath.downloadMediaBytes === downloadMediaBytes &&
    mediaSubpath.deleteMedia === deleteMedia &&
    mediaSubpath.decryptEncryptedMedia === decryptEncryptedMedia &&
    mediaSubpath.createUploadSession === createUploadSession &&
    mediaSubpath.MediaValidationError === MediaValidationError &&
    mediaSubpath.DEFAULT_MAX_MEDIA_UPLOAD_BYTES === DEFAULT_MAX_MEDIA_UPLOAD_BYTES;

  const mediaHandle = createMockTransport({
    responses: [
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { id: "fixture-media-1" }
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {
          messaging_product: "whatsapp",
          url: "https://lookaside.example.test/media/fixture-media-1",
          mime_type: "image/jpeg",
          sha256: "fixture-sha256",
          file_size: "3"
        }
      },
      {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { success: true }
      }
    ]
  });
  const mediaClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: mediaHandle.transport as Transport
  });

  const uploadRes = await uploadMedia(
    mediaClient,
    { phoneNumberId: "555" },
    {
      file: new Uint8Array([1, 2, 3]),
      type: "image/jpeg",
      messagingProduct: "whatsapp"
    }
  );
  const uploadReq = mediaHandle.requests[0];
  const uploadContentType = uploadReq?.headers.get("content-type") ?? "";
  checks["uploadMedia returns Graph media id on happy path"] =
    uploadRes.id === "fixture-media-1";
  checks["uploadMedia POSTs multipart to /{phoneNumberId}/media"] =
    uploadReq?.method === "POST" &&
    uploadReq.url === "https://graph.facebook.com/v25.0/555/media" &&
    uploadContentType.startsWith("multipart/form-data; boundary=") &&
    uploadReq.body instanceof Uint8Array;

  const downloadRes = await downloadMedia(mediaClient, { mediaId: "fixture_media_1" });
  checks["downloadMedia resolves metadata via GET /{mediaId}"] =
    mediaHandle.requests[1]?.method === "GET" &&
    mediaHandle.requests[1]?.url ===
      "https://graph.facebook.com/v25.0/fixture_media_1" &&
    downloadRes.messagingProduct === "whatsapp" &&
    downloadRes.mimeType === "image/jpeg" &&
    downloadRes.fileSize === 3;

  const deleteRes = await deleteMedia(mediaClient, { mediaId: "fixture_media_1" });
  checks["deleteMedia DELETEs /{mediaId} and returns success"] =
    mediaHandle.requests[2]?.method === "DELETE" &&
    mediaHandle.requests[2]?.url ===
      "https://graph.facebook.com/v25.0/fixture_media_1" &&
    deleteRes.success === true;

  let uploadValidationThrew: unknown;
  try {
    await uploadMedia(
      mediaClient,
      { phoneNumberId: "../evil" },
      {
        file: new Uint8Array([1]),
        type: "image/jpeg",
        messagingProduct: "whatsapp"
      }
    );
  } catch (error) {
    uploadValidationThrew = error;
  }
  checks["uploadMedia validation rejects unsafe phoneNumberId with MediaValidationError"] =
    uploadValidationThrew instanceof MediaValidationError &&
    (uploadValidationThrew as MediaValidationError).code === "invalid_phone_number_id";

  const bytesPayload = new Uint8Array([9, 8, 7]);
  const bytesHash = await sha256Base64(bytesPayload);
  const bytesHandle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      body: bytesPayload
    }
  });
  const bytesClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: bytesHandle.transport as Transport
  });
  const bytesRes = await downloadMediaBytes(bytesClient, {
    url: "https://lookaside.example.test/media/fixture",
    expectedSha256: bytesHash,
    maxBytes: DEFAULT_MAX_MEDIA_DOWNLOAD_BYTES
  });
  checks["downloadMediaBytes fetches binary media and validates sha256"] =
    bytesRes.bytes.length === 3 &&
    bytesRes.sha256 === bytesHash &&
    bytesHandle.requests[0]?.url === "https://lookaside.example.test/media/fixture";

  let decryptThrew: unknown;
  try {
    await decryptEncryptedMedia(
      {
        url: "https://example.test/x",
        encryptionKey: "AAAA",
        hmacKey: "AAAA",
        iv: "AAAA",
        sha256: "AAAA",
        sha256Enc: "AAAA"
      },
      new Uint8Array([0])
    );
  } catch (error) {
    decryptThrew = error;
  }
  checks["decryptEncryptedMedia rejects malformed bundle with MediaCryptoError"] =
    decryptThrew instanceof MediaCryptoError &&
    (decryptThrew as MediaCryptoError).code === "invalid_key_length";

  const sessionHandle = createMockTransport({
    responses: [
      { status: 200, headers: { "content-type": "application/json" }, body: { id: "upload:fixture" } },
      { status: 200, headers: { "content-type": "application/json" }, body: { h: "file-handle" } },
      { status: 200, headers: { "content-type": "application/json" }, body: { id: "upload:fixture", file_offset: "3" } }
    ]
  });
  const sessionClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: sessionHandle.transport as Transport
  });
  const session = await createUploadSession(sessionClient, {
    appId: "1234567890",
    fileName: "fixture.pdf",
    fileLength: 3,
    fileType: "application/pdf"
  });
  const fileHandle = await uploadFileToSession(sessionClient, {
    uploadSessionId: session.id,
    file: new Uint8Array([1, 2, 3]),
    fileOffset: 0,
    contentLength: 3
  }, { maxBytes: DEFAULT_MAX_UPLOAD_SESSION_BYTES });
  const sessionStatus = await getUploadSession(sessionClient, { uploadSessionId: session.id });
  checks["resumable upload session helpers run through @switchbord/graph"] =
    session.id === "upload:fixture" &&
    fileHandle.h === "file-handle" &&
    sessionStatus.fileOffset === 3;

  // WATS-42A: read-only business/admin inventory callables and scoped clients.
  checks["wats42-business-management root exports are functions"] =
    typeof getWabaInfo === "function" &&
    typeof listSubscribedApps === "function" &&
    typeof getPhoneNumberInfo === "function" &&
    typeof getPhoneNumberSettings === "function" &&
    typeof getBusinessProfile === "function" &&
    typeof getCommerceSettings === "function";
  checks["wats42-business-management subpath exports are functions"] =
    typeof businessManagementSubpath.getWabaInfo === "function" &&
    typeof businessManagementSubpath.listSubscribedApps === "function" &&
    typeof businessManagementSubpath.getPhoneNumberInfo === "function" &&
    typeof businessManagementSubpath.getPhoneNumberSettings === "function" &&
    typeof businessManagementSubpath.getBusinessProfile === "function" &&
    typeof businessManagementSubpath.getCommerceSettings === "function";

  const businessHandle = createMockTransport({
    responses: [
      { status: 200, headers: { "content-type": "application/json" }, body: { id: "waba-1", name: "Fixture WABA" } },
      { status: 200, headers: { "content-type": "application/json" }, body: { data: [{ app_id: "app-1" }] } },
      { status: 200, headers: { "content-type": "application/json" }, body: { data: [{ id: "pn-1" }] } },
      { status: 200, headers: { "content-type": "application/json" }, body: { id: "pn-1", display_phone_number: "+1555" } },
      { status: 200, headers: { "content-type": "application/json" }, body: { data: [{ calling: { status: "ENABLED" } }] } },
      { status: 200, headers: { "content-type": "application/json" }, body: { data: [{ about: "Fixture" }] } },
      { status: 200, headers: { "content-type": "application/json" }, body: { data: [{ is_cart_enabled: true }] } }
    ]
  });
  const businessClient = new GraphClient({
    accessToken: "t",
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com",
    transport: businessHandle.transport as Transport
  });
  const businessWaba = new WABAClient({ graphClient: businessClient, wabaId: "waba-1" });
  const businessPhone = new PhoneNumberClient({ graphClient: businessClient, phoneNumberId: "pn-1" });
  const wabaInfo: WabaInfo = await businessWaba.getInfo({ fields: ["id", "name"] });
  const subscribedApps: SubscribedAppsResponse = await businessWaba.listSubscribedApps();
  await businessWaba.listPhoneNumbers({ fields: ["id"], limit: "5" });
  const phoneInfo: PhoneNumberInfo = await businessPhone.getInfo({ fields: ["id", "display_phone_number"] });
  const phoneSettings: PhoneNumberSettingsResponse = await businessPhone.getSettings({ includeSipCredentials: false });
  const businessProfile: BusinessProfileResponse = await businessPhone.getBusinessProfile({ fields: ["about"] });
  const commerceSettings: CommerceSettingsResponse = await businessPhone.getCommerceSettings({ fields: ["is_cart_enabled"] });
  checks["wats42-business-management round trips through scoped clients"] =
    wabaInfo.id === "waba-1" &&
    subscribedApps.data?.[0]?.app_id === "app-1" &&
    phoneInfo.id === "pn-1" &&
    phoneSettings.data?.length === 1 &&
    businessProfile.data?.[0]?.about === "Fixture" &&
    commerceSettings.data?.[0]?.is_cart_enabled === true &&
    businessHandle.requests.map((request) => request.url).join("|") ===
      "https://graph.facebook.com/v25.0/waba-1?fields=id%2Cname|https://graph.facebook.com/v25.0/waba-1/subscribed_apps|https://graph.facebook.com/v25.0/waba-1/phone_numbers?fields=id&limit=5|https://graph.facebook.com/v25.0/pn-1?fields=id%2Cdisplay_phone_number|https://graph.facebook.com/v25.0/pn-1/settings?include_sip_credentials=false|https://graph.facebook.com/v25.0/pn-1/whatsapp_business_profile?fields=about|https://graph.facebook.com/v25.0/pn-1/whatsapp_commerce_settings?fields=is_cart_enabled";

  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) {
      throw new Error(`graph-consumer check failed: ${label}`);
    }
  }

  return {
    ok: true,
    checks,
    sentinel: "graph-consumer:ok",
    moduleKeys: {
      "@switchbord/graph": Object.keys(rootEntrypoint).sort(),
      "@switchbord/graph/endpoints/messages": Object.keys(messagesSubpath).sort(),
      "@switchbord/graph/endpoints/media": Object.keys(mediaSubpath).sort(),
      "@switchbord/graph/endpoints/templates": Object.keys(templatesSubpath).sort(),
      "@switchbord/graph/endpoints/flows": Object.keys(flowsSubpath).sort(),
      "@switchbord/graph/endpoints/calling": Object.keys(callingSubpath).sort(),
      "@switchbord/graph/endpoints/business-management": Object.keys(businessManagementSubpath).sort()
    }
  };
}

const report = await verify();
console.log(JSON.stringify(report));
console.log(report.sentinel);
