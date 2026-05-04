import { ConfigValidationError, loadConfig, parseConfig, redactConfig, type WatsConfig, type WatsProfileConfig } from "@wats/config";
import { createWatsServiceOpenApiDocument, WatsServiceError } from "@wats/service";

export type CliCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type CliCommandContext = Readonly<{
  argv: readonly string[];
}>;

type ParsedOptionValue = Readonly<{
  ok: true;
  value: string | undefined;
  present: boolean;
}> | Readonly<{
  ok: false;
  reason: "unknown" | "missing" | "duplicate" | "invalid";
}>;

type ConfigValidateArgs = Readonly<{
  ok: true;
  path: string;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage";
}>;

type OpenApiArgs = Readonly<{
  ok: true;
  configPath: string;
  profileName?: string;
  serverUrl?: string;
  outPath?: string;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage";
}>;

type InitFormat = "yaml" | "json";

type InitArgs = Readonly<{
  ok: true;
  dir: string;
  format: InitFormat;
  profileName: string;
  dryRun: boolean;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage";
}>;

const NO_LIVE_CREDENTIALS = "No live credentials are read or required by this command.";

const ROOT_HELP = `WATS CLI

Usage: wats <command> [options]

Implemented commands:
  wats init [dir] [--dry-run]              Generate WATS config/env placeholders safely.
  wats config validate <path>              Validate a WATS config file safely.
  wats config validate --config <path>     Validate a WATS config file safely.
  wats doctor --help                       Show offline diagnostics help.
  wats openapi --config <path>             Print WATS service OpenAPI JSON.
  wats serve --help                        Show service-runtime handoff help.
  wats webhook token [--help]              Print a local webhook verify token.

${NO_LIVE_CREDENTIALS}
Commands do not call Graph APIs or resolve env-secret values.
`;

const INIT_HELP = `Usage: wats init [dir] [--dry-run] [--format yaml|json] [--profile <name>]

Generate WATS config and .env.example placeholder files for local onboarding.

Options:
  --dry-run              Preview generated files without writing.
  --format yaml|json     Choose wats.config.yaml or wats.config.json (default: yaml).
  --profile <name>       Set the generated default profile name (default: local).

Writes only wats.config.yaml/json and .env.example, refuses to overwrite existing files, uses env-secret references, and does not resolve live credentials, read .env.local, or call Meta Graph APIs.
${NO_LIVE_CREDENTIALS}
`;

const CONFIG_VALIDATE_HELP = `Usage: wats config validate <path>
       wats config validate --config <path>

Validates a WATS config file (JSON/YAML) with @wats/config loadConfig/validate behavior.

Output on success is a safe count summary only: config valid, redacted default profile marker, and profile count. The command does not resolve env-secret values, read .env.local, call Meta Graph APIs, print profile names, or print raw secret env-var names.

Errors exit 1 and report ConfigValidationError code/path/message without stack traces or attacker-supplied path-like values. Unknown options fail closed.
${NO_LIVE_CREDENTIALS}
`;

const DOCTOR_HELP = `Usage: wats doctor [--help]

Show planned offline diagnostics for a WATS project.

Current implementation: offline diagnostics help only; no Graph API calls, no token checks against Meta, and no filesystem writes.
${NO_LIVE_CREDENTIALS}
`;

const OPENAPI_HELP = `Usage: wats openapi --config <path> [--profile <name>] [--server-url <http(s) URL>] [--out <path>]

Loads a WATS config file and exports OpenAPI 3.1 JSON for the WATS service API routes implemented by @wats/service.

Prints OpenAPI JSON to stdout by default. With --profile, selects a named config profile; otherwise the config default profile is used. With --server-url, passes the http(s) URL to the generator, which validates and canonicalizes it.

--out <path> writes JSON only when explicit and refuses to overwrite an existing target. Relative --out paths resolve under the current working directory. Directories, path traversal, NUL/control characters, and empty output paths are rejected.

The document is for the WATS service API only, not the Meta Graph API. The command does not resolve env-secret values, read .env.local, call Meta Graph APIs, or print config secret env-var names.
${NO_LIVE_CREDENTIALS}
`;

