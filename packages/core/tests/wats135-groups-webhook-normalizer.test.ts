import { describe, expect, test } from "bun:test";
import {
  normalizeWebhookEnvelope,
  type TypedGroupLifecycleUpdate,
  type TypedGroupParticipantsUpdate,
  type TypedGroupSettingsUpdate,
  type TypedGroupStatusUpdate,
  type TypedMessageUpdate,
  type TypedStatusUpdate
} from "../src/webhookNormalizer";

function makeEnvelope(changes: readonly unknown[]): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA-GROUPS", time: 1780000000, changes }]
  };
}

function groupChange(field: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    field,
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "15550001111",
        phone_number_id: "1234567890"
      },
      ...value
    }
  };
}

function groupArrayChange(field: string, groups: readonly Record<string, unknown>[]): Record<string, unknown> {
  return groupChange(field, { groups: [...groups] });
}

function messagesChange(value: Record<string, unknown>): Record<string, unknown> {
  return groupChange("messages", value);
}

describe("WATS-135 group webhook normalization", () => {
  test("normalizes real groups[] payloads for every group field", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      groupArrayChange("group_lifecycle_update", [{
        type: "group_create",
        request_id: "req-create-1",
        group_id: "group-1",
        subject: "Launch group",
        invite_link: "https://chat.whatsapp.com/invite-1",
        join_approval_mode: "approval_required"
      }]),
      groupArrayChange("group_participants_update", [{
        type: "group_participants_add",
        group_id: "group-1",
        reason: "invite_link",
        added_participants: [{ wa_id: "15551230001" }]
      }]),
      groupArrayChange("group_settings_update", [{
        type: "group_description",
        group_id: "group-1",
        group_description: { text: "Launch group docs", update_successful: true }
      }]),
      groupArrayChange("group_status_update", [{
        type: "group_suspend_cleared",
        group_id: "group-1"
      }])
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.map((u) => u.kind)).toEqual([
      "groupLifecycle",
      "groupParticipants",
      "groupSettings",
      "groupStatus"
    ]);
    expect((result.updates[0] as TypedGroupLifecycleUpdate).group.groupId).toBe("group-1");
    expect((result.updates[1] as TypedGroupParticipantsUpdate).group.addedParticipants).toEqual([
      { waId: "15551230001" }
    ]);
    expect((result.updates[2] as TypedGroupSettingsUpdate).group.groupDescription).toEqual({
      text: "Launch group docs",
      updateSuccessful: true
    });
    expect((result.updates[3] as TypedGroupStatusUpdate).group.type).toBe("group_suspend_cleared");
  });

  test("skips unsafe lifecycle group ids inside groups[] payloads", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      groupArrayChange("group_lifecycle_update", [{
        type: "group_delete",
        request_id: "req-delete-bad",
        group_id: "bad\r\ngroup"
      }])
    ]));

    expect(result.updates).toEqual([]);
    expect(result.skipped).toEqual([
      {
        reason: "malformed_field",
        path: "entry[0].changes[0].value.groups[0].group_id",
        detail: "missing-or-unsafe-group-id"
      }
    ]);
  });

  test("skips unsafe flattened lifecycle group ids", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      groupChange("group_lifecycle_update", {
        type: "group_delete",
        request_id: "req-delete-flat-bad",
        group_id: "bad\r\ngroup"
      })
    ]));

    expect(result.updates).toEqual([]);
    expect(result.skipped).toEqual([
      {
        reason: "malformed_field",
        path: "entry[0].changes[0].value.group_id",
        detail: "missing-or-unsafe-group-id"
      }
    ]);
  });

  test("skips malformed groups[] entries without throwing", () => {
    const accessorGroup = {} as Record<string, unknown>;
    Object.defineProperty(accessorGroup, "type", {
      get() {
        throw new Error("group getter must not run");
      }
    });

    const result = normalizeWebhookEnvelope(makeEnvelope([
      groupChange("group_participants_update", {
        groups: [null, accessorGroup, { type: "group_participants_add", group_id: "group-safe" }]
      })
    ]));

    expect(result.updates.length).toBe(1);
    expect(result.skipped).toEqual([
      {
        reason: "malformed_field",
        path: "entry[0].changes[0].value.groups[0]",
        detail: "group-not-an-object"
      },
      {
        reason: "malformed_field",
        path: "entry[0].changes[0].value.groups[1].group_id",
        detail: "missing-or-unsafe-group-id"
      }
    ]);
    expect((result.updates[0] as TypedGroupParticipantsUpdate).group.groupId).toBe("group-safe");
  });

  test("normalizes lifecycle, participant, settings, and status group fields to camelCase typed updates", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      groupChange("group_lifecycle_update", {
        type: "group_create",
        request_id: "req-create-1",
        group_id: "group-1",
        subject: "Launch group",
        invite_link: "https://chat.whatsapp.com/invite-1",
        join_approval_mode: "approval_required"
      }),
      groupChange("group_participants_update", {
        type: "group_participants_add",
        group_id: "group-1",
        reason: "invite_link",
        added_participants: [{ wa_id: "15551230001" }, { wa_id: "15551230002" }]
      }),
      groupChange("group_settings_update", {
        type: "group_subject",
        group_id: "group-1",
        group_subject: { text: "Launch group v2", update_successful: true }
      }),
      groupChange("group_status_update", {
        type: "group_suspend",
        group_id: "group-1"
      })
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.map((u) => u.kind)).toEqual([
      "groupLifecycle",
      "groupParticipants",
      "groupSettings",
      "groupStatus"
    ]);

    const lifecycle = result.updates[0] as TypedGroupLifecycleUpdate;
    expect(lifecycle.updateId).toBe("groupLifecycle:WABA-GROUPS:group_create:group-1:req-create-1");
    expect(lifecycle.phoneNumberId).toBe("1234567890");
    expect(lifecycle.group.groupId).toBe("group-1");
    expect(lifecycle.group.inviteLink).toBe("https://chat.whatsapp.com/invite-1");
    expect(lifecycle.group.joinApprovalMode).toBe("approval_required");
    expect("group_id" in (lifecycle.group as unknown as Record<string, unknown>)).toBe(false);
    expect("invite_link" in (lifecycle.group as unknown as Record<string, unknown>)).toBe(false);

    const participants = result.updates[1] as TypedGroupParticipantsUpdate;
    expect(participants.group.type).toBe("group_participants_add");
    expect(participants.group.reason).toBe("invite_link");
    expect(participants.group.addedParticipants).toEqual([
      { waId: "15551230001" },
      { waId: "15551230002" }
    ]);
    expect("added_participants" in (participants.group as unknown as Record<string, unknown>)).toBe(false);

    const settings = result.updates[2] as TypedGroupSettingsUpdate;
    expect(settings.group.groupSubject).toEqual({ text: "Launch group v2", updateSuccessful: true });
    expect("group_subject" in (settings.group as unknown as Record<string, unknown>)).toBe(false);

    const status = result.updates[3] as TypedGroupStatusUpdate;
    expect(status.group.groupId).toBe("group-1");
    expect(status.group.type).toBe("group_suspend");
  });

  test("normalizes join-request revoked, participant removal failures, settings errors, and lifecycle errors", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      groupChange("group_lifecycle_update", {
        type: "group_create",
        request_id: "req-create-failed",
        errors: [{ code: 131000, title: "Create failed" }]
      }),
      groupChange("group_lifecycle_update", {
        type: "group_delete",
        request_id: "req-delete-1",
        group_id: "group-2"
      }),
      groupChange("group_participants_update", {
        type: "group_join_request_revoked",
        group_id: "group-2",
        join_request_id: "join-1",
        wa_id: "15551239999",
        reason: "request_expired"
      }),
      groupChange("group_participants_update", {
        type: "group_participants_remove",
        group_id: "group-2",
        initiated_by: "15551239999",
        removed_participants: [{ input: "15551230001", wa_id: "15551230001" }],
        failed_participants: [
          {
            input: "15551230002",
            wa_id: "15551230002",
            errors: [{ code: 131051, title: "not in group" }]
          }
        ]
      }),
      groupChange("group_settings_update", {
        type: "profile_picture",
        group_id: "group-2",
        profile_picture: {
          mime_type: "image/jpeg",
          sha256: "sha-photo",
          update_successful: false,
          errors: [{ code: 131052, title: "photo invalid" }]
        }
      })
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(5);

    const lifecycle = result.updates[0] as TypedGroupLifecycleUpdate;
    expect(lifecycle.group.errors?.[0]).toEqual({ code: 131000, title: "Create failed" });
    expect(lifecycle.group.groupId).toBeUndefined();

    const deleted = result.updates[1] as TypedGroupLifecycleUpdate;
    expect(deleted.group.type).toBe("group_delete");
    expect(deleted.group.groupId).toBe("group-2");

    const revoked = result.updates[2] as TypedGroupParticipantsUpdate;
    expect(revoked.group.joinRequestId).toBe("join-1");
    expect(revoked.group.waId).toBe("15551239999");
    expect(revoked.group.reason).toBe("request_expired");

    const remove = result.updates[3] as TypedGroupParticipantsUpdate;
    expect(remove.group.initiatedBy).toBe("15551239999");
    expect(remove.group.removedParticipants).toEqual([{ input: "15551230001", waId: "15551230001" }]);
    expect(remove.group.failedParticipants?.[0]?.input).toBe("15551230002");
    expect(remove.group.failedParticipants?.[0]?.waId).toBe("15551230002");
    expect(remove.group.failedParticipants?.[0]?.errors?.[0]).toEqual({ code: 131051, title: "not in group" });

    const settings = result.updates[4] as TypedGroupSettingsUpdate;
    expect(settings.group.profilePicture).toEqual({
      mimeType: "image/jpeg",
      sha256: "sha-photo",
      updateSuccessful: false,
      errors: [{ code: 131052, title: "photo invalid" }]
    });
  });

  test("adds groupId to inbound group messages and aggregates group status recipient participant ids", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      messagesChange({
        messages: [{
          from: "15551230001",
          id: "wamid.GROUPMSG",
          timestamp: "1780000010",
          type: "text",
          group_id: "group-3",
          text: { body: "hello group" }
        }],
        statuses: [{
          id: "wamid.GROUPSTATUS",
          recipient_id: "group-3",
          recipient_type: "group",
          recipient_participant_id: "15551230001",
          status: "delivered",
          timestamp: "1780000011",
          pricing: { category: "group_service", pricing_model: "CBP" }
        }]
      })
    ]));

    expect(result.skipped).toEqual([]);
    expect(result.updates.length).toBe(2);

    const message = result.updates[0] as TypedMessageUpdate;
    expect(message.kind).toBe("message");
    expect(message.message.groupId).toBe("group-3");
    expect("group_id" in (message.message as unknown as Record<string, unknown>)).toBe(false);

    const status = result.updates[1] as TypedStatusUpdate;
    expect(status.kind).toBe("status");
    expect(status.status.recipientId).toBe("group-3");
    expect(status.status.recipientType).toBe("group");
    expect(status.status.recipientParticipantId).toBe("15551230001");
    expect(status.status.pricing?.category).toBe("group_service");
    expect("recipient_type" in (status.status as unknown as Record<string, unknown>)).toBe(false);
    expect("recipient_participant_id" in (status.status as unknown as Record<string, unknown>)).toBe(false);
  });

  test("preserves unsupported group fields as unknown and skips malformed group fields without throwing", () => {
    const result = normalizeWebhookEnvelope(makeEnvelope([
      groupChange("group_future_update", { type: "future", group_id: "group-future" }),
      groupChange("group_participants_update", {
        type: "group_participants_add",
        group_id: "bad\r\ngroup",
        added_participants: [{ wa_id: "15551230001" }]
      }),
      groupChange("group_status_update", { type: "group_suspend" })
    ]));

    expect(result.updates.length).toBe(1);
    expect(result.updates[0]?.kind).toBe("unknown");
    expect(result.skipped).toEqual([
      {
        reason: "malformed_field",
        path: "entry[0].changes[1].value.group_id",
        detail: "missing-or-unsafe-group-id"
      },
      {
        reason: "malformed_field",
        path: "entry[0].changes[2].value.group_id",
        detail: "missing-or-unsafe-group-id"
      }
    ]);
  });
});
