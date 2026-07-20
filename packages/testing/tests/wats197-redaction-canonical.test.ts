// WATS-197 — canonical redaction marker and tightened Bearer regexp.
//
// (a) redactConfig (@wats/config) used "[REDACTED_ENV]" while the service
//     envRef used "[REDACTED]". Canonical marker is "[REDACTED]" — both
//     surfaces must agree so logs/diagnostics show one redaction sentinel.
// (b) scrubErrorCause (@wats/graph) used /Beare...+/g, which greedily ate
//     trailing content and matched non-token words ("BearerToken", "Bearen").
//     Tightened to /Bearer\s+\S+/g: redacts "Bearer <token>", leaves
//     "BearerToken" and "Bearen" intact.

import { describe, expect, test } from "bun:test";
import { redactConfig, validateConfig } from "../../config/src/index";
import { scrubErrorCause } from "@wats/graph";

function validConfig(): unknown {
  return {
    version: 1,
    defaultProfile: "local",
    profiles: {
      local: {
        graph: { apiVersion: "v19.0", baseUrl: "https://graph.facebook.com" },
        whatsapp: { wabaId: "1234567890", phoneNumberId: "0987654321" },
        auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
        webhook: {
          path: "/webhook",
          verifyToken: { env: "WATS_VERIFY_TOKEN" },
          appSecret: { env: "WATS_APP_SECRET" },
          maxBodyBytes: 1048576
        },
        service: {
          host: "127.0.0.1",
          port: 3000,
          apiPrefix: "/api",
          bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
        }
      }
    }
  };
}

describe("WATS-197(a) canonical redaction marker is [REDACTED]", () => {
  test("redactConfig replaces env-name secret refs with [REDACTED]", () => {
    const redacted = redactConfig(validConfig());
    expect(redacted.profiles.local.auth.accessToken.env).toBe("[REDACTED]");
    expect(redacted.profiles.local.webhook.verifyToken.env).toBe("[REDACTED]");
    expect(redacted.profiles.local.webhook.appSecret.env).toBe("[REDACTED]");
    expect(redacted.profiles.local.service.bearerToken.env).toBe("[REDACTED]");
  });

  test("redactConfig never leaves the old [REDACTED_ENV] marker", () => {
    const redacted = redactConfig(validConfig());
    expect(JSON.stringify(redacted)).not.toContain("[REDACTED_ENV]");
    // Non-secret fields stay visible.
    expect(redacted.profiles.local.graph.apiVersion).toBe("v19.0");
  });

  test("redactConfig does not mutate the validated input", () => {
    const validated = validateConfig(validConfig());
    redactConfig(validated);
    expect(validated.profiles.local.auth.accessToken.env).toBe("WATS_ACCESS_TOKEN");
  });
});

describe("WATS-197(b) scrubErrorCause tightens Bearer token redaction", () => {
  test("redacts a real Bearer token, preserving surrounding text", () => {
    expect(scrubErrorCause("header: Bearer abc123 end")).toBe("header: Bearer *** end");
    expect(scrubErrorCause("Authorization: Bearer SECRET_TOKEN_9 ok")).toBe("Authorization: Bearer *** ok");
  });

  test("redacts a Bearer token inside an Error message and preserves prototype", () => {
    const scrubbed = scrubErrorCause(new Error("call failed: Bearer abc123 returned 401")) as Error;
    expect(scrubbed).toBeInstanceOf(Error);
    expect(scrubbed.message).toBe("call failed: Bearer *** returned 401");
    expect(scrubbed.message).not.toContain("abc123");
  });

  test("leaves 'BearerToken' intact (no whitespace, not a token)", () => {
    const input = "BearerToken is a class name";
    expect(scrubErrorCause(input)).toBe(input);
  });

  test("leaves 'Bearen' intact (not the word Bearer)", () => {
    const input = "Bearen ought to be a word";
    expect(scrubErrorCause(input)).toBe(input);
  });

  test("bare 'Bearer' with no token is left intact", () => {
    expect(scrubErrorCause("Bearer")).toBe("Bearer");
    expect(scrubErrorCause("Bearer ")).toBe("Bearer ");
  });

  test("returns non-string/non-Error inputs unchanged", () => {
    expect(scrubErrorCause(null)).toBe(null);
    expect(scrubErrorCause(undefined)).toBe(undefined);
    expect(scrubErrorCause(42)).toBe(42);
  });
});
