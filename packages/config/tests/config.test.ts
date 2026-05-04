import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigValidationError,
  loadConfig,
  parseConfig,
  redactConfig,
  validateConfig
} from "@wats/config";

const VALID_CONFIG = Object.freeze({
  version: 1,
  defaultProfile: "local",
  profiles: {
    local: {
      graph: {
        apiVersion: "v19.0",
        baseUrl: "https://graph.facebook.com"
      },
      whatsapp: {
        wabaId: "1234567890",
        phoneNumberId: "0987654321"
      },
      auth: {
        accessToken: { env: "WATS_ACCESS_TOKEN" }
      },
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
});

type MutableConfig = typeof VALID_CONFIG & Record<string, unknown>;

function validConfig(): MutableConfig {
  return structuredClone(VALID_CONFIG) as MutableConfig;
}

function expectConfigValidationError(fn: () => unknown, code: string, path: string): void {
  expect(fn).toThrow(ConfigValidationError);
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as ConfigValidationError).code).toBe(code);
    expect((error as ConfigValidationError).path).toBe(path);
    expect((error as ConfigValidationError).issues.length).toBeGreaterThanOrEqual(1);
    return;
  }
  throw new Error("expected ConfigValidationError");
}

describe("@wats/config validateConfig", () => {
  test("accepts the minimal v1 config object and freezes the returned shape", () => {
    const parsed = validateConfig(validConfig());

    expect(parsed.version).toBe(1);
    expect(parsed.defaultProfile).toBe("local");
    expect(parsed.profiles.local.graph.apiVersion).toBe("v19.0");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.profiles.local.auth.accessToken)).toBe(true);
  });

  test("rejects null, undefined, primitives, and arrays as typed validation errors without host TypeError", () => {
    const invalidInputs = [null, undefined, "", "   ", 1, true, [], () => undefined];

    for (const input of invalidInputs) {
      expect(() => validateConfig(input)).toThrow(ConfigValidationError);
      expect(() => validateConfig(input)).not.toThrow(TypeError);
      try {
        validateConfig(input);
      } catch (error) {
        expect((error as ConfigValidationError).code).toBe("invalid_config");
        expect((error as ConfigValidationError).path).toBe("$");
      }
    }
  });

  test("rejects unsupported config version", () => {
    const config = validConfig();
    config.version = 2;

    expectConfigValidationError(
      () => validateConfig(config),
      "invalid_version",
      "$.version"
    );
  });

  test("rejects missing default profile and a defaultProfile not present in profiles", () => {
    const missingDefault = validConfig();
    delete missingDefault.defaultProfile;
    expectConfigValidationError(
      () => validateConfig(missingDefault),
      "missing_default_profile",
      "$.defaultProfile"
    );

    const missingProfile = validConfig();
    missingProfile.defaultProfile = "prod";
    expectConfigValidationError(
      () => validateConfig(missingProfile),
      "missing_default_profile",
      "$.profiles.prod"
    );
  });

  test("rejects missing env secret refs and raw secret strings", () => {
    const missingEnv = validConfig();
    delete missingEnv.profiles.local.auth.accessToken.env;
    expectConfigValidationError(
      () => validateConfig(missingEnv),
      "invalid_env_ref",
      "$.profiles.local.auth.accessToken.env"
    );

    const rawSecret = validConfig();
    rawSecret.profiles.local.auth.accessToken = "do-not-accept-raw-token";
    expectConfigValidationError(
      () => validateConfig(rawSecret),
      "invalid_env_ref",
      "$.profiles.local.auth.accessToken"
    );
  });

  test("rejects empty and whitespace-only env names for all secret references", () => {
    const envRefPaths = [
      "auth.accessToken",
      "webhook.verifyToken",
      "webhook.appSecret",
      "service.bearerToken"
    ] as const;

    for (const refPath of envRefPaths) {
      for (const env of ["", "   "]) {
        const config = validConfig();
        const [section, field] = refPath.split(".") as ["auth" | "webhook" | "service", string];
        (config.profiles.local[section] as Record<string, unknown>)[field] = { env };

        expectConfigValidationError(
          () => validateConfig(config),
          "invalid_env_ref",
          `$.profiles.local.${refPath}.env`
        );
      }
    }
  });

  test("rejects malformed graph apiVersion and unsafe baseUrl schemes", () => {
    const badVersion = validConfig();
    badVersion.profiles.local.graph.apiVersion = "19.0";
    expectConfigValidationError(
      () => validateConfig(badVersion),
      "invalid_api_version",
      "$.profiles.local.graph.apiVersion"
    );

    const badUrl = validConfig();
    badUrl.profiles.local.graph.baseUrl = "ftp://graph.facebook.com";
    expectConfigValidationError(
      () => validateConfig(badUrl),
      "invalid_base_url",
      "$.profiles.local.graph.baseUrl"
    );
  });

  test("rejects invalid webhook paths", () => {
    const invalidPaths = ["webhook", "", "   ", "/", "/../secret", "/%2e%2e/secret", "/hooks\nmeta"];

    for (const path of invalidPaths) {
      const config = validConfig();
      config.profiles.local.webhook.path = path;
      expectConfigValidationError(
        () => validateConfig(config),
        "invalid_webhook_path",
        "$.profiles.local.webhook.path"
      );
    }
  });

  test("accepts maxBodyBytes at documented bounds and rejects zero, non-integer, non-finite, and over-limit values", () => {
    for (const maxBodyBytes of [1, 1048576, 10485760]) {
      const config = validConfig();
      config.profiles.local.webhook.maxBodyBytes = maxBodyBytes;
      expect(validateConfig(config).profiles.local.webhook.maxBodyBytes).toBe(maxBodyBytes);
    }

    for (const maxBodyBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10485761]) {
      const config = validConfig();
      config.profiles.local.webhook.maxBodyBytes = maxBodyBytes;
      expectConfigValidationError(
        () => validateConfig(config),
        "invalid_max_body_bytes",
        "$.profiles.local.webhook.maxBodyBytes"
      );
    }
  });

  test("defaults maxBodyBytes to a finite documented value when omitted", () => {
    const config = validConfig();
    delete config.profiles.local.webhook.maxBodyBytes;

    const parsed = validateConfig(config);

    expect(Number.isInteger(parsed.profiles.local.webhook.maxBodyBytes)).toBe(true);
    expect(parsed.profiles.local.webhook.maxBodyBytes).toBe(1048576);
  });

  test("rejects invalid service ports", () => {
    for (const port of [0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, 65536]) {
      const config = validConfig();
      config.profiles.local.service.port = port;
      expectConfigValidationError(
        () => validateConfig(config),
        "invalid_service_port",
        "$.profiles.local.service.port"
      );
    }
  });

  test("rejects invalid service apiPrefix values", () => {
    for (const apiPrefix of ["api", "", "   ", "/../api", "/%252e%252e/api", "/api\0v1"]) {
      const config = validConfig();
      config.profiles.local.service.apiPrefix = apiPrefix;
      expectConfigValidationError(
        () => validateConfig(config),
        "invalid_service_api_prefix",
        "$.profiles.local.service.apiPrefix"
      );
    }
  });
});

