import { spawnSync } from "node:child_process";

const steps = [
  ["bun", ["run", "docs:openapi"]],
  ["bun", ["run", "docs:api"]],
  ["bunx", ["vitepress", "build", "docs"]],
  ["bun", ["run", "docs:check"]]
] as const;

for (const [cmd, args] of steps) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      WATS_ACCESS_TOKEN: "REDACTION_CANARY_WATS_ACCESS_TOKEN",
      WATS_APP_SECRET: "REDACTION_CANARY_WATS_APP_SECRET",
      TRACKER_API_KEY: "REDACTION_CANARY_LINEAR",
      REMOTE_TOKEN: "REDACTION_CANARY_GITHUB",
      REGISTRY_TOKEN: "REDACTION_CANARY_NPM"
    }
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
