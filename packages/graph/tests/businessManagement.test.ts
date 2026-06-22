// WATS-42A RED — credential-free read-only business/admin inventory parity.
//
// Behavioral tests for stable read-only WABA and phone-number admin surfaces.
// Tests use MockTransport only; no live Meta credentials or environment reads.

import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRateLimitError,
  GraphRequestValidationError,
  InvalidParameterError,
  PhoneNumberClient,
  WABAClient,
  getBusinessProfile,
  getCommerceSettings,
  updateBusinessProfile,
  updateCommerceSettings,
  getPhoneNumberInfo,
  getPhoneNumberSettings,
  getWabaInfo,
  listPhoneNumbers,
  listSubscribedApps,
  type BusinessProfileResponse,
  type CommerceSettingsResponse,
  type PhoneNumberInfo,
  type PhoneNumberListResponse,
  type PhoneNumberSettingsResponse,
  type SubscribedAppsResponse,
  type WabaInfo
} from "../src";
import {
  createMockTransport,
  type MockTransportResponseSpec
} from "../src/createMockTransport";

function clientWith(responses: MockTransportResponseSpec[] | MockTransportResponseSpec) {
  const handle = createMockTransport(
    Array.isArray(responses) ? { responses } : { defaultResponse: responses }
  );
  const client = new GraphClient({
    baseUrl: "https://graph.facebook.com",
    apiVersion: "v25.0",
    accessToken: "test-token",
    transport: handle.transport
  });
  return { client, handle };
}