describe("@wats/config parseConfig", () => {
  test("parses and validates JSON strings", () => {
    const parsed = parseConfig(JSON.stringify(validConfig()), { format: "json" });

    expect(parsed.defaultProfile).toBe("local");
    expect(parsed.profiles.local.graph.baseUrl).toBe("https://graph.facebook.com");
  });

  test("parses and validates YAML strings", () => {
    const parsed = parseConfig(
      `version: 1\ndefaultProfile: local\nprofiles:\n  local:\n    graph:\n      apiVersion: v19.0\n      baseUrl: https://graph.facebook.com\n    whatsapp:\n      wabaId: "1234567890"\n      phoneNumberId: "0987654321"\n    auth:\n      accessToken:\n        env: WATS_ACCESS_TOKEN\n    webhook:\n      path: /webhook\n      verifyToken:\n        env: WATS_VERIFY_TOKEN\n      appSecret:\n        env: WATS_APP_SECRET\n    service:\n      host: 127.0.0.1\n      port: 3000\n      apiPrefix: /api\n      bearerToken:\n        env: WATS_SERVICE_BEARER_TOKEN\n`,
      { format: "yaml" }
    );

    expect(parsed.profiles.local.webhook.maxBodyBytes).toBe(1048576);
    expect(parsed.profiles.local.service.port).toBe(3000);
  });

  test("rejects malformed JSON and YAML as typed parse errors", () => {
    expectConfigValidationError(
      () => parseConfig("{", { format: "json" }),
      "parse_error",
      "$"
    );

    expectConfigValidationError(
      () => parseConfig("profiles:\n  local:\n    graph", { format: "yaml" }),
      "parse_error",
      "$"
    );
  });

  test("rejects null, empty, whitespace-only, and non-string source values", () => {
    for (const source of [null, undefined, "", "   ", 1, {}, []]) {
      expectConfigValidationError(
        () => parseConfig(source as never, { format: "json" }),
        "invalid_source",
        "$"
      );
    }
  });
});

