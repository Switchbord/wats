// WATS-77 slice 2 — calling settings + SIP sub-object for phone-number settings.
//
// Behavioral tests for updatePhoneNumberSettings `calling` serialization.
// Tests use MockTransport only; no live Meta credentials or environment reads.

import { describe, expect, test } from "bun:test";
import {
  GraphClient,
  GraphRequestValidationError,
  updatePhoneNumberSettings,
  type UpdatePhoneNumberSettingsInput
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

const fullCalling: UpdatePhoneNumberSettingsInput = {
  phoneNumberId: "pn-1",
  calling: {
    status: "ENABLED",
    callIconVisibility: "DEFAULT",
    callIcons: { restrictToUserCountries: ["US", "BR"] },
    callHours: {
      status: "ENABLED",
      timezoneId: "America/Manaus",
      weeklyOperatingHours: [{ dayOfWeek: "MONDAY", openTime: "0400", closeTime: "1020" }],
      holidaySchedule: [{ date: "2026-01-01", startTime: "0000", endTime: "2359" }]
    },
    callbackPermissionStatus: "ENABLED",
    sip: {
      status: "ENABLED",
      servers: [{ hostname: "sip.example.com", port: 5061, requestUriUserParams: { KEY1: "VALUE1" } }]
    }
  }
};

describe("WATS-77 calling settings serialization", () => {
  test("full calling object (incl SIP) serializes to exact snake_case wire body", async () => {
    const { client, handle } = clientWith(ok());
    await updatePhoneNumberSettings(client, fullCalling);

    expect(handle.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST https://graph.facebook.com/v25.0/pn-1/settings"
    ]);
    expect(JSON.parse(String(handle.requests[0]?.body))).toEqual({
      calling: {
        status: "ENABLED",
        call_icon_visibility: "DEFAULT",
        call_icons: { restrict_to_user_countries: ["US", "BR"] },
        call_hours: {
          status: "ENABLED",
          timezone_id: "America/Manaus",
          weekly_operating_hours: [{ day_of_week: "MONDAY", open_time: "0400", close_time: "1020" }],
          holiday_schedule: [{ date: "2026-01-01", start_time: "0000", end_time: "2359" }]
        },
        callback_permission_status: "ENABLED",
        sip: {
          status: "ENABLED",
          servers: [{ hostname: "sip.example.com", port: 5061, request_uri_user_params: { KEY1: "VALUE1" } }]
        }
      }
    });
  });

  test("calling-only update (no storageConfiguration) succeeds", async () => {
    const { client, handle } = clientWith(ok());
    await updatePhoneNumberSettings(client, { phoneNumberId: "pn-1", calling: { status: "DISABLED" } });
    expect(JSON.parse(String(handle.requests[0]?.body))).toEqual({ calling: { status: "DISABLED" } });
  });

  test("storageConfiguration + calling both serialize when present", async () => {
    const { client, handle } = clientWith(ok());
    await updatePhoneNumberSettings(client, {
      phoneNumberId: "pn-1",
      storageConfiguration: { status: "ENABLED" },
      calling: { sip: { status: "DISABLED" } }
    });
    expect(JSON.parse(String(handle.requests[0]?.body))).toEqual({
      storage_configuration: { status: "ENABLED" },
      calling: { sip: { status: "DISABLED" } }
    });
  });

  test("sip_user_password and app_id are dropped from the update body even if passed", async () => {
    const { client, handle } = clientWith(ok());
    await updatePhoneNumberSettings(client, {
      phoneNumberId: "pn-1",
      calling: {
        sip: {
          servers: [
            {
              hostname: "sip.example.com",
              port: 5061,
              requestUriUserParams: { KEY1: "VALUE1" },
              // round-tripped response-only fields
              sip_user_password: "s3cr3t",
              sipUserPassword: "s3cr3t",
              app_id: 12345,
              appId: 12345
            } as never
          ]
        }
      }
    });
    const body = JSON.parse(String(handle.requests[0]?.body));
    const server = body.calling.sip.servers[0];
    expect(server).toEqual({ hostname: "sip.example.com", port: 5061, request_uri_user_params: { KEY1: "VALUE1" } });
    expect(server.sip_user_password).toBeUndefined();
    expect(server.sipUserPassword).toBeUndefined();
    expect(server.app_id).toBeUndefined();
    expect(server.appId).toBeUndefined();
    // The serialized wire body must not contain the credential string anywhere.
    expect(String(handle.requests[0]?.body)).not.toContain("s3cr3t");
  });

  test("enum values are normalized to uppercase", async () => {
    const { client, handle } = clientWith(ok());
    await updatePhoneNumberSettings(client, {
      phoneNumberId: "pn-1",
      calling: { status: "enabled" as never, callIconVisibility: "disable_all" as never }
    });
    expect(JSON.parse(String(handle.requests[0]?.body))).toEqual({
      calling: { status: "ENABLED", call_icon_visibility: "DISABLE_ALL" }
    });
  });
});