function ok(body: object = { id: "ok" }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

const unsafePathValues = [
  null,
  undefined,
  "",
  "   ",
  123,
  {},
  [],
  "bad\r",
  "bad\n",
  "bad\u0000",
  "bad\u007f",
  ".",
  "..",
  "a/b",
  "a\\b",
  "a?b",
  "a#b",
  "%2e%2e",
  "%252e%252e",
  "%2f",
  "%252f",
  "%5c",
  "%255c",
  "%250a",
  "%25250a",
  "%25252525252525252561"
] as const;

describe("WATS-42A read-only business/admin endpoint callables", () => {
  test("direct WABA and phone-number callables build exact GET URLs and query strings", async () => {
    const { client, handle } = clientWith([
      ok({ id: "waba-1", name: "Acme" }),
      ok({ data: [{ app_id: "app-1" }] }),
      ok({ data: [{ id: "pn-1" }] }),
      ok({ id: "pn-1", display_phone_number: "+1 555" }),
      ok({ data: [{ call_hours: { status: "ENABLED" } }] }),
      ok({ data: [{ about: "hello" }] }),
      ok({ data: [{ is_cart_enabled: true }] })
    ]);

    const wabaInfo: WabaInfo = await getWabaInfo(client, {
      wabaId: "waba-1",
      fields: ["id", "name", "business_verification_status"]
    });
    const apps: SubscribedAppsResponse = await listSubscribedApps(client, { wabaId: "waba-1" });
    const phones: PhoneNumberListResponse = await listPhoneNumbers(client, {
      wabaId: "waba-1",
      fields: "id,display_phone_number,quality_rating",
      limit: "25",
      after: "AFTER",
      before: "BEFORE"
    });
    const phoneInfo: PhoneNumberInfo = await getPhoneNumberInfo(client, {
      phoneNumberId: "pn-1",
      fields: ["id", "display_phone_number", "quality_rating"]
    });
    const settings: PhoneNumberSettingsResponse = await getPhoneNumberSettings(client, {
      phoneNumberId: "pn-1",
      fields: "calling",
      includeSipCredentials: true
    });
    const profile: BusinessProfileResponse = await getBusinessProfile(client, {
      phoneNumberId: "pn-1",
      fields: ["about", "address", "websites"]
    });
    const commerce: CommerceSettingsResponse = await getCommerceSettings(client, {
      phoneNumberId: "pn-1",
      fields: ["is_cart_enabled", "is_catalog_visible"]
    });

    expect(wabaInfo.id).toBe("waba-1");
    expect(apps.data?.[0]?.app_id).toBe("app-1");
    expect(phones.data?.[0]?.id).toBe("pn-1");
    expect(phoneInfo.id).toBe("pn-1");
    expect(settings.data?.[0]).toEqual({ call_hours: { status: "ENABLED" } });
    expect(profile.data?.[0]?.about).toBe("hello");
    expect(commerce.data?.[0]?.is_cart_enabled).toBe(true);
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/waba-1?fields=id%2Cname%2Cbusiness_verification_status",
      "GET https://graph.facebook.com/v25.0/waba-1/subscribed_apps",
      "GET https://graph.facebook.com/v25.0/waba-1/phone_numbers?fields=id%2Cdisplay_phone_number%2Cquality_rating&limit=25&after=AFTER&before=BEFORE",
      "GET https://graph.facebook.com/v25.0/pn-1?fields=id%2Cdisplay_phone_number%2Cquality_rating",
      "GET https://graph.facebook.com/v25.0/pn-1/settings?fields=calling&include_sip_credentials=true",
      "GET https://graph.facebook.com/v25.0/pn-1/whatsapp_business_profile?fields=about%2Caddress%2Cwebsites",
      "GET https://graph.facebook.com/v25.0/pn-1/whatsapp_commerce_settings?fields=is_cart_enabled%2Cis_catalog_visible"
    ]);
  });



  test("WATS-169 getPhoneNumberSettings exposes SIP credential response aliases in camelCase", async () => {
    const { client, handle } = clientWith(ok({
      data: [
        {
          calling: {
            sip: {
              servers: [
                {
                  hostname: "sip.example.com",
                  port: 5061,
                  request_uri_user_params: { transport: "tls" },
                  sip_user_password: "SECRET_SIP_PASSWORD_DO_NOT_LOG",
                  app_id: 12345
                }
              ]
            }
          }
        }
      ]
    }));

    const settings = await getPhoneNumberSettings(client, {
      phoneNumberId: "pn-1",
      fields: "calling",
      includeSipCredentials: true
    });

    const server = settings.data?.[0]?.calling?.sip?.servers?.[0];
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/pn-1/settings?fields=calling&include_sip_credentials=true");
    expect(server?.sipUserPassword).toBe("SECRET_SIP_PASSWORD_DO_NOT_LOG");
    expect(server?.appId).toBe(12345);
    expect(server?.sip_user_password).toBeUndefined();
    expect(server?.app_id).toBeUndefined();
  });

  test("WATS-169 getWabaInfo exposes calling SIP health status in camelCase", async () => {
    const { client } = clientWith(ok({
      id: "waba-1",
      health_status: {
        can_receive_call_sip: true,
        entities: [{ entity_type: "PHONE_NUMBER", can_receive_call_sip: false }]
      }
    }));

    const info = await getWabaInfo(client, { wabaId: "waba-1", fields: ["health_status"] });

    expect(info.healthStatus?.canReceiveCallSip).toBe(true);
    expect(info.healthStatus?.entities?.[0]?.canReceiveCallSip).toBe(false);
    expect(info.health_status).toBeUndefined();
  });

  test("getPhoneNumberSettings omits include_sip_credentials by default and serializes false only when provided", async () => {
    const { client, handle } = clientWith([ok({ data: [] }), ok({ data: [] })]);
    await getPhoneNumberSettings(client, { phoneNumberId: "pn-1" });
    await getPhoneNumberSettings(client, { phoneNumberId: "pn-1", includeSipCredentials: false });
    expect(handle.requests.map((r) => r.url)).toEqual([
      "https://graph.facebook.com/v25.0/pn-1/settings",
      "https://graph.facebook.com/v25.0/pn-1/settings?include_sip_credentials=false"
    ]);
  });

  test("WATS-74 direct profile and commerce mutations map camelCase inputs to Graph snake_case bodies", async () => {
    const { client, handle } = clientWith([
      ok({ success: true }),
      ok({ success: true })
    ]);

    await updateBusinessProfile(client, {
      phoneNumberId: "pn-1",
      about: "About WATS",
      address: "1 Framework Way",
      description: "Composable WhatsApp framework",
      email: "ops@example.test",
      vertical: "PROF_SERVICES",
      websites: ["https://example.test", "https://docs.example.test"],
      profilePictureHandle: "pic-handle"
    });
    await updateCommerceSettings(client, {
      phoneNumberId: "pn-1",
      isCartEnabled: true,
      isCatalogVisible: false
    });

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/pn-1/whatsapp_business_profile",
      "POST https://graph.facebook.com/v25.0/pn-1/whatsapp_commerce_settings"
    ]);
    expect(JSON.parse(String(handle.requests[0]?.body))).toEqual({
      messaging_product: "whatsapp",
      about: "About WATS",
      address: "1 Framework Way",
      description: "Composable WhatsApp framework",
      email: "ops@example.test",
      vertical: "PROF_SERVICES",
      websites: ["https://example.test", "https://docs.example.test"],
      profile_picture_handle: "pic-handle"
    });
    expect(JSON.parse(String(handle.requests[1]?.body))).toEqual({
      is_cart_enabled: true,
      is_catalog_visible: false
    });
  });
});

