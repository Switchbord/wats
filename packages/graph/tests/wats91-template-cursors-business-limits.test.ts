import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRateLimitError,
  InvalidTemplateCursorError,
  WABAClient,
  getPhoneNumberInfo,
  getWabaInfo,
  listMessageTemplates,
  listPhoneNumbers,
  resolveRegisteredError,
  type GraphApiErrorPayload,
  type GraphErrorFactoryContext,
  type PhoneNumberInfo,
  type PhoneNumberListResponse,
  type TemplateListResponse,
  type WabaInfo
} from "../src";
import { createMockTransport, type MockTransportResponseSpec } from "../src/createMockTransport";

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec) {
  const handle = createMockTransport(Array.isArray(responses) ? { responses } : { defaultResponse: responses });
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function ok(body: object): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function errorContext(payload: GraphApiErrorPayload, status = 400): GraphErrorFactoryContext {
  return {
    payload,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    requestUrl: "https://graph.facebook.com/v25.0/WABA/message_templates"
  };
}

describe("WATS-91 v24 business messaging-limit fields", () => {
  test("WABA and phone-number response types expose portfolio messaging-limit fields", async () => {
    const { client } = clientWith([
      ok({
        id: "WABA-1",
        name: "Acme",
        whatsapp_business_manager_messaging_limit: "TIER_10K"
      }),
      ok({
        id: "PN-1",
        display_phone_number: "+1 555",
        messaging_limit_tier: "TIER_10K",
        whatsapp_business_manager_messaging_limit: "TIER_10K"
      }),
      ok({
        data: [{
          id: "PN-2",
          display_phone_number: "+1 556",
          messaging_limit_tier: "TIER_1K",
          whatsapp_business_manager_messaging_limit: "TIER_10K"
        }]
      })
    ]);

    const waba: WabaInfo = await getWabaInfo(client, {
      wabaId: "WABA-1",
      fields: ["id", "name", "whatsapp_business_manager_messaging_limit"]
    });
    const phone: PhoneNumberInfo = await getPhoneNumberInfo(client, {
      phoneNumberId: "PN-1",
      fields: ["id", "messaging_limit_tier", "whatsapp_business_manager_messaging_limit"]
    });
    const phones: PhoneNumberListResponse = await listPhoneNumbers(client, {
      wabaId: "WABA-1",
      fields: ["id", "messaging_limit_tier", "whatsapp_business_manager_messaging_limit"]
    });

    expect(waba.whatsapp_business_manager_messaging_limit).toBe("TIER_10K");
    expect(phone.messaging_limit_tier).toBe("TIER_10K");
    expect(phone.whatsapp_business_manager_messaging_limit).toBe("TIER_10K");
    expect(phones.data?.[0]?.whatsapp_business_manager_messaging_limit).toBe("TIER_10K");
  });
});

describe("WATS-91 message-template cursor handling", () => {
  test("listMessageTemplates forwards before and after cursors through direct and WABAClient calls", async () => {
    const { client, handle } = clientWith([ok({ data: [] }), ok({ data: [] })]);
    const direct: TemplateListResponse = await listMessageTemplates(client, {
      wabaId: "999",
      limit: "25",
      after: "AFTER_CURSOR",
      before: "BEFORE_CURSOR"
    });
    const waba = new WABAClient({ graphClient: client, wabaId: "999" });
    const scoped = await waba.listMessageTemplates({ before: "SCOPED_BEFORE" });

    expect(direct.data).toEqual([]);
    expect(scoped.data).toEqual([]);
    expect(handle.requests.map((r) => r.url)).toEqual([
      "https://graph.facebook.com/v25.0/999/message_templates?limit=25&after=AFTER_CURSOR&before=BEFORE_CURSOR",
      "https://graph.facebook.com/v25.0/999/message_templates?before=SCOPED_BEFORE"
    ]);
  });

  test("Graph error code 131059 resolves to InvalidTemplateCursorError", () => {
    const entry = resolveRegisteredError(131059, undefined);
    expect(entry?.errorName).toBe("InvalidTemplateCursorError");
    const instance = entry?.factory(errorContext({
      message: "Invalid cursor for message_templates.",
      code: 131059,
      type: "OAuthException"
    } as GraphApiErrorPayload));

    expect(instance).toBeInstanceOf(InvalidTemplateCursorError);
    expect(instance).toBeInstanceOf(GraphApiError);
    expect(instance).not.toBeInstanceOf(GraphAuthError);
    expect(instance).not.toBeInstanceOf(GraphRateLimitError);
  });
});
