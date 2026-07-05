import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("WATS-171 calling operator docs", () => {
  test("calling docs list current codec and signaling modes without claiming SIP server support", () => {
    const scoped = read("site/content/docs/reference/scoped-clients.mdx");
    const liveCampaign = read("site/content/docs/parity/live-campaign.mdx");
    const parity = read("site/content/docs/parity.mdx");
    const migration = read("site/content/docs/guides/migrating-from-pywa.mdx");
    const combined = `${scoped}\n${liveCampaign}\n${parity}\n${migration}`;

    for (const phrase of [
      "OPUS",
      "PCMA",
      "PCMU",
      "G.711",
      "Graph APIs + webhooks + WebRTC",
      "SIP + WebRTC",
      "SIP + SDES SRTP",
      "no SIP server implementation",
      "2,000 daily messaging limit",
      "USA, Canada, Egypt, Vietnam, Nigeria",
      "App Review",
      "Tech Partner",
      "shape-only"
    ]) {
      expect(combined).toContain(phrase);
    }

    expect(combined).not.toContain("WATS can provision calling access");
    expect(combined).not.toContain("WATS includes a SIP server");
  });
});
