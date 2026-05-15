import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createWatsServiceOpenApiDocument } from "../packages/service/src/index";
import type { WatsProfileConfig } from "../packages/config/src/index";
import { readReleaseVersion, repoRoot } from "./release-metadata";

const outputPathForDocsLock = "docs/public/openapi.json";
const outputPath = join(repoRoot, "docs", "public", "openapi.json");
void outputPathForDocsLock;

const FORBIDDEN_OPENAPI_STRINGS = [
  "WATS_ACCESS_TOKEN",
  "WATS_VERIFY_TOKEN",
  "WATS_APP_SECRET",
  "WATS_SERVICE_TOKEN",
  "LINEAR_API_KEY",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
  "SHOULD_NOT_APPEAR"
] as const;

const profile: WatsProfileConfig = Object.freeze({
  graph: Object.freeze({
    apiVersion: "v25.0",
    baseUrl: "https://graph.facebook.com"
  }),
  whatsapp: Object.freeze({
    wabaId: "1234567890",
    phoneNumberId: "9876543210"
  }),
  auth: Object.freeze({ accessToken: Object.freeze({ env: "DOCS_ACCESS_TOKEN" }) }),
  webhook: Object.freeze({
    path: "/webhook",
    verifyToken: Object.freeze({ env: "DOCS_VERIFY_TOKEN" }),
    appSecret: Object.freeze({ env: "DOCS_APP_SECRET" }),
    maxBodyBytes: 1_048_576
  }),
  service: Object.freeze({
    host: "127.0.0.1",
    port: 3000,
    apiPrefix: "/v1",
    bearerToken: Object.freeze({ env: "DOCS_SERVICE_TOKEN" })
  })
});

const document = createWatsServiceOpenApiDocument(profile, {
  serverUrl: "https://service.example",
  title: "WATS Service API",
  version: readReleaseVersion()
});

const json = `${JSON.stringify(document, null, 2)}\n`;
for (const forbidden of FORBIDDEN_OPENAPI_STRINGS) {
  if (json.includes(forbidden)) {
    throw new Error(`generated OpenAPI contains forbidden string: ${forbidden}`);
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, json, "utf8");
console.log(`generated ${outputPath}`);