const SERVE_HELP = `Usage: wats serve --help

Show service-runtime handoff help.

The server runtime is not implemented in this CLI slice. Use @wats/service programmatically for the current Request -> Response service app; a future CLI slice will add a tested no-surprise process runtime.
${NO_LIVE_CREDENTIALS}
`;

const WEBHOOK_TOKEN_HELP = `Usage: wats webhook token [--help]

Safely prints one freshly generated verify token for local webhook setup.

Current implementation: generates a local random token and writes it to stdout only. It does not write files, update .env.local, call Graph APIs, or read live credentials.
${NO_LIVE_CREDENTIALS}
`;


const INIT_DEFAULT_PROFILE = "local" as const;
const INIT_DEFAULT_FORMAT: InitFormat = "yaml";
const INIT_ALLOWED_FLAGS = ["--dry-run", "--format", "--profile"] as const;
const INIT_VALUE_FLAGS = ["--format", "--profile"] as const;
const INIT_ENV_LINES = [
  "# WATS local placeholder environment file generated by `wats init`.",
  "# Copy values from your secret manager or local environment; do not commit real values.",
  "WATS_ACCESS_TOKEN=",
  "WATS_WABA_ID=",
  "WATS_PHONE_NUMBER_ID=",
  "WATS_VERIFY_TOKEN=",
  "WATS_APP_SECRET=",
  "WATS_SERVICE_TOKEN=",
  "WATS_LIVE_ENABLE=0",
  "WATS_YES_LIVE=0"
] as const;

const ROOT_HELP_FLAGS = new Set(["--help", "-h"]);
const ALLOWED_WEBHOOK_TOKEN_FLAGS = new Set(["--help", "-h"]);
const TOKEN_RANDOM_BYTE_LENGTH = 32;

function ok(stdout: string): CliCommandResult {
  return Object.freeze({ exitCode: 0, stdout, stderr: "" });
}

function fail(stderr: string): CliCommandResult {
  return Object.freeze({ exitCode: 1, stdout: "", stderr });
}

function hasHelpFlag(args: readonly string[]): boolean {
  return args.some((arg) => ROOT_HELP_FLAGS.has(arg));
}

function hasUnknownFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg.startsWith("-") && !ROOT_HELP_FLAGS.has(arg));
}

