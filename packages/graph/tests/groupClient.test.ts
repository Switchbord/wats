// WATS-133 RED — scoped Groups clients over the endpoint family.
//
// These tests pin construction-time groupId validation, PhoneNumberClient
// Groups helpers, the phone.group(groupId) factory, and every GroupClient
// method injecting its bound id into exact Graph wire requests.

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  GroupClient,
  PhoneNumberClient,
  type GroupDetails,
  type GroupInviteLinkResponse,
  type GroupJoinRequestsResponse,
  type GroupMutationResponse,
  type ListGroupsResponse
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

type MockBody = string | Uint8Array | object | null;

function ok(body: MockBody = { success: true }): MockTransportResponseSpec {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function parseBody(body: unknown): Record<string, unknown> {
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

function snakeCaseKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => snakeCaseKeys(item, `${prefix}[${index}]`));
  }
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key;
    const own = key.includes("_") ? [path] : [];
    return [...own, ...snakeCaseKeys(nested, path)];
  });
}

describe("WATS-133 scoped Groups clients", () => {
  test("GroupClient rejects invalid groupId at construction and phone.group uses the same validation", () => {
    const { client } = clientWith(ok());
    expect(
      () => new GroupClient({ graphClient: client, groupId: "../evil" })
    ).toThrow(GraphRequestValidationError);

    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "555000111" });
    expect(() => phone.group("grp%252Fescape")).toThrow(GraphRequestValidationError);
  });

  test("PhoneNumberClient createGroup/listGroups inject bound phoneNumberId after caller params", async () => {
    const { client, handle } = clientWith([
      ok({ request_id: "req-create" }),
      ok({ data: { groups: [{ id: "grp-1", subject: "Team", created_at: "1700000000" }] } })
    ]);
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "555000111" });

    const created: GroupMutationResponse = await phone.createGroup({
      subject: "Team",
      description: "Scoped",
      joinApprovalMode: "approval_required",
      phoneNumberId: "999999999"
    } as unknown as Parameters<PhoneNumberClient["createGroup"]>[0]);
    const listed: ListGroupsResponse = await phone.listGroups({
      phoneNumberId: "999999999",
      limit: "25",
      after: "CUR"
    } as unknown as Parameters<PhoneNumberClient["listGroups"]>[0]);

    expect(created.requestId).toBe("req-create");
    const data = listed.data as { groups?: { id?: string }[] };
    expect(data.groups?.[0]?.id).toBe("grp-1");
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/555000111/groups");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      subject: "Team",
      description: "Scoped",
      join_approval_mode: "approval_required"
    });
    expect(handle.requests[1]?.method).toBe("GET");
    expect(handle.requests[1]?.url).toBe(
      "https://graph.facebook.com/v25.0/555000111/groups?limit=25&after=CUR"
    );
  });

  test("PhoneNumberClient group responses expose only camelCase public keys", async () => {
    const { client } = clientWith([
      ok({ request_id: "req-create" }),
      ok({ data: { groups: [{ id: "grp-1", subject: "Team", created_at: "1700000000" }] } })
    ]);
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "555000111" });

    const created = await phone.createGroup({ subject: "Team" });
    const listed = await phone.listGroups();

    expect(created).toEqual({ requestId: "req-create" });
    expect(listed.data?.groups?.[0]).toEqual({ id: "grp-1", subject: "Team", createdAt: "1700000000" });
    expect(snakeCaseKeys(created)).toEqual([]);
    expect(snakeCaseKeys(listed)).toEqual([]);
  });

  test("phone.group returns a GroupClient bound to the supplied groupId", async () => {
    const { client, handle } = clientWith(ok({ id: "grp-bound", subject: "Team" }));
    const phone = new PhoneNumberClient({ graphClient: client, phoneNumberId: "555000111" });

    const group = phone.group("grp-bound");
    expect(group).toBeInstanceOf(GroupClient);
    expect(group.groupId).toBe("grp-bound");
    expect(group.graphClient).toBe(client);

    const info: GroupDetails = await group.getInfo();
    expect(info.id).toBe("grp-bound");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound");
  });

  test("GroupClient read/link methods inject bound groupId and ignore caller groupId params", async () => {
    const { client, handle } = clientWith([
      ok({ id: "grp-bound", subject: "Team" }),
      ok({ invite_link: "https://chat.whatsapp.com/ABC123" }),
      ok({ invite_link: "https://chat.whatsapp.com/NEW999" }),
      ok({ data: [{ join_request_id: "jr-1", wa_id: "15551110002" }] })
    ]);
    const group = new GroupClient({ graphClient: client, groupId: "grp-bound" });

    await group.getInfo({ groupId: "grp-evil", fields: "id,subject" } as unknown as Parameters<GroupClient["getInfo"]>[0]);
    const link: GroupInviteLinkResponse = await group.getInviteLink({ groupId: "grp-evil" } as unknown as Parameters<GroupClient["getInviteLink"]>[0]);
    await group.resetInviteLink({ groupId: "grp-evil" } as unknown as Parameters<GroupClient["resetInviteLink"]>[0]);
    const requests: GroupJoinRequestsResponse = await group.getJoinRequests({
      groupId: "grp-evil",
      limit: "25",
      after: "CUR"
    } as unknown as Parameters<GroupClient["getJoinRequests"]>[0]);

    expect(link.inviteLink).toBe("https://chat.whatsapp.com/ABC123");
    expect(requests.data?.[0]?.joinRequestId).toBe("jr-1");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/grp-bound?fields=id%2Csubject"
    );
    expect(handle.requests[1]?.method).toBe("GET");
    expect(handle.requests[1]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound/invite_link");
    expect(handle.requests[2]?.method).toBe("POST");
    expect(handle.requests[2]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound/invite_link");
    expect(parseBody(handle.requests[2]?.body)).toEqual({ messaging_product: "whatsapp" });
    expect(handle.requests[3]?.method).toBe("GET");
    expect(handle.requests[3]?.url).toBe(
      "https://graph.facebook.com/v25.0/grp-bound/join_requests?limit=25&after=CUR"
    );
  });

  test("GroupClient read/link responses expose only camelCase public keys", async () => {
    const { client } = clientWith([
      ok({
        id: "grp-bound",
        subject: "Team",
        join_approval_mode: "approval_required",
        creation_timestamp: 1700000000,
        total_participant_count: 2,
        participants: [{ wa_id: "15551110000" }]
      }),
      ok({ invite_link: "https://chat.whatsapp.com/ABC123" }),
      ok({ data: [{ join_request_id: "jr-1", wa_id: "15551110002", creation_timestamp: 1700000001 }] })
    ]);
    const group = new GroupClient({ graphClient: client, groupId: "grp-bound" });

    const info = await group.getInfo();
    const link = await group.getInviteLink();
    const requests = await group.getJoinRequests();

    expect(info).toEqual({
      id: "grp-bound",
      subject: "Team",
      joinApprovalMode: "approval_required",
      creationTimestamp: 1700000000,
      totalParticipantCount: 2,
      participants: [{ waId: "15551110000" }]
    });
    expect(link).toEqual({ inviteLink: "https://chat.whatsapp.com/ABC123" });
    expect(requests.data?.[0]).toEqual({
      joinRequestId: "jr-1",
      waId: "15551110002",
      creationTimestamp: 1700000001
    });
    expect(snakeCaseKeys(info)).toEqual([]);
    expect(snakeCaseKeys(link)).toEqual([]);
    expect(snakeCaseKeys(requests)).toEqual([]);
  });

  test("GroupClient mutation methods emit exact wire paths and bodies with the bound groupId", async () => {
    const { client, handle } = clientWith([
      ok({ request_id: "req-update" }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true }),
      ok({ success: true })
    ]);
    const group = new GroupClient({ graphClient: client, groupId: "grp-bound" });

    await group.update({
      subject: "Renamed",
      description: "New desc",
      joinApprovalMode: "auto_approve",
      groupId: "grp-evil"
    } as unknown as Parameters<GroupClient["update"]>[0]);
    await group.removeParticipants({ waIds: ["15551110000", "15551110001"] });
    await group.approveJoinRequests({ joinRequestIds: ["jr-1", "jr-2"] });
    await group.rejectJoinRequests({ joinRequestIds: ["jr-9"] });
    await group.delete({ groupId: "grp-evil" } as unknown as Parameters<GroupClient["delete"]>[0]);

    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      subject: "Renamed",
      description: "New desc",
      join_approval_mode: "auto_approve"
    });

    expect(handle.requests[1]?.method).toBe("DELETE");
    expect(handle.requests[1]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound/participants");
    expect(parseBody(handle.requests[1]?.body)).toEqual({
      messaging_product: "whatsapp",
      action: "remove",
      participants: [{ wa_id: "15551110000" }, { wa_id: "15551110001" }]
    });

    expect(handle.requests[2]?.method).toBe("POST");
    expect(handle.requests[2]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound/join_requests");
    expect(parseBody(handle.requests[2]?.body)).toEqual({
      messaging_product: "whatsapp",
      action: "approve",
      join_requests: [{ join_request_id: "jr-1" }, { join_request_id: "jr-2" }]
    });

    expect(handle.requests[3]?.method).toBe("DELETE");
    expect(handle.requests[3]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound/join_requests");
    expect(parseBody(handle.requests[3]?.body)).toEqual({
      messaging_product: "whatsapp",
      action: "reject",
      join_requests: [{ join_request_id: "jr-9" }]
    });

    expect(handle.requests[4]?.method).toBe("DELETE");
    expect(handle.requests[4]?.url).toBe("https://graph.facebook.com/v25.0/grp-bound");
  });
});