describe("WATS-42A scoped WABAClient and PhoneNumberClient methods", () => {
  test("scoped clients inject constructor-bound ids and ignore caller override ids", async () => {
    const { client, handle } = clientWith([
      ok({ id: "BOUND-WABA" }),
      ok({ data: [] }),
      ok({ data: [] }),
      ok({ id: "BOUND-PHONE" }),
      ok({ data: [] }),
      ok({ data: [] }),
      ok({ data: [] }),
      ok({ success: true }),
      ok({ success: true })
    ]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PHONE" });

    await waba.getInfo({ wabaId: "OVERRIDE", fields: ["id"] } as never);
    await waba.listSubscribedApps({ wabaId: "OVERRIDE" } as never);
    await waba.listPhoneNumbers({ wabaId: "OVERRIDE", limit: "5" } as never);
    await phone.getInfo({ phoneNumberId: "OVERRIDE", fields: ["id"] } as never);
    await phone.getSettings({ phoneNumberId: "OVERRIDE", includeSipCredentials: true } as never);
    await phone.getBusinessProfile({ phoneNumberId: "OVERRIDE", fields: ["about"] } as never);
    await phone.getCommerceSettings({ phoneNumberId: "OVERRIDE", fields: ["is_cart_enabled"] } as never);
    await phone.updateBusinessProfile({ phoneNumberId: "OVERRIDE", about: "Bound about" } as never);
    await phone.updateCommerceSettings({ phoneNumberId: "OVERRIDE", isCartEnabled: false } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/BOUND-WABA?fields=id",
      "GET https://graph.facebook.com/v25.0/BOUND-WABA/subscribed_apps",
      "GET https://graph.facebook.com/v25.0/BOUND-WABA/phone_numbers?limit=5",
      "GET https://graph.facebook.com/v25.0/BOUND-PHONE?fields=id",
      "GET https://graph.facebook.com/v25.0/BOUND-PHONE/settings?include_sip_credentials=true",
      "GET https://graph.facebook.com/v25.0/BOUND-PHONE/whatsapp_business_profile?fields=about",
      "GET https://graph.facebook.com/v25.0/BOUND-PHONE/whatsapp_commerce_settings?fields=is_cart_enabled",
      "POST https://graph.facebook.com/v25.0/BOUND-PHONE/whatsapp_business_profile",
      "POST https://graph.facebook.com/v25.0/BOUND-PHONE/whatsapp_commerce_settings"
    ]);
    expect(JSON.parse(String(handle.requests[7]?.body))).toEqual({
      messaging_product: "whatsapp",
      about: "Bound about"
    });
    expect(JSON.parse(String(handle.requests[8]?.body))).toEqual({
      is_cart_enabled: false
    });
  });

  test("constructor-bound WABA ids reject encoded traversal and excessive percent encoding", () => {
    const { client } = clientWith(ok());
    for (const bad of ["%2e%2e", "%252e%252e", "%2f", "%252f", "%25252525252f", "%25252525252525252561"]) {
      expect(() => new WABAClient({ graphClient: client, wabaId: bad })).toThrow(GraphRequestValidationError);
    }
  });
});