function isNonEmptyArg(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const btoaFn = globalThis.btoa;
  if (typeof btoaFn === "function") {
    return btoaFn(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  }

  const maybeBuffer = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (maybeBuffer !== undefined) {
    return maybeBuffer.from(bytes).toString("base64url");
  }

  throw new Error("No base64url encoder available in this runtime");
}

function getCrypto(): Crypto | undefined {
  return globalThis.crypto;
}

export async function createWebhookVerifyToken(): Promise<string> {
  const cryptoProvider = getCrypto();

  if (cryptoProvider !== undefined && typeof cryptoProvider.getRandomValues === "function") {
    const bytes = new Uint8Array(TOKEN_RANDOM_BYTE_LENGTH);
    cryptoProvider.getRandomValues(bytes);
    return `wats_wh_${base64Url(bytes)}`;
  }

  if (cryptoProvider !== undefined && typeof cryptoProvider.randomUUID === "function") {
    return `wats_wh_${cryptoProvider.randomUUID().replaceAll("-", "")}`;
  }

  throw new Error("No secure random token generator available in this runtime");
}

function sanitizeCommandLabel(args: readonly string[]): string {
  const first = args[0];
  if (typeof first !== "string" || first.length === 0) {
    return "<empty>";
  }

  if (/^[a-z][a-z0-9-]{0,31}$/u.test(first)) {
    return first;
  }

  return "<invalid>";
}

function safeValidationMessage(message: string): string {
  if (message.includes("$.profiles.")) {
    return "config profile validation failed";
  }
  return message
    .replace(/config file could not be read:.*/u, "config file could not be read")
    .replace(/EAA[A-Za-z0-9_-]{20,}/gu, "[REDACTED]")
    .replace(/raw-[A-Za-z0-9_-]*token[A-Za-z0-9_-]*/giu, "[REDACTED]");
}

function safeValidationPath(path: string): string {
  if (path.startsWith("$.profiles.")) {
    return "$.profiles.<redacted>";
  }
  return path;
}

function firstIssue(error: ConfigValidationError): { code: string; path: string; message: string } {
  const issue = error.issues[0];
  if (issue !== undefined) {
    return {
      code: issue.code,
      path: safeValidationPath(issue.path),
      message: safeValidationMessage(issue.message)
    };
  }
  return {
    code: error.code,
    path: safeValidationPath(error.path),
    message: safeValidationMessage(error.message)
  };
}

function formatConfigValidationError(error: ConfigValidationError, hint: string): string {
  const issue = firstIssue(error);
  return `ConfigValidationError\ncode: ${issue.code}\npath: ${issue.path}\nmessage: ${issue.message}\nRun \`${hint}\` for usage.\n`;
}

function formatWatsServiceError(error: WatsServiceError, hint: string): string {
  return `WatsServiceError\ncode: ${error.code}\nmessage: ${error.message}\nRun \`${hint}\` for usage.\n`;
}

function safeGenericError(hint: string): string {
  return `Command failed safely. Run \`${hint}\` for usage.\n`;
}

function configSummary(config: WatsConfig): string {
  const redacted = redactConfig(config);
  return [
    "config valid",
    "default profile: [REDACTED_PROFILE]",
    `profiles: ${Object.keys(redacted.profiles).length}`
  ].join("\n") + "\n";
}

function parseFlagValue(args: readonly string[], names: readonly string[], allFlagsWithValues: readonly string[]): ParsedOptionValue {
  let value: string | undefined;
  let present = false;
  const nameSet = new Set(names);
  const allValueFlagSet = new Set(allFlagsWithValues);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) {
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const flagName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    if (!allValueFlagSet.has(flagName)) {
      return { ok: false, reason: "unknown" };
    }
    if (!nameSet.has(flagName)) {
      if (equalsIndex === -1) {
        index += 1;
      }
      continue;
    }
    if (present) {
      return { ok: false, reason: "duplicate" };
    }
    present = true;

    if (equalsIndex !== -1) {
      value = arg.slice(equalsIndex + 1);
    } else {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) {
        return { ok: false, reason: "missing" };
      }
      value = next;
      index += 1;
    }

    if (!isNonEmptyArg(value)) {
      return { ok: false, reason: "invalid" };
    }
  }

  return { ok: true, value, present };
}

function nonFlagArgs(args: readonly string[], allFlagsWithValues: readonly string[]): string[] | null {
  const values: string[] = [];
  const allValueFlagSet = new Set(allFlagsWithValues);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) {
      const equalsIndex = arg.indexOf("=");
      const flagName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
      if (!allValueFlagSet.has(flagName)) {
        return null;
      }
      if (equalsIndex === -1) {
        index += 1;
      }
      continue;
    }
    values.push(arg);
  }
  return values;
}


function isSafeProfileName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u.test(value) && !/token|secret|password|\.\.|[\\/]/iu.test(value);
}

function hasUnsafeTargetPath(value: string): boolean {
  if (!isNonEmptyArg(value) || value.includes("\\") || value.includes("?") || value.includes("#")) return true;
  if (value === ".") return false;
  const withoutRoot = value.startsWith("/") ? value.slice(1) : value;
  const withoutLeadingDot = withoutRoot.startsWith("./") ? withoutRoot.slice(2) : withoutRoot;
  return withoutLeadingDot.split(/[\\/]+/u).some((segment) => segment.length === 0 || segment === "." || segment === "..");
}

function resolveInitTargetDir(value: string): string | null {
  if (hasUnsafeTargetPath(value)) return null;
  if (value === ".") return (globalThis as { process?: { cwd(): string } }).process?.cwd?.() ?? ".";
  if (value.startsWith("/")) return value;
  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd?.() ?? ".";
  const relativePath = value.startsWith("./") ? value.slice(2) : value;
  return `${cwd.replace(/\/+$/u, "")}/${relativePath}`;
}

