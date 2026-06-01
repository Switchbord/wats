// WATS-132 RED — credential-free WhatsApp Groups API Graph parity.
//
// Behavioral tests for the @wats/graph/endpoints/groups endpoint family:
// group create/get/update/delete, invite-link get/revoke, join-request
// list/manage, and participant removal. Public input is camelCase; Graph
// wire bodies use snake_case only at this transport boundary. Tests use
// only MockTransport and synthetic payloads; no live Meta credentials.

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  approveGroupJoinRequests,
  createGroup,
  deleteGroup,
  getGroup,
  getGroupInviteLink,
  listGroupJoinRequests,
  rejectGroupJoinRequests,
  removeGroupParticipants,
  revokeGroupInviteLink,
  updateGroup,
  type GroupDetails,
  type GroupInviteLinkResponse,
  type GroupJoinRequestsResponse,
  type GroupMutationResponse
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

describe("WATS-132 Groups endpoint family", () => {
  test("root and groups subpath exports keep identical callables", async () => {
    const root = await import("../src");
    const groups = await import("../src/endpoints/groups");
    expect(groups.createGroup).toBe(root.createGroup);
    expect(groups.getGroup).toBe(root.getGroup);
    expect(groups.updateGroup).toBe(root.updateGroup);
    expect(groups.deleteGroup).toBe(root.deleteGroup);
    expect(groups.getGroupInviteLink).toBe(root.getGroupInviteLink);
    expect(groups.revokeGroupInviteLink).toBe(root.revokeGroupInviteLink);
    expect(groups.listGroupJoinRequests).toBe(root.listGroupJoinRequests);
    expect(groups.approveGroupJoinRequests).toBe(root.approveGroupJoinRequests);
    expect(groups.rejectGroupJoinRequests).toBe(root.rejectGroupJoinRequests);
    expect(groups.removeGroupParticipants).toBe(root.removeGroupParticipants);
  });

  test("createGroup POSTs /{phoneNumberId}/groups with snake_case boundary body", async () => {
    const { client, handle } = clientWith(ok({ request_id: "req-1" }));
    const res: GroupMutationResponse = await createGroup(
      client,
      { phoneNumberId: "555" },
      { subject: "Team", description: "Our team", joinApprovalMode: "approval_required" }
    );
    expect(res.request_id).toBe("req-1");
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/555/groups");
    expect(handle.requests[0]?.headers.get("content-type")).toBe("application/json");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      subject: "Team",
      description: "Our team",
      join_approval_mode: "approval_required"
    });
  });

  test("createGroup omits optional description and join_approval_mode when absent", async () => {
    const { client, handle } = clientWith(ok({ request_id: "req-2" }));
    await createGroup(client, { phoneNumberId: "555" }, { subject: "Solo" });
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      subject: "Solo"
    });
  });

  test("getGroup GETs /{groupId} and forwards fields query", async () => {
    const { client, handle } = clientWith(
      ok({
        id: "grp-1",
        subject: "Team",
        join_approval_mode: "auto_approve",
        suspended: false,
        creation_timestamp: 1700000000,
        total_participant_count: 2,
        participants: [{ wa_id: "15551110000" }, { wa_id: "15551110001" }]
      })
    );
    const res: GroupDetails = await getGroup(client, {
      groupId: "grp-1",
      fields: "id,subject,participants"
    });
    expect(res.id).toBe("grp-1");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/grp-1?fields=id%2Csubject%2Cparticipants"
    );
  });

  test("updateGroup POSTs /{groupId} with mapped settings body", async () => {
    const { client, handle } = clientWith(ok());
    await updateGroup(client, { groupId: "grp-1" }, {
      subject: "Renamed",
      description: "New desc",
      joinApprovalMode: "auto_approve"
    });
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-1");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      subject: "Renamed",
      description: "New desc",
      join_approval_mode: "auto_approve"
    });
  });

  test("deleteGroup DELETEs /{groupId}", async () => {
    const { client, handle } = clientWith(ok());
    await deleteGroup(client, { groupId: "grp-1" });
    expect(handle.requests[0]?.method).toBe("DELETE");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-1");
  });

  test("getGroupInviteLink GETs /{groupId}/invite_link", async () => {
    const { client, handle } = clientWith(
      ok({ invite_link: "https://chat.whatsapp.com/ABC123" })
    );
    const res: GroupInviteLinkResponse = await getGroupInviteLink(client, { groupId: "grp-1" });
    expect(res.invite_link).toBe("https://chat.whatsapp.com/ABC123");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-1/invite_link");
  });

  test("revokeGroupInviteLink DELETEs /{groupId}/invite_link", async () => {
    const { client, handle } = clientWith(ok());
    await revokeGroupInviteLink(client, { groupId: "grp-1" });
    expect(handle.requests[0]?.method).toBe("DELETE");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-1/invite_link");
  });

  test("listGroupJoinRequests GETs /{groupId}/join_requests with paging query", async () => {
    const { client, handle } = clientWith(
      ok({
        data: [{ join_request_id: "jr-1", wa_id: "15551110002", creation_timestamp: 1700000001 }],
        paging: { cursors: { after: "CUR" } }
      })
    );
    const res: GroupJoinRequestsResponse = await listGroupJoinRequests(client, {
      groupId: "grp-1",
      limit: "25",
      after: "CUR"
    });
    expect(res.data?.[0]?.join_request_id).toBe("jr-1");
    expect(handle.requests[0]?.method).toBe("GET");
    expect(handle.requests[0]?.url).toBe(
      "https://graph.facebook.com/v25.0/grp-1/join_requests?limit=25&after=CUR"
    );
  });

  test("approveGroupJoinRequests POSTs /{groupId}/join_requests with approve action", async () => {
    const { client, handle } = clientWith(ok());
    await approveGroupJoinRequests(client, { groupId: "grp-1" }, {
      joinRequestIds: ["jr-1", "jr-2"]
    });
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-1/join_requests");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      action: "approve",
      join_requests: [{ join_request_id: "jr-1" }, { join_request_id: "jr-2" }]
    });
  });

  test("rejectGroupJoinRequests POSTs /{groupId}/join_requests with reject action", async () => {
    const { client, handle } = clientWith(ok());
    await rejectGroupJoinRequests(client, { groupId: "grp-1" }, {
      joinRequestIds: ["jr-9"]
    });
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      action: "reject",
      join_requests: [{ join_request_id: "jr-9" }]
    });
  });

  test("removeGroupParticipants POSTs /{groupId}/participants with remove action", async () => {
    const { client, handle } = clientWith(ok());
    await removeGroupParticipants(client, { groupId: "grp-1" }, {
      waIds: ["15551110000", "15551110001"]
    });
    expect(handle.requests[0]?.method).toBe("POST");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/grp-1/participants");
    expect(parseBody(handle.requests[0]?.body)).toEqual({
      messaging_product: "whatsapp",
      action: "remove",
      participants: [{ wa_id: "15551110000" }, { wa_id: "15551110001" }]
    });
  });

  describe("input validation", () => {
    test("createGroup rejects missing subject", async () => {
      const { client } = clientWith(ok());
      await expect(
        createGroup(client, { phoneNumberId: "555" }, {} as { subject: string })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("createGroup rejects subject over the 128-char limit", async () => {
      const { client } = clientWith(ok());
      await expect(
        createGroup(client, { phoneNumberId: "555" }, { subject: "x".repeat(129) })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("createGroup rejects an invalid joinApprovalMode", async () => {
      const { client } = clientWith(ok());
      await expect(
        createGroup(client, { phoneNumberId: "555" }, {
          subject: "ok",
          joinApprovalMode: "nope" as "auto_approve"
        })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("createGroup rejects a non-string phoneNumberId", async () => {
      const { client } = clientWith(ok());
      await expect(
        createGroup(client, { phoneNumberId: 555 as unknown as string }, { subject: "ok" })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("updateGroup rejects an empty body (no updatable fields)", async () => {
      const { client } = clientWith(ok());
      await expect(
        updateGroup(client, { groupId: "grp-1" }, {})
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("approveGroupJoinRequests rejects an empty joinRequestIds array", async () => {
      const { client } = clientWith(ok());
      await expect(
        approveGroupJoinRequests(client, { groupId: "grp-1" }, { joinRequestIds: [] })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("removeGroupParticipants rejects an empty waIds array", async () => {
      const { client } = clientWith(ok());
      await expect(
        removeGroupParticipants(client, { groupId: "grp-1" }, { waIds: [] })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("removeGroupParticipants rejects more than 8 participants", async () => {
      const { client } = clientWith(ok());
      const waIds = Array.from({ length: 9 }, (_, i) => `1555111000${i}`);
      await expect(
        removeGroupParticipants(client, { groupId: "grp-1" }, { waIds })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("getGroup rejects a non-string groupId", async () => {
      const { client } = clientWith(ok());
      await expect(
        getGroup(client, { groupId: 1 as unknown as string })
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });

    test("createGroup rejects unsafe prototype keys on the body", async () => {
      const { client } = clientWith(ok());
      const malicious = JSON.parse('{"subject":"ok","__proto__":{"polluted":true}}') as {
        subject: string;
      };
      await expect(
        createGroup(client, { phoneNumberId: "555" }, malicious)
      ).rejects.toBeInstanceOf(GraphRequestValidationError);
    });
  });
});
