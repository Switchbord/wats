import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  WABAClient,
  createTemplateGroup,
  deleteTemplateGroup,
  getTemplateGroup,
  getTemplateGroupAnalytics,
  listTemplateGroups,
  updateTemplateGroup,
  type TemplateGroupAnalyticsResponse,
  type TemplateGroupDetails,
  type TemplateGroupListResponse,
  type TemplateGroupMutationResponse
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

function ok(body: object = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): unknown {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

describe("WATS-94 template group endpoint callables", () => {
  test("list/create/get/update/delete template groups and analytics use exact Graph request shapes", async () => {
    const { client, handle } = clientWith([
      ok({ data: [{ id: "tg-1", name: "Winter promo" }], paging: { cursors: { after: "NEXT" } } }),
      ok({ id: "tg-2", success: true }),
      ok({ id: "tg-1", name: "Winter promo" }),
      ok({ id: "tg-1", success: true }),
      ok({ success: true }),
      ok({ data: [{ template_group_id: "tg-1", sent: 7 }] })
    ]);

    const listed: TemplateGroupListResponse = await listTemplateGroups(client, {
      wabaId: "WABA-1",
      fields: "id,name,status",
      limit: "25",
      after: "AFTER",
      before: "BEFORE"
    });
    const created: TemplateGroupMutationResponse = await createTemplateGroup(client, { wabaId: "WABA-1" }, {
      name: "Winter promo",
      category: "MARKETING",
      language: "en_US",
      templateIds: ["tpl-1", "tpl-2"]
    });
    const details: TemplateGroupDetails = await getTemplateGroup(client, { templateGroupId: "tg-1", fields: "id,name" });
    await updateTemplateGroup(client, { templateGroupId: "tg-1" }, { name: "Winter promo v2", templateIds: ["tpl-2"] });
    await deleteTemplateGroup(client, { templateGroupId: "tg-1" });
    const analytics: TemplateGroupAnalyticsResponse = await getTemplateGroupAnalytics(client, {
      wabaId: "WABA-1",
      templateGroupId: "tg-1",
      start: "2026-01-01",
      end: "2026-01-31",
      granularity: "DAILY",
      metricTypes: ["sent", "delivered"]
    });

    expect(listed.data?.[0]?.id).toBe("tg-1");
    expect(created.id).toBe("tg-2");
    expect(details.id).toBe("tg-1");
    expect(analytics.data?.[0]?.template_group_id).toBe("tg-1");
    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/WABA-1/template_groups?fields=id%2Cname%2Cstatus&limit=25&after=AFTER&before=BEFORE",
      "POST https://graph.facebook.com/v25.0/WABA-1/template_groups",
      "GET https://graph.facebook.com/v25.0/tg-1?fields=id%2Cname",
      "POST https://graph.facebook.com/v25.0/tg-1",
      "DELETE https://graph.facebook.com/v25.0/tg-1",
      "GET https://graph.facebook.com/v25.0/WABA-1/template_group_analytics?template_group_id=tg-1&start=2026-01-01&end=2026-01-31&granularity=DAILY&metric_types=sent%2Cdelivered"
    ]);
    expect(parseBody(handle.requests[1]?.body)).toEqual({
      name: "Winter promo",
      category: "MARKETING",
      language: "en_US",
      template_ids: ["tpl-1", "tpl-2"]
    });
    expect(parseBody(handle.requests[3]?.body)).toEqual({
      name: "Winter promo v2",
      template_ids: ["tpl-2"]
    });
  });

  test("template group ids and query values reject unsafe input before transport", async () => {
    const { client, handle } = clientWith(ok());
    await expect(getTemplateGroup(client, { templateGroupId: "../evil" })).rejects.toThrow(GraphRequestValidationError);
    await expect(deleteTemplateGroup(client, { templateGroupId: "bad\n" })).rejects.toThrow(GraphRequestValidationError);
    await expect(listTemplateGroups(client, { wabaId: "WABA-1", after: "" })).rejects.toThrow(GraphRequestValidationError);
    await expect(getTemplateGroupAnalytics(client, { wabaId: "WABA-1", templateGroupId: "tg-1", metricTypes: [] })).rejects.toThrow(GraphRequestValidationError);
    await expect(createTemplateGroup(client, { wabaId: "WABA-1" }, { name: "", category: "MARKETING" })).rejects.toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });
});

describe("WATS-94 WABAClient template group methods", () => {
  test("WABAClient injects the bound wabaId for template group list/create/analytics", async () => {
    const { client, handle } = clientWith([ok({ data: [] }), ok({ success: true }), ok({ data: [] })]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });

    await waba.listTemplateGroups({ wabaId: "OVERRIDE", limit: "10" } as never);
    await waba.createTemplateGroup({ name: "Launch", category: "UTILITY" });
    await waba.getTemplateGroupAnalytics({ wabaId: "OVERRIDE", templateGroupId: "tg-1" } as never);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/BOUND-WABA/template_groups?limit=10",
      "POST https://graph.facebook.com/v25.0/BOUND-WABA/template_groups",
      "GET https://graph.facebook.com/v25.0/BOUND-WABA/template_group_analytics?template_group_id=tg-1"
    ]);
  });

  test("WABAClient exposes template group get/update/delete path-scope methods", async () => {
    const { client, handle } = clientWith([ok({ id: "tg-1" }), ok({ success: true }), ok({ success: true })]);
    const waba = new WABAClient({ graphClient: client, wabaId: "BOUND-WABA" });
    await waba.getTemplateGroup({ templateGroupId: "tg-1" });
    await waba.updateTemplateGroup({ templateGroupId: "tg-1", name: "Updated" });
    await waba.deleteTemplateGroup({ templateGroupId: "tg-1" });

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://graph.facebook.com/v25.0/tg-1",
      "POST https://graph.facebook.com/v25.0/tg-1",
      "DELETE https://graph.facebook.com/v25.0/tg-1"
    ]);
  });
});