function parseInitArgs(args: readonly string[]): InitArgs {
  let dryRun = false;
  let format: InitFormat = INIT_DEFAULT_FORMAT;
  let formatSeen = false;
  let profileName: string = INIT_DEFAULT_PROFILE;
  let profileSeen = false;
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.trim().length === 0) return { ok: false, reason: "usage" };
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const flagName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    if (ROOT_HELP_FLAGS.has(flagName)) {
      return args.some((sidecar) => sidecar.startsWith("-") && !ROOT_HELP_FLAGS.has(sidecar.includes("=") ? sidecar.slice(0, sidecar.indexOf("=")) : sidecar))
        ? { ok: false, reason: "usage" }
        : { ok: false, reason: "help" };
    }

    if (flagName === "--dry-run") {
      if (dryRun || equalsIndex !== -1) return { ok: false, reason: "usage" };
      dryRun = true;
      continue;
    }

    if (flagName !== "--format" && flagName !== "--profile") return { ok: false, reason: "usage" };
    const value = equalsIndex === -1 ? args[index + 1] : arg.slice(equalsIndex + 1);
    if (equalsIndex === -1) index += 1;
    if (!isNonEmptyArg(value)) return { ok: false, reason: "usage" };

    if (flagName === "--format") {
      if (formatSeen || (equalsIndex !== -1 && arg.slice(equalsIndex + 1).length === 0)) return { ok: false, reason: "usage" };
      if (value !== "yaml" && value !== "json") return { ok: false, reason: "usage" };
      format = value;
      formatSeen = true;
    } else {
      if (profileSeen) return { ok: false, reason: "usage" };
      profileName = value;
      profileSeen = true;
    }
  }

  if (!isSafeProfileName(profileName) || positionals.length > 1) return { ok: false, reason: "usage" };
  const targetDir = resolveInitTargetDir(positionals[0] ?? ".");
  if (targetDir === null) return { ok: false, reason: "usage" };
  return { ok: true, dir: targetDir, format, profileName, dryRun };
}

function initConfigObject(profileName: string): WatsConfig {
  const profile = Object.freeze({
    graph: Object.freeze({ apiVersion: "v21.0", baseUrl: "https://graph.facebook.com" }),
    whatsapp: Object.freeze({ wabaId: "000000000000000", phoneNumberId: "00000000000" }),
    auth: Object.freeze({ accessToken: Object.freeze({ env: "WATS_ACCESS_TOKEN" }) }),
    webhook: Object.freeze({
      path: "/webhooks/whatsapp",
      verifyToken: Object.freeze({ env: "WATS_VERIFY_TOKEN" }),
      appSecret: Object.freeze({ env: "WATS_APP_SECRET" }),
      maxBodyBytes: 1_048_576
    }),
    service: Object.freeze({
      host: "127.0.0.1",
      port: 8787,
      apiPrefix: "/api",
      bearerToken: Object.freeze({ env: "WATS_SERVICE_TOKEN" })
    })
  }) satisfies WatsProfileConfig;
  return Object.freeze({ version: 1, defaultProfile: profileName, profiles: Object.freeze({ [profileName]: profile }) }) as WatsConfig;
}

function quoteYaml(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/u.test(value) ? value : JSON.stringify(value);
}

function formatInitYaml(config: WatsConfig): string {
  const profileName = config.defaultProfile;
  const profile = config.profiles[profileName] as WatsProfileConfig;
  return `version: 1
defaultProfile: ${quoteYaml(profileName)}
profiles:
  ${quoteYaml(profileName)}:
    graph:
      apiVersion: ${profile.graph.apiVersion}
      baseUrl: ${profile.graph.baseUrl}
    whatsapp:
      wabaId: "${profile.whatsapp.wabaId}"
      phoneNumberId: "${profile.whatsapp.phoneNumberId}"
    auth:
      accessToken:
        env: ${profile.auth.accessToken.env}
    webhook:
      path: ${profile.webhook.path}
      verifyToken:
        env: ${profile.webhook.verifyToken.env}
      appSecret:
        env: ${profile.webhook.appSecret.env}
      maxBodyBytes: ${profile.webhook.maxBodyBytes}
    service:
      host: ${profile.service.host}
      port: ${profile.service.port}
      apiPrefix: ${profile.service.apiPrefix}
      bearerToken:
        env: ${profile.service.bearerToken.env}
`;
}

