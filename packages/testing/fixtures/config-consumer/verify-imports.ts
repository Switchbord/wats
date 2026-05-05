import {
  ConfigValidationError,
  loadConfig,
  parseConfig,
  redactConfig,
  validateConfig
} from "@switchbord/config";

const checks = {
  loadConfig: typeof loadConfig === "function",
  parseConfig: typeof parseConfig === "function",
  validateConfig: typeof validateConfig === "function",
  redactConfig: typeof redactConfig === "function",
  ConfigValidationError: typeof ConfigValidationError === "function"
};

const ok = Object.values(checks).every((value) => value === true);
console.log(JSON.stringify({ ok, checks, errorName: ConfigValidationError.name }));
if (!ok) {
  process.exit(1);
}
console.log("config-consumer:ok");