describe("WATS-77 calling settings rejection matrix", () => {
  function rejects(input: UpdatePhoneNumberSettingsInput) {
    const { client } = clientWith(ok());
    return expect(updatePhoneNumberSettings(client, input)).rejects.toBeInstanceOf(GraphRequestValidationError);
  }

  test("neither storageConfiguration nor calling provided", async () => {
    await rejects({ phoneNumberId: "pn-1" });
  });

  test("unknown calling.status enum", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: { status: "PAUSED" as never } });
  });

  test("unknown callIconVisibility enum", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: { callIconVisibility: "HIDE" as never } });
  });

  test("unknown dayOfWeek enum", async () => {
    await rejects({
      phoneNumberId: "pn-1",
      calling: { callHours: { weeklyOperatingHours: [{ dayOfWeek: "FUNDAY", openTime: "0400", closeTime: "1020" }] } }
    });
  });

  test("malformed HHMM open time", async () => {
    await rejects({
      phoneNumberId: "pn-1",
      calling: { callHours: { weeklyOperatingHours: [{ dayOfWeek: "MONDAY", openTime: "4:00", closeTime: "1020" }] } }
    });
  });

  test("malformed holiday date", async () => {
    await rejects({
      phoneNumberId: "pn-1",
      calling: { callHours: { holidaySchedule: [{ date: "01/01/2026", startTime: "0000", endTime: "2359" }] } }
    });
  });

  test("weeklyOperatingHours exceeds 2 entries per day", async () => {
    await rejects({
      phoneNumberId: "pn-1",
      calling: {
        callHours: {
          weeklyOperatingHours: [
            { dayOfWeek: "MONDAY", openTime: "0400", closeTime: "0500" },
            { dayOfWeek: "MONDAY", openTime: "0600", closeTime: "0700" },
            { dayOfWeek: "MONDAY", openTime: "0800", closeTime: "0900" }
          ]
        }
      }
    });
  });

  test("sip.servers exceeds max 3", async () => {
    await rejects({
      phoneNumberId: "pn-1",
      calling: {
        sip: {
          servers: [
            { hostname: "a.example.com" },
            { hostname: "b.example.com" },
            { hostname: "c.example.com" },
            { hostname: "d.example.com" }
          ]
        }
      }
    });
  });

  test("non-string hostname", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: { sip: { servers: [{ hostname: 123 as never }] } } });
  });

  test("control-char hostname", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: { sip: { servers: [{ hostname: "sip\u0000.example.com" }] } } });
  });

  test("non-integer port", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: { sip: { servers: [{ hostname: "sip.example.com", port: 5061.5 }] } } });
  });

  test("negative port", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: { sip: { servers: [{ hostname: "sip.example.com", port: -1 }] } } });
  });

  test("malformed sip server (not an object)", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: { sip: { servers: ["nope" as never] } } });
  });

  test("__proto__ key in requestUriUserParams is rejected", async () => {
    const params = JSON.parse('{"__proto__": {"polluted": true}, "KEY1": "VALUE1"}');
    await rejects({
      phoneNumberId: "pn-1",
      calling: { sip: { servers: [{ hostname: "sip.example.com", requestUriUserParams: params }] } }
    });
  });

  test("non-string requestUriUserParams value", async () => {
    await rejects({
      phoneNumberId: "pn-1",
      calling: { sip: { servers: [{ hostname: "sip.example.com", requestUriUserParams: { KEY1: 5 as never } }] } }
    });
  });

  test("calling is not a plain object", async () => {
    await rejects({ phoneNumberId: "pn-1", calling: "ENABLED" as never });
  });
});