function formatInitJson(config: WatsConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function formatInitEnv(): string {
  return `${INIT_ENV_LINES.join("\n")}\n`;
}

function initSummary(kind: "dry-run" | "complete", format: InitFormat): string {
  return [`init ${kind}`, "files: 2", `format: ${format}`, "profile: [REDACTED_PROFILE]", NO_LIVE_CREDENTIALS].join("\n") + "\n";
}

async function ensureDir(path: string): Promise<boolean> {
  try {
    const fsPromisesSpecifier = "node:fs/promises";
    const fs = await import(/* @vite-ignore */ fsPromisesSpecifier) as { mkdir(path: string, options: { recursive: true }): Promise<void> };
    await fs.mkdir(path, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function initCommand(args: readonly string[]): Promise<CliCommandResult> {
  const parsed = parseInitArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(INIT_HELP);
    return fail("Invalid init arguments. Run `wats init --help` for usage.\n");
  }

  const config = parseConfig(formatInitJson(initConfigObject(parsed.profileName)), { format: "json" });
  const configFile = parsed.format === "yaml" ? "wats.config.yaml" : "wats.config.json";
  const configPath = `${parsed.dir.replace(/\/+$/u, "")}/${configFile}`;
  const envPath = `${parsed.dir.replace(/\/+$/u, "")}/.env.example`;
  const configText = parsed.format === "yaml" ? formatInitYaml(config) : formatInitJson(config);
  const envText = formatInitEnv();

  if (parsed.dryRun) return ok(initSummary("dry-run", parsed.format));

  if (!await ensureDir(parsed.dir)) return fail("Invalid output directory. Run `wats init --help` for usage.\n");
  if (await fileExists(configPath) || await fileExists(envPath)) {
    return fail("Output target exists; refusing to overwrite. Run `wats init --help` for usage.\n");
  }
  const configWrite = await writeTextFileExclusive(configPath, configText);
  if (configWrite !== "written") return fail("Output target exists; refusing to overwrite. Run `wats init --help` for usage.\n");
  const envWrite = await writeTextFileExclusive(envPath, envText);
  if (envWrite !== "written") {
    await removeFileBestEffort(configPath);
    return fail("Output target exists; refusing to overwrite. Run `wats init --help` for usage.\n");
  }
  return ok(initSummary("complete", parsed.format));
}

function parseConfigValidateArgs(args: readonly string[]): ConfigValidateArgs {
  const configFlags = ["--config"];
  for (const arg of args) {
    if (!arg.startsWith("-")) continue;
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!configFlags.includes(flagName) && !ROOT_HELP_FLAGS.has(flagName)) {
      return { ok: false, reason: "usage" };
    }
  }

  if (hasHelpFlag(args)) {
    return { ok: false, reason: "help" };
  }

  const configFlag = parseFlagValue(args, ["--config"], configFlags);
  if (!configFlag.ok) {
    return { ok: false, reason: "usage" };
  }

  const positional = nonFlagArgs(args, configFlags);
  if (positional === null) {
    return { ok: false, reason: "usage" };
  }
  const cleanPositionals = positional.filter((arg) => arg.trim().length > 0);

  if (configFlag.present) {
    if (cleanPositionals.length !== 0 || configFlag.value === undefined) {
      return { ok: false, reason: "usage" };
    }
    return { ok: true, path: configFlag.value };
  }

  if (cleanPositionals.length !== 1 || !isNonEmptyArg(cleanPositionals[0])) {
    return { ok: false, reason: "usage" };
  }
  return { ok: true, path: cleanPositionals[0] };
}

function parseOpenApiArgs(args: readonly string[]): OpenApiArgs {
  const allowedFlags = ["--config", "--profile", "--server-url", "--out"];
  for (const arg of args) {
    if (!arg.startsWith("-")) continue;
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!allowedFlags.includes(flagName) && !ROOT_HELP_FLAGS.has(flagName)) {
      return { ok: false, reason: "usage" };
    }
  }

  if (hasHelpFlag(args)) {
    return { ok: false, reason: "help" };
  }

  const configFlag = parseFlagValue(args, ["--config"], allowedFlags);
  const profileFlag = parseFlagValue(args, ["--profile"], allowedFlags);
  const serverUrlFlag = parseFlagValue(args, ["--server-url"], allowedFlags);
  const outFlag = parseFlagValue(args, ["--out"], allowedFlags);
  if (!configFlag.ok || !profileFlag.ok || !serverUrlFlag.ok || !outFlag.ok || !configFlag.present || configFlag.value === undefined) {
    return { ok: false, reason: "usage" };
  }

  const positional = nonFlagArgs(args, allowedFlags);
  if (positional === null || positional.some((arg) => arg.trim().length > 0)) {
    return { ok: false, reason: "usage" };
  }

  return {
    ok: true,
    configPath: configFlag.value,
    ...(profileFlag.value !== undefined ? { profileName: profileFlag.value } : {}),
    ...(serverUrlFlag.value !== undefined ? { serverUrl: serverUrlFlag.value } : {}),
    ...(outFlag.value !== undefined ? { outPath: outFlag.value } : {})
  };
}

async function validateConfigCommand(args: readonly string[]): Promise<CliCommandResult> {
  const parsed = parseConfigValidateArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(CONFIG_VALIDATE_HELP);
    return fail("Missing or invalid config path. Run `wats config validate --help` for usage.\n");
  }

  try {
    const config = await loadConfig(parsed.path);
    return ok(configSummary(config));
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return fail(formatConfigValidationError(error, "wats config validate --help"));
    }
    return fail(safeGenericError("wats config validate --help"));
  }
}

function hasUnsafeOutPathCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value) || value.includes("\\");
}

function isAbsoluteOutPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
}

function resolveSafeOutPath(outPath: string): string | null {
  if (!isNonEmptyArg(outPath) || hasUnsafeOutPathCharacters(outPath)) {
    return null;
  }

  const pathWithoutRoot = outPath.replace(/^[A-Za-z]:/u, "").replace(/^\/+/, "");
  const segments = pathWithoutRoot.split(/[\\/]+/u).filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.some((segment) => segment === ".." || segment === ".")) {
    return null;
  }

  if (isAbsoluteOutPath(outPath)) {
    return outPath;
  }

  const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd?.() ?? ".";
  return `${cwd.replace(/\/+$/u, "")}/${outPath}`;
}

interface NodeFsLike {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean };
  writeFileSync(path: string, content: string, options: { encoding: "utf8"; flag: "wx" }): void;
}

async function loadNodeFs(): Promise<NodeFsLike> {
  const nodeFsSpecifier = "node:fs";
  return await import(
    /* @vite-ignore */ nodeFsSpecifier
  ) as NodeFsLike;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await loadNodeFs()).existsSync(path);
  } catch {
    return false;
  }
}

async function isDirectoryPath(path: string): Promise<boolean> {
  try {
    return (await loadNodeFs()).statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function writeTextFileExclusive(path: string, content: string): Promise<"written" | "exists" | "failed"> {
  try {
    const fsModule = await loadNodeFs();
    fsModule.writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    return "written";
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
    return code === "EEXIST" ? "exists" : "failed";
  }
}

async function removeFileBestEffort(path: string): Promise<void> {
  try {
    const nodeFsPromisesSpecifier = "node:fs/promises";
    const fs = await import(
      /* @vite-ignore */ nodeFsPromisesSpecifier
    ) as { unlink(path: string): Promise<void> };
    await fs.unlink(path);
  } catch {
    // Best-effort rollback only. The caller still returns a failure.
  }
}

function selectProfile(config: WatsConfig, profileName: string | undefined): WatsProfileConfig | null {
  const selectedName = profileName ?? config.defaultProfile;
  if (!isNonEmptyArg(selectedName)) {
    return null;
  }
  return config.profiles[selectedName] ?? null;
}

async function openApiCommand(args: readonly string[]): Promise<CliCommandResult> {
  const parsed = parseOpenApiArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(OPENAPI_HELP);
    return fail("Missing or invalid OpenAPI arguments. Run `wats openapi --help` for usage.\n");
  }

  try {
    const config = await loadConfig(parsed.configPath);
    const profile = selectProfile(config, parsed.profileName);
    if (profile === null) {
      return fail("Invalid profile selection. Run `wats openapi --help` for usage.\n");
    }

    const doc = createWatsServiceOpenApiDocument(profile, parsed.serverUrl === undefined ? undefined : { serverUrl: parsed.serverUrl });
    const json = `${JSON.stringify(doc, null, 2)}\n`;

    if (parsed.outPath === undefined) {
      return ok(json);
    }

    const safeOutPath = resolveSafeOutPath(parsed.outPath);
    if (safeOutPath === null) {
      return fail("Invalid output path. Run `wats openapi --help` for usage.\n");
    }
    if (await isDirectoryPath(safeOutPath)) {
      return fail("Invalid output path. Run `wats openapi --help` for usage.\n");
    }
    if (await fileExists(safeOutPath)) {
      return fail("Output target exists; refusing to overwrite. Run `wats openapi --help` for usage.\n");
    }

    const writeResult = await writeTextFileExclusive(safeOutPath, json);
    if (writeResult === "exists") {
      return fail("Output target exists; refusing to overwrite. Run `wats openapi --help` for usage.\n");
    }
    if (writeResult !== "written") {
      return fail("Invalid output path. Run `wats openapi --help` for usage.\n");
    }
    return ok("OpenAPI JSON written.\n");
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return fail(formatConfigValidationError(error, "wats openapi --help"));
    }
    if (error instanceof WatsServiceError) {
      return fail(formatWatsServiceError(error, "wats openapi --help"));
    }
    return fail(safeGenericError("wats openapi --help"));
  }
}

