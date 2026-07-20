import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("forensic docs current-surface reconciliation", () => {
  test("phone registration and local-storage docs do not claim data_localization_region is never emitted", () => {
    const endpoints = read("site/content/docs/reference/endpoints.mdx");
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    for (const doc of [endpoints, scoped]) {
      expect(doc).not.toContain("WATS does not expose a phone registration helper");
      expect(doc).not.toContain("data_localization_region` is never emitted");
      expect(doc).toContain("registerPhoneNumber");
      expect(doc).toContain("data_localization_region");
      expect(doc).toContain("storage_configuration");
    }
  });

  test("scoped-client catalogs name the current phone, WABA, template, and Flow helper families", () => {
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    for (const needle of [
      "uploadAndSendImage",
      "requestVerificationCode",
      "registerPhoneNumber",
      "createQrCode",
      "getBusinessPublicKey",
      "setCallbackOverride",
      "clearCallbackOverride",
      "createPhoneNumber",
      "compareTemplates",
      "migrateTemplates",
      "archiveTemplates",
      "upsertAuthenticationTemplate",
      "getFlowMetrics",
      "migrateFlows"
    ]) {
      expect(scoped).toContain(needle);
    }
  });

  test("endpoint subpath docs and consumer fixture cover Groups, node media, advanced templates, and Flow metrics", () => {
    const endpoints = read("site/content/docs/reference/endpoints.mdx");
    expect(endpoints).toContain("@wats/graph/endpoints/groups");
    expect(endpoints).toContain("@wats/graph/node-media");

    const fixture = read("packages/testing/fixtures/graph-consumer/verify-imports.ts");
    expect(fixture).toContain("WATS-160 advanced template helpers are exported from root and subpath");
    expect(fixture).toContain("templatesSubpath.migrateTemplates === migrateTemplates");
    expect(fixture).toContain("flowsSubpath.getFlowMetrics === getFlowMetrics");
    expect(fixture).toContain("flowsSubpath.migrateFlows === migrateFlows");
  });

  test("public surface, roadmap, parity, and migration docs no longer list shipped helper families as planned gaps", () => {
    const surface = read("site/content/docs/concepts/public-api-surface.mdx");
    expect(surface).toContain("GET {profile.service.apiPrefix}/messages");
    expect(surface).toContain("opt-in Groups routes");
    expect(surface).toContain("wats setup");
    expect(surface).toContain("wats serve --config <path> --paas");
    expect(surface).not.toContain("observed status UI");
    expect(surface).not.toContain("supported Dockerfile, Compose file");

    const roadmap = read("site/content/docs/meta/roadmap.mdx");
    expect(roadmap).toContain("template helpers: list/create/get/update/delete, compare, unpause, migrate, archive/unarchive");
    expect(roadmap).toContain("calling: initiate/pre-accept/accept/reject/terminate, call permissions");
    expect(roadmap).not.toContain("Encrypted Flow data-exchange request decrypt / response encrypt handling.");
    expect(roadmap).not.toContain("High-level template-library, comparison, migration, unpause");

    const parity = read("site/content/docs/parity.mdx");
    expect(parity).toContain("Embedded Signup token exchange is shape-only");
    expect(parity).toContain("planned for catalog CRUD");

    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    expect(migration).not.toContain("one-call local-file/bytes media send polymorphism");
    expect(migration).not.toContain("compare/migrate/unpause");
    expect(migration).not.toContain("calling permissions, calling settings/SIP mutations");
  });

  test("deployment docs distinguish shipped Railway Dockerfile from production container support", () => {
    const docker = read("site/content/docs/guides/deploy-docker.mdx");
    const service = read("site/content/docs/reference/service.mdx");
    const railway = read("deploy/railway/README.md");
    expect(docker).toContain("repo ships a Railway-targeted root `Dockerfile`");
    expect(service).toContain("The repo ships a Railway-targeted root `Dockerfile`");
    expect(railway).toContain("does not auto-inject a persistence store");
    expect(railway).toContain("local message projection");
    expect(docker).not.toContain("no supported root Dockerfile");
    expect(service).not.toContain("There is no supported Dockerfile");
    expect(railway).not.toContain("no persistence is wired into `serve` yet");
  });

  test("service reference documents opt-in runtime env flags without claiming default telemetry", () => {
    const service = read("site/content/docs/reference/service.mdx");
    expect(service).toContain("WATS_LOG_WEBHOOK_EVENTS=1");
    expect(service).toContain("WATS_ECHO_REPLY=1");
    expect(service).toContain("no message text, raw webhook body, token, phone number, or WAMID");
    expect(service).toContain("If you inject your own `whatsapp` facade, these flags do nothing.");
  });
});
