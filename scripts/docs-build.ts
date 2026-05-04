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
      WATS_ACCESS_TOKEN: "SHOULD_NOT_APPEAR_WATS_ACCESS_TOKEN",
      WATS_APP_SECRET: "SHOULD_NOT_APPEAR_WATS_APP_SECRET",
      LINEAR_API_KEY: "SHOULD_NOT_APPEAR_LINEAR",
      GITHUB_TOKEN: "SHOULD_NOT_APPEAR_GITHUB",
      NPM_TOKEN: "SHOULD_NOT_APPEAR_NPM"
    }
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
