// One-off: inspect approved templates in-process to find a deliverable one
// for a status-webhook delivery confirmation. Prints only template NAME,
// language, status, category, and the component/param skeleton — no PII, no
// recipient data. Names are the business's own config (not PII/secret) and
// are needed to actually send; kept to stdout only, never persisted raw.

import { GraphClient } from "@wats/graph";
import { listMessageTemplates } from "@wats/graph/endpoints/templates";
import { liveGate } from "./ledger.ts";

function reqEnv(n: string): string {
  const v = process.env[n];
  if (!v) throw new Error(`missing ${n}`);
  return v;
}

async function main(): Promise<void> {
  if (!liveGate().enabled) { console.log(JSON.stringify({ blocked: true })); return; }
  const client = new GraphClient({
    accessToken: reqEnv("WATS_ACCESS_TOKEN"),
    apiVersion: process.env.WATS_GRAPH_API_VERSION ?? "v25.0",
    baseUrl: `${process.env.WATS_GRAPH_BASE_URL ?? "https://graph.facebook.com"}/`
  });
  const res = await listMessageTemplates(client, { wabaId: reqEnv("WATS_WABA_ID") }) as {
    data?: ReadonlyArray<{ name?: string; language?: string; status?: string; category?: string; components?: ReadonlyArray<{ type?: string; format?: string; text?: string; example?: unknown }> }>;
  };
  for (const t of res.data ?? []) {
    // Count body params via {{n}} placeholders in body text.
    const body = (t.components ?? []).find((c) => c.type === "BODY");
    const placeholders = body?.text ? (body.text.match(/\{\{\d+\}\}/g) ?? []).length : 0;
    const compTypes = (t.components ?? []).map((c) => `${c.type}${c.format ? `:${c.format}` : ""}`);
    console.log(JSON.stringify({
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      bodyParams: placeholders,
      components: compTypes
    }));
  }
}

main().catch((e) => console.log(JSON.stringify({ error: e instanceof Error ? e.name : "Error" })));
