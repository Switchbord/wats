import {
  createWatsServiceApp,
  createWatsServiceOpenApiDocument,
  WatsServiceError,
  type WatsServiceConfig,
  type WatsServiceApp,
  type WatsServiceOpenApiOptions
} from "@switchbord/service";
import { createMockTransport } from "@switchbord/graph/testing";

interface VerifyReportOk {
  readonly ok: true;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly sentinel: "service-consumer:ok";
}

async function main(): Promise<void> {
  const checks: Record<string, boolean> = {};
  checks["createWatsServiceApp is a function"] = typeof createWatsServiceApp === "function";
  checks["createWatsServiceOpenApiDocument is a function"] = typeof createWatsServiceOpenApiDocument === "function";
  checks["WatsServiceError is constructable"] = new WatsServiceError("invalid_config") instanceof Error;

  const mock = createMockTransport({
    defaultResponse: { status: 200, body: { messages: [{ id: "wamid.CONSUMER" }] } }
  });
  const config: WatsServiceConfig = {
    profile: {
      graph: { apiVersion: "v21.0", baseUrl: "https://graph.test/" },
      whatsapp: { wabaId: "1234567890", phoneNumberId: "15551234567" },
      auth: { accessToken: { env: "WATS_ACCESS_TOKEN" } },
      webhook: {
        path: "/webhook",
        verifyToken: { env: "WATS_WEBHOOK_VERIFY_TOKEN" },
        appSecret: { env: "WATS_WEBHOOK_APP_SECRET" },
        maxBodyBytes: 1_048_576
      },
      service: {
        host: "127.0.0.1",
        port: 8787,
        apiPrefix: "/api",
        bearerToken: { env: "WATS_SERVICE_BEARER_TOKEN" }
      }
    },
    secrets: {
      accessToken: "fixture-graph-token",
      webhookVerifyToken: "fixture-verify-token",
      webhookAppSecret: "fixture-app-secret",
      serviceBearerToken: "fixture-service-token"
    },
    transport: mock.transport
  };

  const app: WatsServiceApp = createWatsServiceApp(config);
  const health = await app.fetch(new Request("https://fixture.test/healthz"));
  checks["health route works through public package import"] = health.status === 200;

  const send = await app.fetch(new Request("https://fixture.test/api/messages/text", {
    method: "POST",
    headers: {
      authorization: "Bearer fixture-service-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ to: "15550001111", text: "hello from consumer" })
  }));
  checks["text send route works through MockTransport"] = send.status === 200 && mock.requests.length === 1;
  checks["service bearer token is not forwarded to Graph"] =
    mock.requests[0]?.headers.get("authorization") === "Bearer fixture-graph-token";

  const options: WatsServiceOpenApiOptions = { serverUrl: "https://fixture.test" };
  const openapi = createWatsServiceOpenApiDocument(config.profile, options);
  checks["OpenAPI generator returns 3.1 document through public import"] = openapi.openapi === "3.1.0";
  checks["OpenAPI document contains fixture webhook path"] = Object.hasOwn(openapi.paths, "/webhook");

  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) throw new Error(`service-consumer check failed: ${label}`);
  }

  const report: VerifyReportOk = {
    ok: true,
    checks,
    sentinel: "service-consumer:ok"
  };
  console.log(JSON.stringify(report));
  console.log(report.sentinel);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
