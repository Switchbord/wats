// Generates src/generated/hero-captured.json by RUNNING snippets/hero.ts
// under bun and capturing the MockTransport request it prints.
// The hero terminal panel renders this file — never hand-write it.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const snippetsDir = join(here, "..", "snippets");
const outPath = join(here, "..", "src", "generated", "hero-captured.json");

const run = spawnSync("bun", ["run", "hero.ts"], {
  cwd: snippetsDir,
  encoding: "utf-8",
});
if (run.status !== 0) {
  console.error("gen-hero-capture: FAIL — hero.ts did not run clean");
  console.error(run.stdout, run.stderr);
  process.exit(1);
}

const captured = JSON.parse(run.stdout) as Array<{
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}>;
if (captured.length !== 1) {
  console.error(`gen-hero-capture: FAIL — expected 1 captured request, got ${captured.length}`);
  process.exit(1);
}

// Render shape for the hero panel: parsed body, redacted auth header.
const req = captured[0]!;
const display = {
  method: req.method,
  url: req.url,
  headers: { ...req.headers, authorization: "Bearer demo-token" },
  body: JSON.parse(req.body) as unknown,
};
writeFileSync(outPath, JSON.stringify(display, null, 2) + "\n");
console.log(`gen-hero-capture: OK — wrote ${outPath}`);
