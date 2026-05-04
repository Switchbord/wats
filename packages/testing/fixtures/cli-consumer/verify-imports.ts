import * as cli from "@wats/cli";

const token = await cli.createWebhookVerifyToken();
const result = await cli.runCli(["--help"]);

const checks = {
  runCliFunction: typeof cli.runCli === "function",
  createWebhookVerifyTokenFunction: typeof cli.createWebhookVerifyToken === "function",
  commandResultShape:
    result.exitCode === 0 &&
    typeof result.stdout === "string" &&
    result.stdout.includes("WATS CLI") &&
    result.stderr === "",
  tokenShape: /^wats_wh_[A-Za-z0-9_-]{32,}$/.test(token)
};

const report = {
  ok: Object.values(checks).every((value) => value === true),
  checks,
  moduleKeys: Object.keys(cli).sort()
};

console.log(JSON.stringify(report));
if (!report.ok) {
  process.exitCode = 1;
} else {
  console.log("cli-consumer:ok");
}
