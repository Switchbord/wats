import { describe, expect, test } from "bun:test";
import { GraphClient } from "@wats/graph";
import { createMockTransport } from "../../graph/src/createMockTransport";
import { GraphRequestValidationError } from "../../graph/src/errors";
import { and, group } from "../src/filtersTyped/index";
import { WhatsApp, WhatsAppListenOptionsError } from "../src/whatsappFacade";
import type {
  TypedGroupLifecycleUpdate,
  TypedGroupParticipantsUpdate,
  TypedGroupSettingsUpdate,
  TypedGroupStatusUpdate,
  TypedMessageUpdate,
  TypedStatusUpdate,
  TypedUpdate
} from "../src/webhookNormalizer";

function makeGraphClientWithHandle() {
  const handle = createMockTransport({
    defaultResponse: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { messages: [{ id: "wamid.GROUP" }], request_id: "req-group" }
    }
  });
  return {
    graphClient: new GraphClient({
      accessToken: "token-GROUPS",
      apiVersion: "v25.0",
      transport: handle.transport
    }),
    handle
  };
}

function groupMessage(groupId = "group-1"): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: `wamid.${groupId}`,
    phoneNumberId: "1234567890",
    wabaId: "WABA-GROUPS",
    receivedAt: 1,
    message: {
      from: "15551234567",
      id: `wamid.${groupId}`,
      timestamp: "1",
      type: "text",
      groupId,
      text: { body: "hello group" }
    } as TypedMessageUpdate["message"],
    rawChange: { field: "messages", value: {} } as TypedMessageUpdate["rawChange"]
  };
}

function directMessage(): TypedMessageUpdate {
  const msg = groupMessage("group-1");
  return {
    ...msg,
    updateId: "wamid.DIRECT",
    message: { ...msg.message, groupId: undefined } as TypedMessageUpdate["message"]
  };
}

function statusUpdate(groupId: string | undefined): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: "wamid.STATUS",
    phoneNumberId: "1234567890",
    wabaId: "WABA-GROUPS",
    receivedAt: 1,
    status: {
      id: "wamid.STATUS",
      status: "read",
      timestamp: "1",
      recipientId: groupId ?? "15551230000",
      ...(groupId !== undefined ? { recipientType: "group", recipientParticipantId: "15551234567" } : {})
    } as TypedStatusUpdate["status"],
    rawChange: { field: "messages", value: {} } as TypedStatusUpdate["rawChange"]
  };
}

function lifecycle(groupId = "group-1"): TypedGroupLifecycleUpdate {
  return {
    kind: "groupLifecycle",
    updateId: `groupLifecycle:${groupId}`,
    phoneNumberId: "1234567890",
    wabaId: "WABA-GROUPS",
    receivedAt: 1,
    group: { messagingProduct: "whatsapp", type: "group_create", metadata: { displayPhoneNumber: "1", phoneNumberId: "1234567890" }, groupId, requestId: "req-1", raw: {} } as TypedGroupLifecycleUpdate["group"],
    rawChange: { field: "group_lifecycle_update", value: {} } as TypedGroupLifecycleUpdate["rawChange"]
  };
}

function participants(groupId = "group-1"): TypedGroupParticipantsUpdate {
  return {
    kind: "groupParticipants",
    updateId: `groupParticipants:${groupId}`,
    phoneNumberId: "1234567890",
    wabaId: "WABA-GROUPS",
    receivedAt: 1,
    group: { messagingProduct: "whatsapp", type: "group_participants_remove", metadata: { displayPhoneNumber: "1", phoneNumberId: "1234567890" }, groupId, raw: {} } as TypedGroupParticipantsUpdate["group"],
    rawChange: { field: "group_participants_update", value: {} } as TypedGroupParticipantsUpdate["rawChange"]
  };
}

function settings(groupId = "group-1"): TypedGroupSettingsUpdate {
  return {
    kind: "groupSettings",
    updateId: `groupSettings:${groupId}`,
    phoneNumberId: "1234567890",
    wabaId: "WABA-GROUPS",
    receivedAt: 1,
    group: { messagingProduct: "whatsapp", type: "group_subject", metadata: { displayPhoneNumber: "1", phoneNumberId: "1234567890" }, groupId, raw: {} } as TypedGroupSettingsUpdate["group"],
    rawChange: { field: "group_settings_update", value: {} } as TypedGroupSettingsUpdate["rawChange"]
  };
}

function groupStatus(groupId = "group-1"): TypedGroupStatusUpdate {
  return {
    kind: "groupStatus",
    updateId: `groupStatus:${groupId}`,
    phoneNumberId: "1234567890",
    wabaId: "WABA-GROUPS",
    receivedAt: 1,
    group: { messagingProduct: "whatsapp", type: "group_suspend", metadata: { displayPhoneNumber: "1", phoneNumberId: "1234567890" }, groupId, raw: {} } as TypedGroupStatusUpdate["group"],
    rawChange: { field: "group_status_update", value: {} } as TypedGroupStatusUpdate["rawChange"]
  };
}