async function runWebhookCommand(args: readonly string[]): Promise<CliCommandResult> {
  const [subcommand, ...rest] = args;

  if (subcommand === "token") {
    if (rest.length === 0) {
      const token = await createWebhookVerifyToken();
      return ok(`${token}\n`);
    }

    if (hasHelpFlag(rest)) {
      const unknownHelpSidecar = rest.find((arg) => arg.startsWith("-") && !ALLOWED_WEBHOOK_TOKEN_FLAGS.has(arg));
      if (unknownHelpSidecar !== undefined) {
        return fail("Unknown option. Run `wats webhook token --help` for usage.\n");
      }
      return ok(WEBHOOK_TOKEN_HELP);
    }

    if (rest.some((arg) => arg.startsWith("-"))) {
      return fail("Unknown option. Run `wats webhook token --help` for usage.\n");
    }

    return fail("Unexpected argument. Run `wats webhook token --help` for usage.\n");
  }

  if (subcommand === undefined || ROOT_HELP_FLAGS.has(subcommand)) {
    return ok(`Usage: wats webhook <command> [options]\n\nCommands:\n  wats webhook token [--help]   Print a local webhook verify token.\n\n${NO_LIVE_CREDENTIALS}\n`);
  }

  return fail("Unknown command. Run `wats --help` for usage.\n");
}

export async function runCli(argv: readonly string[] = []): Promise<CliCommandResult> {
  const args = argv.filter((arg) => arg.length > 0);
  const [command, ...rest] = args;

  if (command === undefined || ROOT_HELP_FLAGS.has(command)) {
    return ok(ROOT_HELP);
  }

  if (command.startsWith("-")) {
    return fail("Unknown option. Run `wats --help` for usage.\n");
  }

  switch (command) {
    case "init":
      return initCommand(rest);

    case "config": {
      const [subcommand, ...subRest] = rest;
      if (subcommand === "validate") {
        return validateConfigCommand(subRest);
      }
      if (subcommand === undefined || ROOT_HELP_FLAGS.has(subcommand)) {
        return ok(`Usage: wats config <command> [options]\n\nCommands:\n  wats config validate <path>   Validate a WATS config file safely.\n\n${NO_LIVE_CREDENTIALS}\n`);
      }
      return fail("Unknown command. Run `wats --help` for usage.\n");
    }

    case "doctor":
      if (rest.length === 0 || hasHelpFlag(rest)) {
        if (hasUnknownFlag(rest)) {
          return fail("Unknown option. Run `wats doctor --help` for usage.\n");
        }
        return ok(DOCTOR_HELP);
      }
      return fail("Unexpected argument. Run `wats doctor --help` for usage.\n");

    case "openapi":
      return openApiCommand(rest);

    case "serve":
      if (rest.length === 0 || hasHelpFlag(rest)) {
        if (hasUnknownFlag(rest)) {
          return fail("Unknown option. Run `wats serve --help` for usage.\n");
        }
        return ok(SERVE_HELP);
      }
      return fail("Unexpected argument. Run `wats serve --help` for usage.\n");

    case "webhook":
      return runWebhookCommand(rest);

    default:
      return fail(`Unknown command ${sanitizeCommandLabel(args)}. Run \`wats --help\` for usage.\n`);
  }
}
