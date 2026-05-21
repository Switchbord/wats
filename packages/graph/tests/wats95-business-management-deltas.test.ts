import { describe, expect, test } from "bun:test";
import {
  GraphApiError,
  GraphAuthError,
  GraphClient,
  GraphRateLimitError,
  GraphRequestValidationError,
  PhoneNumberClient,
  blockUsers,
  getOfficialBusinessAccountStatus,
  getPhoneNumberInfo,
  listBlockedUsers,
  requestOfficialBusinessAccountReview,
  submitDisplayNameForReview,
  unblockUsers,
  type BlockUsersResponse,
  type BlockedUsersResponse,
  type OfficialBusinessAccountStatusResponse,
  type PhoneNumberInfo,
  type SubmitDisplayNameForReviewResponse,
  type UnblockUsersResponse
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

function ok(body: object = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
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
  "%252f"
] as const;

describe("WATS-95 Block API callables", () => {
  test("list, block, and unblock users build exact block_users requests", async () => {
    const { client, handle } = clientWith([
      ok({ data: [{ messaging_product: "whatsapp", wa_id: "16505551234" }], paging: { cursors: { after: "A", before: "B" } } }),
      ok({ block_users: { added_users: [{ input: "+16505551234", wa_id: "16505551234" }] }, messaging_product: "whatsapp" }),
      ok({ block_users: { removed_users: [{ input: "+16505551234", wa_id: "16505551234" }] }, messaging_product: "whatsapp" })
    ]);

    const listed: BlockedUsersResponse = await listBlockedUsers(client, { phoneNumberId: "pn-1" });
    const blocked: BlockUsersResponse = await blockUsers(client, {
      phoneNumberId: "pn-1",
      users: ["+16505551234"]
    });
    const unblocked: UnblockUsersResponse = await unblockUsers(client, {
      phoneNumberId: "pn-1",
      users: ["+16505551234"]
    });

    expect(listed.data?.[0]?.wa_id).toBe("16505551234");
    expect(blocked.block_users?.added_users?.[0]?.wa_id).toBe("16505551234");
    expect(unblocked.block_users?.removed_users?.[0]?.wa_id).toBe("16505551234");
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/pn-1/block_users",
      "POST https://graph.facebook.com/v25.0/pn-1/block_users",
      "DELETE https://graph.facebook.com/v25.0/pn-1/block_users"
    ]);
    expect(parseBody(handle.requests[1]?.body)).toEqual({
      messaging_product: "whatsapp",
      block_users: [{ user: "+16505551234" }]
    });
    expect(parseBody(handle.requests[2]?.body)).toEqual({
      messaging_product: "whatsapp",
      block_users: [{ user: "+16505551234" }]
    });
  });

  test("PhoneNumberClient injects bound phoneNumberId for block operations", async () => {
    const { client, handle } = clientWith([ok({ data: [] }), ok(), ok()]);
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PN" });

    await phone.listBlockedUsers({ phoneNumberId: "OVERRIDE" } as never);
    await phone.blockUsers({ phoneNumberId: "OVERRIDE", users: ["15551234567"] } as never);
    await phone.unblockUsers({ phoneNumberId: "OVERRIDE", users: ["15551234567"] } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/BOUND-PN/block_users",
      "POST https://graph.facebook.com/v25.0/BOUND-PN/block_users",
      "DELETE https://graph.facebook.com/v25.0/BOUND-PN/block_users"
    ]);
  });

  test("Block API validates path ids, user arrays, user strings, GET body, and options before transport", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(listBlockedUsers(client, { phoneNumberId: bad as never })).rejects.toThrow(GraphRequestValidationError);
      await expect(blockUsers(client, { phoneNumberId: bad as never, users: ["15551234567"] })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badUsers of [null, undefined, "1555", [], ["1555", ""], ["1555", "   "], ["1555", "bad\n"], ["1555", 123], Array.from({ length: 51 }, (_, index) => `1555000${index}`)]) {
      await expect(blockUsers(client, { phoneNumberId: "pn-1", users: badUsers as never })).rejects.toThrow(GraphRequestValidationError);
    }

    const accessorUsers = ["15551234567"] as unknown[];
    Object.defineProperty(accessorUsers, "0", {
      enumerable: true,
      get() { throw new Error("block user getter should not run"); }
    });
    await expect(blockUsers(client, { phoneNumberId: "pn-1", users: accessorUsers as never })).rejects.toThrow(GraphRequestValidationError);
    await expect(listBlockedUsers(client, { phoneNumberId: "pn-1" }, { unexpected: true } as never)).rejects.toThrow(GraphRequestValidationError);

    const accessorOpts = {} as Record<string, unknown>;
    Object.defineProperty(accessorOpts, "headers", {
      enumerable: true,
      get() { throw new Error("headers getter should not run"); }
    });
    await expect(blockUsers(client, { phoneNumberId: "pn-1", users: ["15551234567"] }, undefined, accessorOpts as never)).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-95 phone-number display-name and OBA helpers", () => {
  test("GET OBA status, POST OBA review, POST display-name review, and name_status reads use confirmed wire fields", async () => {
    const { client, handle } = clientWith([
      ok({ id: "pn-1", oba_status: "PENDING", status_message: "Under review" }),
      ok({ success: true, message: "submitted", tracking_id: "trk-1" }),
      ok({ success: true }),
      ok({ id: "pn-1", name_status: "PENDING_REVIEW", verified_name: "Acme" })
    ]);

    const status: OfficialBusinessAccountStatusResponse = await getOfficialBusinessAccountStatus(client, {
      phoneNumberId: "pn-1",
      fields: ["oba_status", "status_message"]
    });
    await requestOfficialBusinessAccountReview(client, {
      phoneNumberId: "pn-1",
      businessWebsiteUrl: "https://example.com",
      primaryCountryOfOperation: "US",
      primaryLanguage: "en",
      parentBusinessOrBrand: "Acme",
      supportingLinks: [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
        "https://example.com/d",
        "https://example.com/e"
      ],
      additionalSupportingInformation: "Public brand evidence"
    });
    const displayName: SubmitDisplayNameForReviewResponse = await submitDisplayNameForReview(client, {
      phoneNumberId: "pn-1",
      newDisplayName: "Acme Support"
    });
    const info: PhoneNumberInfo = await getPhoneNumberInfo(client, {
      phoneNumberId: "pn-1",
      fields: ["name_status", "verified_name"]
    });

    expect(status.oba_status).toBe("PENDING");
    expect(displayName.success).toBe(true);
    expect(info.name_status).toBe("PENDING_REVIEW");
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/pn-1/official_business_account?fields=oba_status%2Cstatus_message",
      "POST https://graph.facebook.com/v25.0/pn-1/official_business_account",
      "POST https://graph.facebook.com/v25.0/pn-1",
      "GET https://graph.facebook.com/v25.0/pn-1?fields=name_status%2Cverified_name"
    ]);
    expect(parseBody(handle.requests[1]?.body)).toEqual({
      business_website_url: "https://example.com",
      primary_country_of_operation: "US",
      primary_language: "en",
      parent_business_or_brand: "Acme",
      supporting_links: [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
        "https://example.com/d",
        "https://example.com/e"
      ],
      additional_supporting_information: "Public brand evidence"
    });
    expect(parseBody(handle.requests[2]?.body)).toEqual({ new_display_name: "Acme Support" });
  });

  test("PhoneNumberClient injects bound id for OBA and display-name helpers", async () => {
    const { client, handle } = clientWith([ok({ id: "BOUND-PN" }), ok({ success: true }), ok({ success: true })]);
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "BOUND-PN" });

    await phone.getOfficialBusinessAccountStatus({ phoneNumberId: "OVERRIDE", fields: "oba_status" } as never);
    await phone.requestOfficialBusinessAccountReview({
      phoneNumberId: "OVERRIDE",
      businessWebsiteUrl: "https://example.com",
      primaryCountryOfOperation: "US"
    } as never);
    await phone.submitDisplayNameForReview({ phoneNumberId: "OVERRIDE", newDisplayName: "Acme Support" } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/BOUND-PN/official_business_account?fields=oba_status",
      "POST https://graph.facebook.com/v25.0/BOUND-PN/official_business_account",
      "POST https://graph.facebook.com/v25.0/BOUND-PN"
    ]);
  });

  test("OBA and display-name helpers reject malformed inputs before transport", async () => {
    const { client, handle } = clientWith(ok());
    for (const bad of unsafePathValues) {
      await expect(getOfficialBusinessAccountStatus(client, { phoneNumberId: bad as never })).rejects.toThrow(GraphRequestValidationError);
      await expect(submitDisplayNameForReview(client, { phoneNumberId: bad as never, newDisplayName: "Acme" })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badName of [null, undefined, "", "   ", "bad\nname", 123, {}, [], "x".repeat(129)]) {
      await expect(submitDisplayNameForReview(client, { phoneNumberId: "pn-1", newDisplayName: badName as never })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badUrl of [null, undefined, "", "   ", "notaurl", "ftp://example.com", "https://example.com/bad\n", 123]) {
      await expect(requestOfficialBusinessAccountReview(client, {
        phoneNumberId: "pn-1",
        businessWebsiteUrl: badUrl as never,
        primaryCountryOfOperation: "US"
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badCountry of [null, undefined, "", "   ", "bad\n", 123, "USA"]) {
      await expect(requestOfficialBusinessAccountReview(client, {
        phoneNumberId: "pn-1",
        businessWebsiteUrl: "https://example.com",
        primaryCountryOfOperation: badCountry as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    for (const badLinks of [["https://example.com/a", "notaurl"], Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`), "https://example.com/a", ["https://example.com/a", "https://example.com/a"]]) {
      await expect(requestOfficialBusinessAccountReview(client, {
        phoneNumberId: "pn-1",
        businessWebsiteUrl: "https://example.com",
        primaryCountryOfOperation: "US",
        supportingLinks: badLinks as never
      })).rejects.toThrow(GraphRequestValidationError);
    }

    const accessorParams = { phoneNumberId: "pn-1", newDisplayName: "Acme" } as Record<string, unknown>;
    Object.defineProperty(accessorParams, "newDisplayName", {
      enumerable: true,
      get() { throw new Error("display-name getter should not run"); }
    });
    await expect(submitDisplayNameForReview(client, accessorParams as never)).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("Graph errors after WATS-95 helpers preserve subclass taxonomy", async () => {
    const { client, handle } = clientWith({
      status: 400,
      headers: { "content-type": "application/json" },
      body: { error: { message: "Invalid parameter", code: 100, type: "OAuthException" } }
    });
    let thrown: unknown;
    try {
      await blockUsers(client, { phoneNumberId: "pn-1", users: ["15551234567"] });
    } catch (error) {
      thrown = error;
    }
    expect(handle.requests.length).toBe(1);
    expect(thrown).toBeInstanceOf(GraphApiError);
    expect(thrown).not.toBeInstanceOf(GraphAuthError);
    expect(thrown).not.toBeInstanceOf(GraphRateLimitError);
  });
});