describe("WATS-136 typed group filters", () => {
  test("group namespace matches group updates and rejects sibling non-group updates", () => {
    const positives: Array<[string, TypedUpdate]> = [
      ["message", groupMessage()],
      ["participants", participants()],
      ["lifecycle", lifecycle()],
      ["settings", settings()],
      ["status", groupStatus()],
      ["message status", statusUpdate("group-1")]
    ];
    const negatives: TypedUpdate[] = [directMessage(), statusUpdate(undefined)];

    for (const [label, update] of positives) {
      expect(group.predicate(update), label).toBe(true);
    }
    for (const update of negatives) {
      expect(group.predicate(update)).toBe(false);
    }
  });

  test("specific group filters match only their normalized group dimension", () => {
    expect(group.message().predicate(groupMessage())).toBe(true);
    expect(group.message().predicate(directMessage())).toBe(false);
    expect(group.message().predicate(participants())).toBe(false);

    expect(group.participantsUpdate().predicate(participants())).toBe(true);
    expect(group.participantsUpdate().predicate(lifecycle())).toBe(false);

    expect(group.lifecycleUpdate().predicate(lifecycle())).toBe(true);
    expect(group.settingsUpdate().predicate(settings())).toBe(true);
    expect(group.statusUpdate().predicate(groupStatus())).toBe(true);
    expect(group.statusUpdate().predicate(statusUpdate("group-1"))).toBe(true);
    expect(group.statusUpdate().predicate(statusUpdate(undefined))).toBe(false);
  });

  test("fromGroup composes with kind filters via and()", () => {
    const f = and(group.message(), group.fromGroup("group-1"));
    expect(f.predicate(groupMessage("group-1"))).toBe(true);
    expect(f.predicate(groupMessage("group-2"))).toBe(false);
    expect(f.predicate(directMessage())).toBe(false);
  });
});

describe("WATS-136 WhatsApp facade group helpers and listeners", () => {
  test("facade createGroup/sendGroupMessage/group helper delegate to bound phone-number clients", async () => {
    const { graphClient, handle } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });

    await wa.createGroup({ subject: "Operators" });
    await wa.sendGroupMessage({ groupId: "group-1", text: "hello group" });
    const gc = wa.group("group-1");

    expect(gc.groupId).toBe("group-1");
    expect(handle.requests[0]?.url).toBe("https://graph.facebook.com/v25.0/1234567890/groups");
    expect(JSON.parse(String(handle.requests[0]?.body))).toEqual({
      messaging_product: "whatsapp",
      subject: "Operators"
    });
    expect(handle.requests[1]?.url).toBe("https://graph.facebook.com/v25.0/1234567890/messages");
    expect(JSON.parse(String(handle.requests[1]?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "group-1",
      type: "text",
      text: { body: "hello group" }
    });
  });

  test("facade group helpers reject when no phoneNumberId is bound", async () => {
    const { graphClient, handle } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient });

    await expect(wa.createGroup({ subject: "Operators" })).rejects.toBeInstanceOf(GraphRequestValidationError);
    await expect(wa.sendGroupMessage({ groupId: "group-1", text: "hi" })).rejects.toBeInstanceOf(GraphRequestValidationError);
    expect(() => wa.group("group-1")).toThrow(GraphRequestValidationError);
    expect(handle.requests.length).toBe(0);
  });

  test("on(filters.group.*()) routes through TypedRouter and listen supports groupId", async () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient });
    const seen: string[] = [];

    wa.on(group.message(), (ctx) => {
      seen.push(ctx.update.message.groupId ?? "missing");
    });
    const h = wa.listen({ type: "message", groupId: "group-1" });

    await wa.dispatch(directMessage());
    await wa.dispatch(groupMessage("group-2"));
    await wa.dispatch(groupMessage("group-1"));

    const update = await h.promise;
    expect(update.message.groupId).toBe("group-1");
    expect(seen).toEqual(["group-2", "group-1"]);
  });

  test("listen validates groupId when provided", () => {
    const { graphClient } = makeGraphClientWithHandle();
    const wa = new WhatsApp({ graphClient });
    expect(() => wa.listen({ type: "message", groupId: "" })).toThrow(WhatsAppListenOptionsError);
    expect(() => wa.listen({ type: "status", groupId: 42 as unknown as string })).toThrow(WhatsAppListenOptionsError);
  });
});

test("sendGroupMessage validates malformed input with GraphRequestValidationError", async () => {
  const { graphClient, handle } = makeGraphClientWithHandle();
  const wa = new WhatsApp({ graphClient, phoneNumberId: "1234567890" });

  for (const input of [
    undefined,
    null,
    { groupId: "", text: "hello" },
    { groupId: "   ", text: "hello" },
    { groupId: "group-1", text: "" },
    { groupId: "group-1", text: "hi", previewUrl: "yes" }
  ]) {
    let thrown: unknown;
    try {
      await wa.sendGroupMessage(input as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GraphRequestValidationError);
    expect(thrown).not.toBeInstanceOf(TypeError);
  }
  expect(handle.requests.length).toBe(0);
});
