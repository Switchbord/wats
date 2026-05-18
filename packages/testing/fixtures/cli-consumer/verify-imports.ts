import * as cli from "@wats/cli";

const token = await cli.createWebhookVerifyToken();
const result = await cli.runCli(["--help"]);
const observedSignalRegistrations: string[] = [];
const originalProcessMethods = {
  addListener: process.addListener,
  on: process.on,
  once: process.once,
  prependListener: process.prependListener,
  prependOnceListener: process.prependOnceListener
};
const originalProcessExit = process.exit;
const recordSignalRegistration = (event: string | symbol): typeof process => {
  observedSignalRegistrations.push(String(event));
  return process;
};

try {
  process.addListener = recordSignalRegistration as typeof process.addListener;
  process.on = recordSignalRegistration as typeof process.on;
  process.once = recordSignalRegistration as typeof process.once;
  process.prependListener = recordSignalRegistration as typeof process.prependListener;
  process.prependOnceListener = recordSignalRegistration as typeof process.prependOnceListener;
  process.exit = ((code?: number): never => {
    throw new Error(`runCli must not exit the embedding process: ${code ?? "undefined"}`);
  }) as typeof process.exit;
  await cli.runCli(["--help"]);
} finally {
  process.addListener = originalProcessMethods.addListener.bind(process) as typeof process.addListener;
  process.on = originalProcessMethods.on.bind(process) as typeof process.on;
  process.once = originalProcessMethods.once.bind(process) as typeof process.once;
  process.prependListener = originalProcessMethods.prependListener.bind(process) as typeof process.prependListener;
  process.prependOnceListener = originalProcessMethods.prependOnceListener.bind(process) as typeof process.prependOnceListener;
  process.exit = originalProcessExit.bind(process) as typeof process.exit;
}

const checks = {
  runCliFunction: typeof cli.runCli === "function",
  createWebhookVerifyTokenFunction: typeof cli.createWebhookVerifyToken === "function",
  commandResultShape:
    result.exitCode === 0 &&
    typeof result.stdout === "string" &&
    result.stdout.includes("WATS CLI") &&
    result.stderr === "",
  runCliDoesNotRegisterSignals: observedSignalRegistrations.length === 0,
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