describe("@wats/config loadConfig", () => {
  test("loads JSON and YAML config files by extension", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "wats-config-test-"));
    const jsonPath = join(tempDir, "tmp-wats-config.json");
    const yamlPath = join(tempDir, "tmp-wats-config.yaml");

    try {
      await Bun.write(jsonPath, JSON.stringify(validConfig()));
      await Bun.write(
        yamlPath,
        `version: 1\ndefaultProfile: local\nprofiles:\n  local:\n    graph:\n      apiVersion: v19.0\n      baseUrl: https://graph.facebook.com\n    whatsapp:\n      wabaId: "1234567890"\n      phoneNumberId: "0987654321"\n    auth:\n      accessToken:\n        env: WATS_ACCESS_TOKEN\n    webhook:\n      path: /webhook\n      verifyToken:\n        env: WATS_VERIFY_TOKEN\n      appSecret:\n        env: WATS_APP_SECRET\n    service:\n      host: 127.0.0.1\n      port: 3000\n      apiPrefix: /api\n      bearerToken:\n        env: WATS_SERVICE_BEARER_TOKEN\n`
      );

      expect((await loadConfig(jsonPath)).defaultProfile).toBe("local");
      expect((await loadConfig(yamlPath)).profiles.local.graph.apiVersion).toBe("v19.0");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(await Bun.file(`${import.meta.dir}/tmp-wats-config.json`).exists()).toBe(false);
    expect(await Bun.file(`${import.meta.dir}/tmp-wats-config.yaml`).exists()).toBe(false);
    expect(await Bun.file(jsonPath).exists()).toBe(false);
    expect(await Bun.file(yamlPath).exists()).toBe(false);
  });

  test("rejects empty file paths and unsupported extensions with typed errors", async () => {
    for (const filePath of ["", "   ", 1, null, undefined]) {
      await expect(loadConfig(filePath as never)).rejects.toThrow(ConfigValidationError);
    }

    await expect(loadConfig(`${import.meta.dir}/config.txt`)).rejects.toThrow(ConfigValidationError);
  });
});

describe("@wats/config redactConfig", () => {
  test("redacts secret env names without mutating the validated config", () => {
    const validated = validateConfig(validConfig());
    const redacted = redactConfig(validated);

    expect(redacted.profiles.local.auth.accessToken.env).toBe("[REDACTED_ENV]");
    expect(redacted.profiles.local.webhook.verifyToken.env).toBe("[REDACTED_ENV]");
    expect(redacted.profiles.local.webhook.appSecret.env).toBe("[REDACTED_ENV]");
    expect(redacted.profiles.local.service.bearerToken.env).toBe("[REDACTED_ENV]");
    expect(validated.profiles.local.auth.accessToken.env).toBe("WATS_ACCESS_TOKEN");
    expect(redacted.profiles.local.graph.apiVersion).toBe("v19.0");
  });

  test("rejects malformed input through the same validation taxonomy", () => {
    expectConfigValidationError(
      () => redactConfig({ version: 1 }),
      "missing_default_profile",
      "$.defaultProfile"
    );
  });
});