describe("WATS-42A request-shape validation and fail-closed sanitization", () => {
  test("wabaId and phoneNumberId reject raw, encoded, double-encoded, control, and excessive-encoded values before transport", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(getWabaInfo(client, { wabaId: bad as never })).rejects.toThrow(GraphRequestValidationError);
      await expect(getPhoneNumberInfo(client, { phoneNumberId: bad as never })).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("path-id validation preserves representative messages and malformed-percent cause", async () => {
    const { client, handle } = clientWith(ok());
    const cases = [
      { value: 42, message: "Invalid getWabaInfo input: wabaId must be a string." },
      { value: "", message: "Invalid getWabaInfo input: wabaId must be non-empty." },
      { value: "   ", message: "Invalid getWabaInfo input: wabaId must be non-empty." },
      { value: "bad\n", message: "Invalid getWabaInfo input: wabaId must not contain control characters." },
      { value: "../evil", message: "Invalid getWabaInfo input: wabaId contains an unsafe path segment." },
      { value: "%E0%A4%A", message: "Invalid getWabaInfo input: wabaId contains malformed percent encoding.", hasCause: true },
      { value: "%25252525252525252561", message: "Invalid getWabaInfo input: wabaId contains excessive percent encoding." }
    ] as const;

    for (const c of cases) {
      let thrown: unknown;
      try {
        await getWabaInfo(client, { wabaId: c.value as never });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect((thrown as Error).message).toBe(c.message);
      if ("hasCause" in c && c.hasCause === true) {
        expect((thrown as GraphRequestValidationError).cause).toBeInstanceOf(Error);
      }
    }
    expect(handle.requests.length).toBe(0);
  });

  test("params and options reject accessor-backed fields without executing getters before transport", async () => {
    const { client, handle } = clientWith(ok());
    const accessorParams = {} as Record<string, unknown>;
    Object.defineProperty(accessorParams, "wabaId", {
      enumerable: true,
      get() { throw new Error("wabaId getter should not run"); }
    });
    await expect(getWabaInfo(client, accessorParams as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorFields = { wabaId: "waba-1" } as Record<string, unknown>;
    Object.defineProperty(accessorFields, "fields", {
      enumerable: true,
      get() { throw new Error("fields getter should not run"); }
    });
    await expect(getWabaInfo(client, accessorFields as never)).rejects.toThrow(GraphRequestValidationError);

    const symbolKey = Symbol("hidden-business-param");
    await expect(getWabaInfo(client, { wabaId: "waba-1", [symbolKey]: "hidden" } as never)).rejects.toThrow(GraphRequestValidationError);

    const descriptorTrapParams = new Proxy({}, {
      ownKeys() {
        return ["wabaId"];
      },
      getOwnPropertyDescriptor() {
        throw new Error("business params descriptor trap should be wrapped");
      }
    });
    let trapped: unknown;
    try {
      await getWabaInfo(client, descriptorTrapParams as never);
    } catch (error) {
      trapped = error;
    }
    expect(trapped).toBeInstanceOf(GraphRequestValidationError);
    expect((trapped as GraphRequestValidationError).cause).toBeInstanceOf(Error);

    const accessorOpts = {} as Record<string, unknown>;
    Object.defineProperty(accessorOpts, "headers", {
      enumerable: true,
      get() { throw new Error("headers getter should not run"); }
    });
    await expect(getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, accessorOpts as never)).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("headers prototype inspection traps reject before transport", async () => {
    const { client, handle } = clientWith(ok());
    const headers = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("business headers proto trap");
      }
    });

    let thrown: unknown;
    try {
      await getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect((thrown as GraphRequestValidationError).cause).toBeInstanceOf(Error);
    expect(((thrown as GraphRequestValidationError).cause as Error).message).toBe("business headers proto trap");
    expect(handle.requests.length).toBe(0);
  });

  test("headers second prototype traps reject before transport", async () => {
    const { client, handle } = clientWith(ok());
    let protoCalls = 0;
    const headers = new Proxy(Object.create(Headers.prototype), {
      getPrototypeOf() {
        protoCalls += 1;
        if (protoCalls === 1) return Headers.prototype;
        throw new Error("business headers second proto trap");
      }
    });

    let thrown: unknown;
    try {
      await getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect((thrown as GraphRequestValidationError).cause).toBeInstanceOf(Error);
    expect(protoCalls).toBe(1);
    expect(handle.requests.length).toBe(0);
  });

  test("spoofed Headers iterator options reject before transport", async () => {
    const { client, handle } = clientWith(ok());
    let plainIteratorConsumed = false;
    const spoofIter = {};
    Object.setPrototypeOf(spoofIter, Headers.prototype);
    Object.defineProperty(spoofIter, Symbol.iterator, {
      enumerable: true,
      value: function* () {
        plainIteratorConsumed = true;
        yield ["x-spoof", "v"];
      }
    });

    let proxyIteratorReads = 0;
    let proxyIteratorConsumed = false;
    const proxySpoofIter = new Proxy({}, {
      getPrototypeOf() {
        return Headers.prototype;
      },
      get(target, key, receiver) {
        if (key === Symbol.iterator) {
          proxyIteratorReads += 1;
          return function* () {
            proxyIteratorConsumed = true;
            yield ["x-proxy", "v"];
          };
        }
        return Reflect.get(target, key, receiver);
      }
    });

    await expect(
      getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: spoofIter } as never)
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: proxySpoofIter } as never)
    ).rejects.toThrow(GraphRequestValidationError);

    expect(plainIteratorConsumed).toBe(false);
    expect(proxyIteratorReads).toBe(0);
    expect(proxyIteratorConsumed).toBe(false);
    expect(handle.requests.length).toBe(0);
  });

  test("fields arrays are descriptor-safe, cloned, joined, and capped", async () => {
    const { client, handle } = clientWith(ok({ id: "waba-1" }));
    const fields = ["id", "name"];
    await getWabaInfo(client, { wabaId: "waba-1", fields });
    fields[0] = "MUTATED";
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/waba-1?fields=id%2Cname");

    const sparse = ["id", , "name"] as unknown[];
    const accessorArray = ["id"] as unknown[];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() { throw new Error("array getter should not run"); }
    });
    const withToJson = ["id"] as unknown[] & { toJSON?: () => unknown };
    withToJson.toJSON = () => ["id"];
    const withUnsafeKey = ["id"] as unknown[];
    Object.defineProperty(withUnsafeKey, "constructor", { value: "bad", enumerable: true });
    const withUnsupportedProperty = ["id"] as unknown[];
    Object.defineProperty(withUnsupportedProperty, "extra", { value: "bad", enumerable: true });
    const withOwnIterator = ["id"] as unknown[];
    Object.defineProperty(withOwnIterator, Symbol.iterator, { value: function* () { yield "evil"; }, enumerable: true });
    const withOwnMap = ["id"] as unknown[];
    Object.defineProperty(withOwnMap, "map", { value: () => ["evil"], enumerable: true });
    const symbolKey = Symbol("hidden-field");
    const withSymbolKey = Object.assign(["id"], { [symbolKey]: "name" });
    const unsafeParams = JSON.parse('{"wabaId":"waba-1","__proto__":{"polluted":true},"fields":["id"]}');

    const cases = [
      { value: 42, message: "Invalid getWabaInfo input: fields must be a string or array of strings." },
      { value: "", message: "Invalid getWabaInfo input: fields must be non-empty." },
      { value: "   ", message: "Invalid getWabaInfo input: fields must be non-empty." },
      { value: "bad\n", message: "Invalid getWabaInfo input: fields must not contain control characters." },
      { value: "x".repeat(1025), message: "Invalid getWabaInfo input: fields exceeds 1024-character limit." },
      { value: [], message: "Invalid getWabaInfo input: fields length must be between 1 and 50." },
      {
        value: Array.from({ length: 51 }, (_, index) => `f${index}`),
        message: "Invalid getWabaInfo input: fields length must be between 1 and 50."
      },
      { value: ["id", ""], message: "Invalid getWabaInfo input: fields[1] must be non-empty." },
      { value: ["id", "   "], message: "Invalid getWabaInfo input: fields[1] must be non-empty." },
      { value: ["id", 123], message: "Invalid getWabaInfo input: fields[1] must be a string." },
      { value: ["id", "bad\u0000"], message: "Invalid getWabaInfo input: fields[1] must not contain control characters." },
      { value: ["id", "bad,name"], message: "Invalid getWabaInfo input: fields array entries must not contain commas." },
      { value: ["id", "x".repeat(129)], message: "Invalid getWabaInfo input: fields[1] exceeds 128-character limit." },
      { value: sparse, message: "Invalid getWabaInfo input: fields must not contain sparse array holes." },
      { value: accessorArray, message: "Invalid getWabaInfo input: fields must not use accessors." },
      { value: withToJson, message: "Invalid getWabaInfo input: fields must not define toJSON." },
      { value: withUnsafeKey, message: "Invalid getWabaInfo input: fields contains an unsafe prototype key." },
      { value: withUnsupportedProperty, message: "Invalid getWabaInfo input: fields contains unsupported properties." },
      { value: withOwnIterator, message: "Invalid getWabaInfo input: fields must not override Array.prototype methods." },
      { value: withOwnMap, message: "Invalid getWabaInfo input: fields must not override Array.prototype methods." },
      { value: withSymbolKey, message: "Invalid getWabaInfo input: fields must not contain symbol keys." }
    ] as const;

    for (const c of cases) {
      let thrown: unknown;
      try {
        await getWabaInfo(client, { wabaId: "waba-1", fields: c.value as never });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect((thrown as Error).message).toBe(c.message);
    }
    await expect(getWabaInfo(client, unsafeParams as never)).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(1);
  });

  test("includeSipCredentials accepts booleans only", async () => {
    const { client, handle } = clientWith([ok({ data: [] }), ok({ data: [] })]);
    await getPhoneNumberSettings(client, { phoneNumberId: "pn-1", includeSipCredentials: true });
    await getPhoneNumberSettings(client, { phoneNumberId: "pn-1", includeSipCredentials: false });
    for (const bad of ["true", "false", 1, 0, null, {}, []]) {
      await expect(getPhoneNumberSettings(client, { phoneNumberId: "pn-1", includeSipCredentials: bad as never })).rejects.toThrow(GraphRequestValidationError);
    }
    expect(handle.requests.length).toBe(2);
  });

  test("query-string validation preserves representative messages before transport", async () => {
    const { client, handle } = clientWith(ok({ data: [] }));
    const cases = [
      {
        value: 42,
        call: () => listPhoneNumbers(client, { wabaId: "waba-1", limit: 42 as never }),
        message: "Invalid listPhoneNumbers input: limit must be a string."
      },
      {
        value: "",
        call: () => listPhoneNumbers(client, { wabaId: "waba-1", limit: "" }),
        message: "Invalid listPhoneNumbers input: limit must be non-empty."
      },
      {
        value: "   ",
        call: () => listPhoneNumbers(client, { wabaId: "waba-1", after: "   " }),
        message: "Invalid listPhoneNumbers input: after must be non-empty."
      },
      {
        value: "bad\n",
        call: () => getWabaInfo(client, { wabaId: "waba-1", fields: "bad\n" }),
        message: "Invalid getWabaInfo input: fields must not contain control characters."
      },
      {
        value: "x".repeat(33),
        call: () => listPhoneNumbers(client, { wabaId: "waba-1", limit: "x".repeat(33) }),
        message: "Invalid listPhoneNumbers input: limit exceeds 32-character limit."
      },
      {
        value: "x".repeat(513),
        call: () => listPhoneNumbers(client, { wabaId: "waba-1", before: "x".repeat(513) }),
        message: "Invalid listPhoneNumbers input: before exceeds 512-character limit."
      },
      {
        value: "x".repeat(1025),
        call: () => getWabaInfo(client, { wabaId: "waba-1", fields: "x".repeat(1025) }),
        message: "Invalid getWabaInfo input: fields exceeds 1024-character limit."
      }
    ] as const;

    for (const c of cases) {
      let thrown: unknown;
      try {
        await c.call();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(GraphRequestValidationError);
      expect((thrown as Error).message).toBe(c.message);
    }
    expect(handle.requests.length).toBe(0);
  });

  test("enhanced listPhoneNumbers rejects GET bodies and accessor-backed opts before transport", async () => {
    const { client, handle } = clientWith(ok({ data: [] }));
    await expect(listPhoneNumbers(client, { wabaId: "waba-1" }, { unexpected: true } as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorOpts = {} as Record<string, unknown>;
    Object.defineProperty(accessorOpts, "headers", {
      enumerable: true,
      get() { throw new Error("listPhoneNumbers opts getter should not run"); }
    });
    await expect(listPhoneNumbers(client, { wabaId: "waba-1" }, undefined, accessorOpts as never)).rejects.toThrow(GraphRequestValidationError);

    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await expect(waba.listPhoneNumbers({ limit: "5" }, accessorOpts as never)).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("opts.headers clone Headers and copy plain records before transport", async () => {
    const { client, handle } = clientWith([ok({ id: "pn-1" }), ok({ id: "pn-1" })]);

    const headers = new Headers({ "x-business-safe": "before" });
    await getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers });
    headers.set("x-business-safe", "after");

    const recordHeaders: Record<string, string> = { "x-business-record": "record-before" };
    await getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: recordHeaders });
    recordHeaders["x-business-record"] = "record-after";

    expect(handle.requests[0]?.headers.get("x-business-safe")).toBe("before");
    expect(handle.requests[1]?.headers.get("x-business-record")).toBe("record-before");
  });

  test("opts.headers malformed shapes, accessors, non-string values, symbols, and unsafe keys reject before transport", async () => {
    const { client, handle } = clientWith(ok({ id: "pn-1" }));
    const customPrototype = Object.create({ inherited: true });
    customPrototype["x-business"] = "ok";

    for (const bad of [null, 42, "x", [], () => undefined, customPrototype]) {
      await expect(
        getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: bad as never })
      ).rejects.toThrow(GraphRequestValidationError);
    }

    let accessorInvoked = false;
    const accessorHeaders = {} as Record<string, string>;
    Object.defineProperty(accessorHeaders, "x-business-danger", {
      enumerable: true,
      get() {
        accessorInvoked = true;
        throw new Error("business header getter should not run");
      }
    });
    let accessorThrown: unknown;
    try {
      await getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: accessorHeaders });
    } catch (error) {
      accessorThrown = error;
    }
    expect(accessorThrown).toBeInstanceOf(GraphRequestValidationError);
    expect((accessorThrown as Error).message).toBe("Invalid getPhoneNumberInfo options: headers must not use accessors.");
    expect(accessorInvoked).toBe(false);

    for (const badValue of [1, false, {}, [], () => undefined, Symbol("header"), 1n]) {
      let valueThrown: unknown;
      try {
        await getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, {
          headers: { "x-business-value": badValue } as never
        });
      } catch (error) {
        valueThrown = error;
      }
      expect(valueThrown).toBeInstanceOf(GraphRequestValidationError);
      expect((valueThrown as Error).message).toBe("Invalid getPhoneNumberInfo options: header values must be strings.");
    }

    const symbolKey = Symbol("business-header");
    await expect(
      getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: { [symbolKey]: "hidden" } as never })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: JSON.parse('{"__proto__":"polluted"}') })
    ).rejects.toThrow(GraphRequestValidationError);

    expect(handle.requests.length).toBe(0);
  });

  test("opts.headers authorization override and CR/LF/NUL keep GraphRequestValidationError taxonomy", async () => {
    const { client, handle } = clientWith(ok({ id: "pn-1" }));
    await expect(
      getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: { authorization: "Bearer evil" } })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: { "x-bad\nname": "value" } })
    ).rejects.toThrow(GraphRequestValidationError);
    await expect(
      getPhoneNumberInfo(client, { phoneNumberId: "pn-1" }, undefined, { headers: { "x-bad-value": "bad\u0000value" } })
    ).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("WATS-74 profile and commerce mutation bodies reject missing writes, malformed fields, accessors, and symbols before transport", async () => {
    const { client, handle } = clientWith(ok({ success: true }));
    await expect(updateBusinessProfile(client, { phoneNumberId: "pn-1" } as never)).rejects.toThrow(GraphRequestValidationError);
    await expect(updateCommerceSettings(client, { phoneNumberId: "pn-1" } as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorProfile = { phoneNumberId: "pn-1" } as Record<string, unknown>;
    Object.defineProperty(accessorProfile, "about", {
      enumerable: true,
      get() { throw new Error("about getter should not run"); }
    });
    await expect(updateBusinessProfile(client, accessorProfile as never)).rejects.toThrow(GraphRequestValidationError);

    const symbolProfile = { phoneNumberId: "pn-1", about: "ok", [Symbol("hidden")]: "bad" };
    await expect(updateBusinessProfile(client, symbolProfile as never)).rejects.toThrow(GraphRequestValidationError);

    for (const bad of ["", "   ", 123, null, {}, [], "bad\n", "x".repeat(1025)]) {
      await expect(updateBusinessProfile(client, { phoneNumberId: "pn-1", about: bad as never })).rejects.toThrow(GraphRequestValidationError);
    }
    await expect(updateBusinessProfile(client, { phoneNumberId: "pn-1", websites: [] })).rejects.toThrow(GraphRequestValidationError);
    await expect(updateBusinessProfile(client, { phoneNumberId: "pn-1", websites: ["https://ok.example", "bad\nurl"] })).rejects.toThrow(GraphRequestValidationError);
    await expect(updateBusinessProfile(client, { phoneNumberId: "pn-1", profilePictureHandle: "bad\u0000handle" })).rejects.toThrow(GraphRequestValidationError);

    for (const bad of ["true", 1, null, {}, []]) {
      await expect(updateCommerceSettings(client, { phoneNumberId: "pn-1", isCartEnabled: bad as never })).rejects.toThrow(GraphRequestValidationError);
    }

    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-42A Graph error taxonomy", () => {
  test("Graph errors after transport preserve existing F-5 subclasses with sibling-NOT assertions", async () => {
    const { client, handle } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: { error: { message: "Invalid parameter", code: 100, type: "OAuthException" } }
    });
    let thrown: unknown;
    try {
      await getPhoneNumberInfo(client, { phoneNumberId: "pn-1" });
    } catch (error) {
      thrown = error;
    }
    expect(handle.requests.length).toBe(1);
    expect(thrown).toBeInstanceOf(InvalidParameterError);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
  });
});
