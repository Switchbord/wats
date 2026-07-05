import { ConfigValidationError, loadConfig, parseConfig, redactConfig, type WatsConfig, type WatsProfileConfig } from "@wats/config";
import { createWatsServiceApp, createWatsServiceOpenApiDocument, WatsServiceError } from "@wats/service";
import { formatMessagesStatusSummaryLine } from "./status-renderer.js";

export type CliCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  shutdown?: () => void;
}>;

export type CliPromptRequest = Readonly<{
  label?: string;
  message?: string;
  defaultValue?: string;
  hint?: string;
  secret?: boolean;
  required?: boolean;
}>;

export type CliPromptProvider = (request: CliPromptRequest) => unknown | Promise<unknown>;

export type CliCommandContext = Readonly<{
  cwd?: string;
  prompt?: CliPromptProvider;
  spawn?: CliSpawnProvider;
  stdin?: Readonly<{ isTTY?: boolean }>;
}>;

export type CliSpawnResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type CliSpawnProvider = (command: string, args: readonly string[], options: Readonly<{ cwd: string }>) => CliSpawnResult | Promise<CliSpawnResult>;


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

type ServeMode = "dry-run" | "live";

type ServeArgs = Readonly<{
  ok: true;
  configPath: string;
  mode: ServeMode;
  profileName?: string;
  host?: string;
  port?: number;
  paas: boolean;
  printRoutes: boolean;
  envFile?: string;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage" | "live_missing";
}>;

type TransportResponseLike = Readonly<{
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}>;

type TransportLike = Readonly<{
  request(): Promise<TransportResponseLike>;
}>;

type BunServer = Readonly<{
  port: number;
  stop(closeActive?: boolean): void;
}>;

type BunLike = Readonly<{
  serve(options: { hostname: string; port: number; fetch(request: Request): Response | Promise<Response> }): BunServer;
}>;

type DoctorFormat = "text" | "json";

type DoctorArgs = Readonly<{
  ok: true;
  configPath: string;
  profileName?: string;
  checkEnv: boolean;
  format: DoctorFormat;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage" | "missing_config";
}>;

type UpgradeArgs = Readonly<{
  ok: true;
  dryRun: boolean;
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

type SetupArgs = Readonly<{
  ok: true;
  dir: string;
  profileName?: string;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage";
}>;

type SetupAnswerKey =
  | "profile"
  | "apiVersion"
  | "baseUrl"
  | "wabaId"
  | "phoneNumberId"
  | "accessToken"
  | "appSecret"
  | "verifyToken"
  | "serviceToken"
  | "webhookPath"
  | "serviceHost"
  | "servicePort"
  | "apiPrefix";

type SetupAnswers = Readonly<Record<SetupAnswerKey, string>>;

type OnboardingArgs = Readonly<{
  ok: true;
  publicUrl: string;
  webhookPath: string;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage";
}>;

// WATS-123: local wire types for the read-only /api/messages service API.
// These mirror @wats/persistence's MessageRecord/ListMessagesResult shapes
// without adding @wats/persistence as a CLI workspace dependency.
interface MessageRecordWire {
  readonly rowId: string;
  readonly waMessageId: string;
  readonly direction: "inbound" | "outbound";
  readonly fromPhone: string | null;
  readonly toPhone: string | null;
  readonly type: string;
  readonly status: string;
  readonly graphMessageId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface MessagesListResponseWire {
  readonly items: readonly MessageRecordWire[];
  readonly nextCursor: string | null;
}

interface ServiceErrorBody {
  readonly error: { readonly code: string; readonly message?: string };
}

type MessagesListArgs = Readonly<{
  ok: true;
  configPath: string;
  profileName?: string;
  envFilePath?: string;
  json: boolean;
  limit?: number;
  cursor?: string;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage";
}>;

type MessagesShowArgs = Readonly<{
  ok: true;
  configPath: string;
  profileName?: string;
  envFilePath?: string;
  json: boolean;
  messageId: string;
}> | Readonly<{
  ok: false;
  reason: "help" | "usage";
}>;

interface ServiceClientOptions {
  readonly baseUrl: string;
  readonly token: string;
}

type FetchServiceJsonResult =
  | Readonly<{ ok: true; status: number; body: unknown }>
  | Readonly<{ ok: false; kind: "http"; status: number; body: ServiceErrorBody }>
  | Readonly<{ ok: false; kind: "network"; message: string }>;

const NO_LIVE_CREDENTIALS = "No live credentials are read or required by this command.";

const ROOT_HELP = `WATS CLI

Usage: wats <command> [options]
       wats --version

Implemented commands:
  wats init [dir] [--dry-run]              Generate WATS config/env placeholders safely.
  wats setup [dir] [--profile <name>]       Run interactive credential setup wizard.
  wats onboarding --public-url <url>        Print webhook address and setup secrets checklist.
  wats config validate <path>              Validate a WATS config file safely.
  wats config validate --config <path>     Validate a WATS config file safely.
  wats doctor --help                       Show offline diagnostics help.
  wats upgrade [--dry-run]                 Update public @wats/* packages with Bun.
  wats update [--dry-run]                  Alias for wats upgrade.
  wats --version                           Print the installed @wats/cli version.
  wats openapi --config <path>             Print WATS service OpenAPI JSON.
  wats serve --config <path> --dry-run     Start the local dry-run service process.
  wats webhook token [--help]              Print a local webhook verify token.
  wats messages list/show [--config <path>] Inspect local messages via the service API.

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

const SETUP_HELP = `Usage: wats setup [dir] [--profile <name>]

Run an interactive credential setup wizard that writes wats.config.yaml and .env.local for local WATS development.

Options:
  --profile <name>       Preselect the generated default profile name.

The wizard stores raw values only in .env.local, writes env-secret references in wats.config.yaml, refuses to overwrite existing files, and rolls back the config if secret-file creation fails. Output is count/status only and does not print target paths, env variable names, profile names, or token values.
${NO_LIVE_CREDENTIALS}
`;

const CONFIG_VALIDATE_HELP = `Usage: wats config validate <path>
       wats config validate --config <path>

Validates a WATS config file (JSON/YAML) with @wats/config loadConfig/validate behavior.

Output on success is a safe count summary only: config valid, redacted default profile marker, and profile count. The command does not resolve env-secret values, read .env.local, call Meta Graph APIs, print profile names, or print raw secret env-var names.

Errors exit 1 and report ConfigValidationError code/path/message without stack traces or attacker-supplied path-like values. Unknown options fail closed.
${NO_LIVE_CREDENTIALS}
`;

const DOCTOR_HELP = `Usage: wats doctor --config <path> [--profile <name>] [--check-env] [--format text|json]

Run real offline diagnostics for a WATS project.

Checks: runtime compatibility, package imports, package version drift, config validation, selected profile, route collision safety, local OpenAPI generation, and optional env presence only when --check-env is passed.

The command does not resolve env-secret values, does not print env names or values, makes no Graph API calls, and does not write files.
${NO_LIVE_CREDENTIALS}
`;

const UPGRADE_HELP = `Usage: wats upgrade [--dry-run]
       wats update [--dry-run]

Update the public WATS package set in the current Bun project.

Runs bun update --latest for: @wats/cli, @wats/core, @wats/graph, @wats/http, @wats/config, and @wats/service. --dry-run prints the command without writing package.json or bun.lock.

The command does not read .env.local, does not call Meta Graph APIs, and does not print credential values.
`;

const OPENAPI_HELP = `Usage: wats openapi --config <path> [--profile <name>] [--server-url <http(s) URL>] [--out <path>]

Loads a WATS config file and exports OpenAPI 3.1 JSON for the WATS service API routes implemented by @wats/service.

Prints OpenAPI JSON to stdout by default. With --profile, selects a named config profile; otherwise the config default profile is used. With --server-url, passes the http(s) URL to the generator, which validates and canonicalizes it.

--out <path> writes JSON only when explicit and refuses to overwrite an existing target. Relative --out paths resolve under the current working directory. Directories, path traversal, NUL/control characters, and empty output paths are rejected.

The document is for the WATS service API only, not the Meta Graph API. The command does not resolve env-secret values, read .env.local, call Meta Graph APIs, or print config secret env-var names.
${NO_LIVE_CREDENTIALS}
`;

const SERVE_HELP = `Usage: wats serve --config <path> --dry-run [--profile <name>] [--host <host>] [--port <port>] [--paas] [--print-routes]
       wats serve --config <path> --live --yes-live --env-file <path> [--profile <name>] [--host <host>] [--port <port>] [--paas] [--print-routes]

Start the @wats/service Request -> Response app as a local Bun.serve process.

Modes:
  --dry-run             Use synthetic in-memory secrets and a no-network dry-run mock transport.
  --live                Resolve env-secret refs and use the default fetch-backed Graph transport.
  --yes-live            Acknowledge live Graph/API side effects.
  --env-file <path>     Explicit local env file for live mode, usually .env.local.

Options:
  --config <path>       WATS JSON/YAML config file.
  --profile <name>      Select a config profile; output redacts the selected profile name.
  --host <host>         Override profile.service.host for local binding.
  --port <port>         Override profile.service.port; must be 1..65535.
  --print-routes        Print the safe route inventory and exit without binding a port.
  --paas                PaaS deploy mode: bind 0.0.0.0 and read the platform-injected $PORT (Railway/Fly/Render/Cloud Run). Explicit --host/--port override these defaults; without --paas, $PORT is ignored.

Live mode requires --live, --yes-live, and --env-file together. The CLI does not read .env.local implicitly. Keep live tokens in the env file or process environment, never in command arguments. For local webhook testing, put a secure HTTPS tunnel such as ngrok in front of the chosen host/port; Meta will not verify plain HTTP or a bare local IP callback.

With --paas, the port comes from $PORT unless --port is given, and the host defaults to 0.0.0.0 unless --host is given; serve fails closed if --paas needs $PORT but it is missing or not 1..65535. This removes the external container entrypoint shim for PaaS deploys.
`;

const WEBHOOK_TOKEN_HELP = `Usage: wats webhook token [--help]

Safely prints one freshly generated verify token for local webhook setup.

Current implementation: generates a local random token and writes it to stdout only. It does not write files, update .env.local, call Graph APIs, or read live credentials.
${NO_LIVE_CREDENTIALS}
`;

const MESSAGES_LIVE_CREDENTIALS_NOTE = "Reads WATS_SERVICE_TOKEN from the environment and calls the local service. The token is never printed.";

const MESSAGES_HELP = `Usage: wats messages <command> [options]

Inspect local messages via the service API. These commands call a running local
'wats serve' process over HTTP and require the service bearer token.

Commands:
  wats messages list [options]    List recent messages (newest first).
  wats messages show <message-id> Show a single message record.

Common options:
  --config <path>     WATS JSON/YAML config file (required).
  --profile <name>    Select a config profile (default: config defaultProfile).
  --env-file <path>   Local env file providing WATS_SERVICE_TOKEN (e.g. .env.local).
  --help, -h          Show this help.

${MESSAGES_LIVE_CREDENTIALS_NOTE}
`;

const MESSAGES_LIST_HELP = `Usage: wats messages list [--config <path>] [--profile <name>] [--env-file <path>] [--limit N] [--cursor <rowId>] [--json]

Lists recent messages from the local service /api/messages endpoint, newest first.

Options:
  --config <path>     WATS JSON/YAML config file (required).
  --profile <name>    Select a config profile (default: config defaultProfile).
  --env-file <path>   Local env file providing WATS_SERVICE_TOKEN (e.g. .env.local).
  --limit N           Integer page size (1..100); the service enforces the range.
  --cursor <rowId>    Opaque cursor (last item's rowId) for manual pagination.
  --json              Print the raw service JSON response to stdout.
  --help, -h          Show this help.

In text mode stdout is a TSV with a header row; the next-page cursor is printed
to stderr as 'nextCursor: <rowId>' (or 'nextCursor: (none)') so stdout stays a
clean TSV. With --json the full response object (including nextCursor) is printed
to stdout.

${MESSAGES_LIVE_CREDENTIALS_NOTE}
`;

const MESSAGES_SHOW_HELP = `Usage: wats messages show <message-id> [--config <path>] [--profile <name>] [--env-file <path>] [--json]

Shows a single message record from the local service /api/messages/{id} endpoint.

Arguments:
  <message-id>        WhatsApp message id (waMessageId, e.g. wamid.*).

Options:
  --config <path>     WATS JSON/YAML config file (required).
  --profile <name>    Select a config profile (default: config defaultProfile).
  --env-file <path>   Local env file providing WATS_SERVICE_TOKEN (e.g. .env.local).
  --json              Print the raw service JSON record to stdout.
  --help, -h          Show this help.

In text mode stdout is one 'key: value' line per field (nulls printed as 'null').
With --json the full record object is printed to stdout.

${MESSAGES_LIVE_CREDENTIALS_NOTE}
`;


const ONBOARDING_HELP = `Usage: wats onboarding --public-url <https URL> [--webhook-path /webhooks/whatsapp]

Prints the webhook callback address to paste into Meta App Dashboard and a credential checklist for user-side setup.

Options:
  --public-url <https URL>       Public HTTPS base URL for this WATS service/tunnel.
  --webhook-path <absolute path> Webhook path from wats.config.yaml (default: /webhooks/whatsapp).

Output includes:
  - webhook callback address
  - locally generated WATS_VERIFY_TOKEN and WATS_SERVICE_TOKEN values
  - user-side credentials to copy from Meta/WhatsApp: WATS_ACCESS_TOKEN, WATS_APP_SECRET, WATS_WABA_ID, WATS_PHONE_NUMBER_ID

Use the webhook callback address and WATS_VERIFY_TOKEN in Meta App Dashboard > WhatsApp > Configuration. Keep WATS_APP_SECRET and WATS_ACCESS_TOKEN in a local .env file or secret manager, never in git.
${NO_LIVE_CREDENTIALS}
`;


const INIT_DEFAULT_PROFILE = "local" as const;
const INIT_DEFAULT_FORMAT: InitFormat = "yaml";
const INIT_VALUE_FLAGS = ["--format", "--profile"] as const;
const SETUP_VALUE_FLAGS = ["--profile"] as const;
const SETUP_DEFAULT_PROFILE = "local" as const;
const SETUP_DEFAULT_API_VERSION = "v25.0" as const;
const SETUP_DEFAULT_BASE_URL = "https://graph.facebook.com" as const;
const SETUP_DEFAULT_WEBHOOK_PATH = "/webhooks/whatsapp" as const;
const SETUP_DEFAULT_SERVICE_HOST = "127.0.0.1" as const;
const SETUP_DEFAULT_SERVICE_PORT = "8787" as const;
const SETUP_DEFAULT_API_PREFIX = "/api" as const;
const SETUP_SECRET_MAX_LENGTH = 4096;
const SETUP_PROFILE_MAX_LENGTH = 32;
const ONBOARDING_DEFAULT_WEBHOOK_PATH = "/webhooks/whatsapp" as const;
const ONBOARDING_VALUE_FLAGS = ["--public-url", "--webhook-path"] as const;
const DOCTOR_VALUE_FLAGS = ["--config", "--profile", "--format"] as const;
const DOCTOR_ALLOWED_FLAGS = ["--config", "--profile", "--format", "--check-env"] as const;
const UPGRADE_ALLOWED_FLAGS = ["--dry-run"] as const;
const PUBLIC_WATS_UPGRADE_PACKAGES = ["@wats/cli", "@wats/core", "@wats/graph", "@wats/http", "@wats/config", "@wats/service"] as const;
const SERVE_VALUE_FLAGS = ["--config", "--profile", "--host", "--port", "--env-file"] as const;
const SERVE_ALLOWED_FLAGS = ["--config", "--profile", "--host", "--port", "--dry-run", "--print-routes", "--live", "--yes-live", "--env-file", "--paas"] as const;
const MESSAGES_LIST_VALUE_FLAGS = ["--config", "--profile", "--env-file", "--limit", "--cursor"] as const;
const MESSAGES_LIST_ALLOWED_FLAGS = ["--config", "--profile", "--env-file", "--limit", "--cursor", "--json", "--help", "-h"] as const;
const MESSAGES_SHOW_VALUE_FLAGS = ["--config", "--profile", "--env-file"] as const;
const MESSAGES_SHOW_ALLOWED_FLAGS = ["--config", "--profile", "--env-file", "--json", "--help", "-h"] as const;
const LIVE_MISSING_ERROR = "Live serve requires --live --yes-live and --env-file. Run `wats serve --help` for usage.\n";
const ENV_FILE_MAX_BYTES = 65_536;
const ENV_FILE_ALLOWED_KEYS = new Set([
  "WATS_ACCESS_TOKEN",
  "WATS_VERIFY_TOKEN",
  "WATS_APP_SECRET",
  "WATS_SERVICE_TOKEN",
  "WATS_WABA_ID",
  "WATS_PHONE_NUMBER_ID",
  "WATS_LIVE_ENABLE",
  "WATS_YES_LIVE"
]);
const SERVE_RESERVED_ROUTES = ["/healthz", "/readyz", "/openapi.json"] as const;
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
const DRY_RUN_PLACEHOLDERS = Object.freeze({
  access: "dry-run-access-placeholder",
  verify: "dry-run-verify-placeholder",
  app: "dry-run-app-placeholder",
  service: "dry-run-service-placeholder"
});

function ok(stdout: string): CliCommandResult {
  return Object.freeze({ exitCode: 0, stdout, stderr: "" });
}

function fail(stderr: string): CliCommandResult {
  return Object.freeze({ exitCode: 1, stdout: "", stderr });
}

function cliUsageError(hint: string): CliCommandResult {
  return fail(`CliUsageError\nInvalid arguments. Run \`${hint}\` for usage.\n`);
}

function promptInputError(hint: string): CliCommandResult {
  return fail(`PromptInputError\nInvalid prompt input. Run \`${hint}\` for usage.\n`);
}

function setupInputError(hint: string): CliCommandResult {
  return fail(`SetupInputError\nInvalid setup input. Run \`${hint}\` for usage.\n`);
}

function setupNonInteractiveError(hint: string): CliCommandResult {
  return fail(
    "SetupNonInteractiveError\n" +
    "`wats setup` is interactive and needs a terminal (TTY stdin). " +
    "For non-interactive scaffolding run `wats init <dir>`, copy `.env.example` to `.env.local`, and fill in real values. " +
    `Run \`${hint}\` for usage.\n`
  );
}

function outputError(message: string, hint: string): CliCommandResult {
  return fail(`OutputError\n${message}. Run \`${hint}\` for usage.\n`);
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

async function createPrefixedToken(prefix: string): Promise<string> {
  const cryptoProvider = getCrypto();

  if (cryptoProvider !== undefined && typeof cryptoProvider.getRandomValues === "function") {
    const bytes = new Uint8Array(TOKEN_RANDOM_BYTE_LENGTH);
    cryptoProvider.getRandomValues(bytes);
    return `${prefix}${base64Url(bytes)}`;
  }

  if (cryptoProvider !== undefined && typeof cryptoProvider.randomUUID === "function") {
    return `${prefix}${cryptoProvider.randomUUID().replaceAll("-", "")}`;
  }

  throw new Error("No secure random token generator available in this runtime");
}

export async function createWebhookVerifyToken(): Promise<string> {
  return createPrefixedToken("wats_wh_");
}

export async function createServiceBearerToken(): Promise<string> {
  return createPrefixedToken("wats_srv_");
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

function hasFlagName(args: readonly string[], name: string): boolean {
  return args.some((arg) => {
    if (!arg.startsWith("-")) return false;
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    return flagName === name;
  });
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

function isSafeServeHost(value: string): boolean {
  if (!isNonEmptyArg(value) || value.length > 253) return false;
  if (/token|secret|password|\.\.|[\\/?#@]/iu.test(value)) return false;
  if (value.startsWith("-") || value.includes(":")) return false;
  if (value === "localhost") return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)) {
    return value.split(".").every((segment) => {
      if (!/^\d{1,3}$/u.test(segment)) return false;
      const parsed = Number.parseInt(segment, 10);
      return parsed >= 0 && parsed <= 255 && String(parsed) === segment;
    });
  }
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u.test(value);
}

function parseServePortValue(value: string): number | null {
  if (!/^\d{1,5}$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

function isSafeServeEnvFile(value: string): boolean {
  if (!isNonEmptyArg(value) || value.length > 128) return false;
  if (value.startsWith("/") || value.startsWith("-") || value.includes("\\") || value.includes("?") || value.includes("#")) return false;
  if (/token|secret|password/iu.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  const leaf = segments[segments.length - 1] ?? "";
  return leaf === ".env.local" || /^[A-Za-z0-9._-]+\.env$/u.test(leaf);
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
    graph: Object.freeze({ apiVersion: "v25.0", baseUrl: "https://graph.facebook.com" }),
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


function resolveSetupTargetDir(value: string, cwd: string | undefined): string | null {
  if (hasUnsafeTargetPath(value)) return null;
  if (value === ".") return cwd ?? (globalThis as { process?: { cwd(): string } }).process?.cwd?.() ?? ".";
  if (value.startsWith("/")) return value;
  const base = cwd ?? (globalThis as { process?: { cwd(): string } }).process?.cwd?.() ?? ".";
  const relativePath = value.startsWith("./") ? value.slice(2) : value;
  return `${base.replace(/\/+$/u, "")}/${relativePath}`;
}

function parseSetupArgs(args: readonly string[], cwd?: string): SetupArgs {
  let profileName: string | undefined;
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
    if (!SETUP_VALUE_FLAGS.includes(flagName as typeof SETUP_VALUE_FLAGS[number])) return { ok: false, reason: "usage" };
    if (profileSeen) return { ok: false, reason: "usage" };
    const value = equalsIndex === -1 ? args[index + 1] : arg.slice(equalsIndex + 1);
    if (equalsIndex === -1) index += 1;
    if (!isNonEmptyArg(value) || !isSafeProfileName(value)) return { ok: false, reason: "usage" };
    profileName = value;
    profileSeen = true;
  }

  if (positionals.length > 1) return { ok: false, reason: "usage" };
  const targetDir = resolveSetupTargetDir(positionals[0] ?? ".", cwd);
  if (targetDir === null) return { ok: false, reason: "usage" };
  return { ok: true, dir: targetDir, ...(profileName !== undefined ? { profileName } : {}) };
}

function isSafeNumericIdentifier(value: string): boolean {
  return /^\d{1,32}$/u.test(value);
}

function isSafeSetupSecret(value: string): boolean {
  return value.length > 0 && value.trim().length > 0 && value.length <= SETUP_SECRET_MAX_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value);
}

function setupAnswerOrDefault(value: string, fallback: string): string {
  return value.length === 0 ? fallback : value;
}

function parseSetupPort(value: string): number | null {
  const raw = setupAnswerOrDefault(value, SETUP_DEFAULT_SERVICE_PORT);
  if (!/^\d{1,5}$/u.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

function setupConfigObject(answers: SetupAnswers): WatsConfig {
  const profile = Object.freeze({
    graph: Object.freeze({ apiVersion: answers.apiVersion, baseUrl: answers.baseUrl }),
    whatsapp: Object.freeze({ wabaId: answers.wabaId, phoneNumberId: answers.phoneNumberId }),
    auth: Object.freeze({ accessToken: Object.freeze({ env: "WATS_ACCESS_TOKEN" }) }),
    webhook: Object.freeze({
      path: answers.webhookPath,
      verifyToken: Object.freeze({ env: "WATS_VERIFY_TOKEN" }),
      appSecret: Object.freeze({ env: "WATS_APP_SECRET" }),
      maxBodyBytes: 1_048_576
    }),
    service: Object.freeze({
      host: answers.serviceHost,
      port: Number.parseInt(answers.servicePort, 10),
      apiPrefix: answers.apiPrefix,
      bearerToken: Object.freeze({ env: "WATS_SERVICE_TOKEN" })
    })
  }) satisfies WatsProfileConfig;
  return Object.freeze({ version: 1, defaultProfile: answers.profile, profiles: Object.freeze({ [answers.profile]: profile }) }) as WatsConfig;
}

function formatSetupEnv(answers: SetupAnswers): string {
  return [
    "# WATS local credentials generated by `wats setup`.",
    "# Do not commit this file.",
    `WATS_ACCESS_TOKEN=${answers.accessToken}`,
    `WATS_WABA_ID=${answers.wabaId}`,
    `WATS_PHONE_NUMBER_ID=${answers.phoneNumberId}`,
    `WATS_VERIFY_TOKEN=${answers.verifyToken}`,
    `WATS_APP_SECRET=${answers.appSecret}`,
    `WATS_SERVICE_TOKEN=${answers.serviceToken}`,
    "WATS_LIVE_ENABLE=0",
    "WATS_YES_LIVE=0",
    ""
  ].join("\n");
}

async function readSetupAnswer(prompt: CliPromptProvider | undefined, request: CliPromptRequest): Promise<string | null> {
  if (prompt === undefined) return null;
  let raw: unknown;
  try {
    raw = await prompt(request);
  } catch {
    return null;
  }
  return typeof raw === "string" ? raw : null;
}

async function collectSetupAnswers(parsed: SetupArgs & { ok: true }, prompt: CliPromptProvider | undefined): Promise<SetupAnswers | "prompt_error" | "input_error" | ConfigValidationError> {
  const profileRaw = parsed.profileName ?? await readSetupAnswer(prompt, { label: "Profile name", defaultValue: SETUP_DEFAULT_PROFILE, required: true });
  const apiVersionRaw = await readSetupAnswer(prompt, { label: "Graph API version", defaultValue: SETUP_DEFAULT_API_VERSION, required: false });
  const baseUrlRaw = await readSetupAnswer(prompt, { label: "Graph base URL", defaultValue: SETUP_DEFAULT_BASE_URL, required: false });
  const wabaIdRaw = await readSetupAnswer(prompt, { label: "WABA ID", required: true });
  const phoneNumberIdRaw = await readSetupAnswer(prompt, { label: "Phone number ID", required: true });
  const accessTokenRaw = await readSetupAnswer(prompt, {
    label: "Meta access token",
    hint: "Input hidden. Paste the token, then press Enter.",
    secret: true,
    required: true
  });
  const appSecretRaw = await readSetupAnswer(prompt, {
    label: "Meta app secret",
    hint: "Input hidden. Paste the app secret, then press Enter.",
    secret: true,
    required: true
  });
  const verifyTokenRaw = await readSetupAnswer(prompt, {
    label: "Webhook verify token",
    hint: "Optional; input hidden. Leave blank to generate a local token.",
    secret: true,
    required: false
  });
  const serviceTokenRaw = await readSetupAnswer(prompt, {
    label: "WATS service bearer token",
    hint: "Optional; input hidden. Leave blank to generate a local bearer token.",
    secret: true,
    required: false
  });
  const webhookPathRaw = await readSetupAnswer(prompt, { label: "Webhook path", defaultValue: SETUP_DEFAULT_WEBHOOK_PATH, required: false });
  const serviceHostRaw = await readSetupAnswer(prompt, { label: "Service host", defaultValue: SETUP_DEFAULT_SERVICE_HOST, required: false });
  const servicePortRaw = await readSetupAnswer(prompt, { label: "Service port", defaultValue: SETUP_DEFAULT_SERVICE_PORT, required: false });
  const apiPrefixRaw = await readSetupAnswer(prompt, { label: "Service API prefix", defaultValue: SETUP_DEFAULT_API_PREFIX, required: false });

  const rawAnswers = [profileRaw, apiVersionRaw, baseUrlRaw, wabaIdRaw, phoneNumberIdRaw, accessTokenRaw, appSecretRaw, verifyTokenRaw, serviceTokenRaw, webhookPathRaw, serviceHostRaw, servicePortRaw, apiPrefixRaw];
  if (rawAnswers.some((value) => value === null)) return "prompt_error";

  const profile = setupAnswerOrDefault(profileRaw as string, SETUP_DEFAULT_PROFILE);
  const apiVersion = setupAnswerOrDefault(apiVersionRaw as string, SETUP_DEFAULT_API_VERSION);
  const baseUrl = setupAnswerOrDefault(baseUrlRaw as string, SETUP_DEFAULT_BASE_URL);
  const wabaId = wabaIdRaw as string;
  const phoneNumberId = phoneNumberIdRaw as string;
  const accessToken = accessTokenRaw as string;
  const appSecret = appSecretRaw as string;
  const webhookPath = setupAnswerOrDefault(webhookPathRaw as string, SETUP_DEFAULT_WEBHOOK_PATH);
  const serviceHost = setupAnswerOrDefault(serviceHostRaw as string, SETUP_DEFAULT_SERVICE_HOST);
  const servicePortNumber = parseSetupPort(servicePortRaw as string);
  const apiPrefix = setupAnswerOrDefault(apiPrefixRaw as string, SETUP_DEFAULT_API_PREFIX);

  if (!isSafeProfileName(profile) || profile.length > SETUP_PROFILE_MAX_LENGTH) return "input_error";
  if (!isSafeNumericIdentifier(wabaId) || !isSafeNumericIdentifier(phoneNumberId)) return "input_error";
  if (!isSafeSetupSecret(accessToken) || !isSafeSetupSecret(appSecret)) return "input_error";
  const verifyToken = (verifyTokenRaw as string).length === 0 ? await createWebhookVerifyToken() : verifyTokenRaw as string;
  const serviceToken = (serviceTokenRaw as string).length === 0 ? await createServiceBearerToken() : serviceTokenRaw as string;
  if (!isSafeSetupSecret(verifyToken) || !isSafeSetupSecret(serviceToken)) return "input_error";
  if (!isSafeWebhookPath(webhookPath) || !isSafeServeHost(serviceHost) || servicePortNumber === null || !isSafeWebhookPath(apiPrefix)) return "input_error";

  const answers: SetupAnswers = Object.freeze({
    profile,
    apiVersion,
    baseUrl,
    wabaId,
    phoneNumberId,
    accessToken,
    appSecret,
    verifyToken,
    serviceToken,
    webhookPath,
    serviceHost,
    servicePort: String(servicePortNumber),
    apiPrefix
  });
  try {
    parseConfig(formatInitJson(setupConfigObject(answers)), { format: "json" });
  } catch (error) {
    return error instanceof ConfigValidationError ? error : "input_error";
  }
  return answers;
}

async function setupCommand(args: readonly string[], context: CliCommandContext = {}): Promise<CliCommandResult> {
  const parsed = parseSetupArgs(args, context.cwd);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(SETUP_HELP);
    return cliUsageError("wats setup --help");
  }

  // `wats setup` is an interactive wizard. When stdin is present but not a TTY
  // (piped, redirected, or empty in CI) fail fast BEFORE printing any prompt:
  // the buffered prompt would echo every prompt onto one line and then fail
  // with an opaque SetupInputError. Point users at the non-interactive path.
  if (context.stdin !== undefined && context.stdin.isTTY !== true) {
    return setupNonInteractiveError("wats setup --help");
  }

  const answers = await collectSetupAnswers(parsed, context.prompt);
  if (answers === "prompt_error") return promptInputError("wats setup --help");
  if (answers === "input_error") return setupInputError("wats setup --help");
  if (answers instanceof ConfigValidationError) return fail(formatConfigValidationError(answers, "wats setup --help"));

  const configText = formatInitYaml(parseConfig(formatInitJson(setupConfigObject(answers)), { format: "json" }));
  const envText = formatSetupEnv(answers);
  const configPath = `${parsed.dir.replace(/\/+$/u, "")}/wats.config.yaml`;
  const envPath = `${parsed.dir.replace(/\/+$/u, "")}/.env.local`;

  if (!await ensureDir(parsed.dir)) return outputError("invalid output directory", "wats setup --help");
  if (await fileExists(configPath) || await fileExists(envPath)) return outputError("refusing to overwrite", "wats setup --help");
  const configWrite = await writeTextFileExclusive(configPath, configText);
  if (configWrite !== "written") return outputError("refusing to overwrite", "wats setup --help");
  const envWrite = await writeTextFileExclusive(envPath, envText);
  if (envWrite !== "written") {
    await removeFileBestEffort(configPath);
    return outputError(envWrite === "exists" ? "refusing to overwrite" : "could not write local secrets", "wats setup --help");
  }

  return ok(["setup complete", "files: 2", "profile: [REDACTED_PROFILE]", NO_LIVE_CREDENTIALS].join("\n") + "\n");
}


function hasRawUrlWhitespace(value: string): boolean {
  return /[\s\x00-\x1f\x7f]/u.test(value);
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function repeatedlyDecode(value: string): string | null {
  let current = value;
  for (let index = 0; index < 5; index += 1) {
    const decoded = safeDecodeURIComponent(current);
    if (decoded === null) return null;
    if (decoded === current) return current;
    current = decoded;
  }
  const finalDecoded = safeDecodeURIComponent(current);
  return finalDecoded === current ? current : null;
}

function isSafeWebhookPath(value: string): boolean {
  if (!value.startsWith("/") || hasRawUrlWhitespace(value) || value.includes("\\") || value.includes("?") || value.includes("#")) return false;
  if (value.length > 256 || value.includes("//")) return false;
  const decoded = repeatedlyDecode(value);
  if (decoded === null || (decoded !== value && /[\/?#]/u.test(decoded))) return false;
  const decodedSegments = decoded.split("/").filter((segment) => segment.length > 0);
  if (decodedSegments.length === 0) return false;
  return decodedSegments.every((segment) => segment !== "." && segment !== ".." && !/[\x00-\x1f\x7f]/u.test(segment));
}

function rawUrlPath(value: string): string | null {
  const schemeMatch = /^https:\/\/[^/?#]*/iu.exec(value);
  if (schemeMatch === null) return null;
  const afterAuthority = value.slice(schemeMatch[0].length);
  if (afterAuthority.length === 0) return "/";
  if (!afterAuthority.startsWith("/")) return null;
  const endIndex = afterAuthority.search(/[?#]/u);
  return endIndex === -1 ? afterAuthority : afterAuthority.slice(0, endIndex);
}

function pathContainsTraversal(value: string): boolean {
  const segments = value.split("/").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    let current = segment;
    for (let index = 0; index < 5; index += 1) {
      const decoded = safeDecodeURIComponent(current);
      if (decoded === null) return true;
      current = decoded;
      if (current === "." || current === "..") return true;
      if (/[\\/?#\u0000-\u001f\u007f]/u.test(current)) return true;
      if (decoded === segment || (decoded === current && safeDecodeURIComponent(current) === current)) break;
    }
  }
  return false;
}

function canonicalPublicUrl(value: string, webhookPath: string): string | null {
  if (!isNonEmptyArg(value) || hasRawUrlWhitespace(value)) return null;
  const rawPath = rawUrlPath(value);
  if (rawPath === null || pathContainsTraversal(rawPath)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return null;
  const baseSegments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  for (const segment of baseSegments) {
    const decoded = repeatedlyDecode(segment);
    if (decoded === null || decoded === "." || decoded === ".." || /[\\/?#\u0000-\u001f\u007f]/u.test(decoded)) return null;
  }
  const basePath = parsed.pathname.replace(/\/+$/u, "");
  parsed.pathname = `${basePath}${webhookPath}`.replace(/\/+/gu, "/");
  return parsed.toString();
}

function parseOnboardingArgs(args: readonly string[]): OnboardingArgs {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) return { ok: false, reason: "usage" };
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!ONBOARDING_VALUE_FLAGS.includes(flagName as typeof ONBOARDING_VALUE_FLAGS[number]) && !ROOT_HELP_FLAGS.has(flagName)) {
      return { ok: false, reason: "usage" };
    }
    if (ONBOARDING_VALUE_FLAGS.includes(flagName as typeof ONBOARDING_VALUE_FLAGS[number]) && !arg.includes("=")) {
      index += 1;
    }
  }

  if (hasHelpFlag(args)) {
    const unknownHelpSidecar = args.find((arg) => arg.startsWith("-") && !ROOT_HELP_FLAGS.has(arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg));
    return unknownHelpSidecar === undefined ? { ok: false, reason: "help" } : { ok: false, reason: "usage" };
  }

  const publicUrlFlag = parseFlagValue(args, ["--public-url"], ONBOARDING_VALUE_FLAGS);
  const webhookPathFlag = parseFlagValue(args, ["--webhook-path"], ONBOARDING_VALUE_FLAGS);
  if (!publicUrlFlag.ok || !webhookPathFlag.ok || !publicUrlFlag.present || publicUrlFlag.value === undefined) {
    return { ok: false, reason: "usage" };
  }
  const positionals = nonFlagArgs(args, ONBOARDING_VALUE_FLAGS);
  if (positionals === null || positionals.some((arg) => arg.trim().length > 0)) {
    return { ok: false, reason: "usage" };
  }

  const webhookPath = webhookPathFlag.value ?? ONBOARDING_DEFAULT_WEBHOOK_PATH;
  if (!isSafeWebhookPath(webhookPath)) {
    return { ok: false, reason: "usage" };
  }

  const publicUrl = canonicalPublicUrl(publicUrlFlag.value, webhookPath);
  if (publicUrl === null) {
    return { ok: false, reason: "usage" };
  }

  return { ok: true, publicUrl, webhookPath };
}

function onboardingOutput(callbackUrl: string, verifyToken: string, serviceToken: string): string {
  return `onboarding checklist
webhook callback address: ${callbackUrl}

Paste into Meta App Dashboard > WhatsApp > Configuration:
callback URL: ${callbackUrl}
verify token: use WATS_VERIFY_TOKEN from below

Generated locally by WATS:
WATS_VERIFY_TOKEN=${verifyToken}
WATS_SERVICE_TOKEN=${serviceToken}

Generate or copy from Meta/user side:
WATS_ACCESS_TOKEN=<copy from Meta system user/app token>
WATS_APP_SECRET=<copy from Meta App Dashboard>
WATS_WABA_ID=<copy from WhatsApp Manager>
WATS_PHONE_NUMBER_ID=<copy from WhatsApp Manager>

Store these in .env.local or a secret manager; do not commit raw values.
${NO_LIVE_CREDENTIALS}
`;
}

async function onboardingCommand(args: readonly string[]): Promise<CliCommandResult> {
  const parsed = parseOnboardingArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(ONBOARDING_HELP);
    return fail("Invalid onboarding arguments. Run `wats onboarding --help` for usage.\n");
  }

  const verifyToken = await createWebhookVerifyToken();
  const serviceToken = await createServiceBearerToken();
  return ok(onboardingOutput(parsed.publicUrl, verifyToken, serviceToken));
}

function parseServeArgs(args: readonly string[]): ServeArgs {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.trim().length === 0) return { ok: false, reason: "usage" };
    if (!arg.startsWith("-")) return { ok: false, reason: "usage" };
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (ROOT_HELP_FLAGS.has(flagName)) {
      const unknownHelpSidecar = args.find((sidecar) => {
        if (!sidecar.startsWith("-")) return false;
        const sidecarName = sidecar.includes("=") ? sidecar.slice(0, sidecar.indexOf("=")) : sidecar;
        return !ROOT_HELP_FLAGS.has(sidecarName);
      });
      return unknownHelpSidecar === undefined ? { ok: false, reason: "help" } : { ok: false, reason: "usage" };
    }
    if (!SERVE_ALLOWED_FLAGS.includes(flagName as typeof SERVE_ALLOWED_FLAGS[number])) return { ok: false, reason: "usage" };
    if (flagName === "--dry-run" || flagName === "--print-routes" || flagName === "--live" || flagName === "--yes-live" || flagName === "--paas") {
      if (arg.includes("=") || hasFlagName(args.slice(index + 1), flagName)) return { ok: false, reason: "usage" };
      continue;
    }
    if (flagName === "--env-file") {
      if (arg.includes("=") || hasFlagName(args.slice(index + 1), flagName)) return { ok: false, reason: "usage" };
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) return { ok: false, reason: "live_missing" };
      index += 1;
      continue;
    }
    if (!arg.includes("=")) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) return { ok: false, reason: "usage" };
      index += 1;
    }
  }

  const valueArgs = args.filter((arg) => {
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    return flagName !== "--dry-run" && flagName !== "--print-routes" && flagName !== "--live" && flagName !== "--yes-live" && flagName !== "--paas";
  });
  const dryRun = hasFlagName(args, "--dry-run");
  const liveIntent = hasFlagName(args, "--live");
  const liveAcknowledgement = hasFlagName(args, "--yes-live");
  const envFileFlag = parseFlagValue(valueArgs, ["--env-file"], SERVE_VALUE_FLAGS);
  if (!envFileFlag.ok) return { ok: envFileFlag.reason === "missing" ? false : false, reason: envFileFlag.reason === "missing" ? "live_missing" : "usage" };
  const liveTouched = liveIntent || liveAcknowledgement || envFileFlag.present;
  if (dryRun && liveTouched) return { ok: false, reason: "live_missing" };
  if (!dryRun && !liveTouched) return { ok: false, reason: "usage" };
  if (liveTouched && (!liveIntent || !liveAcknowledgement || !envFileFlag.present || envFileFlag.value === undefined)) return { ok: false, reason: "live_missing" };

  const configFlag = parseFlagValue(valueArgs, ["--config"], SERVE_VALUE_FLAGS);
  const profileFlag = parseFlagValue(valueArgs, ["--profile"], SERVE_VALUE_FLAGS);
  const hostFlag = parseFlagValue(valueArgs, ["--host"], SERVE_VALUE_FLAGS);
  const portFlag = parseFlagValue(valueArgs, ["--port"], SERVE_VALUE_FLAGS);
  if (!configFlag.ok || !profileFlag.ok || !hostFlag.ok || !portFlag.ok || !configFlag.present || configFlag.value === undefined) {
    return { ok: false, reason: "usage" };
  }
  const positionals = nonFlagArgs(valueArgs, SERVE_VALUE_FLAGS);
  if (positionals === null || positionals.some((arg) => arg.trim().length > 0)) return { ok: false, reason: "usage" };

  if (profileFlag.value !== undefined && !isSafeProfileName(profileFlag.value)) return { ok: false, reason: "usage" };
  if (hostFlag.value !== undefined && !isSafeServeHost(hostFlag.value)) return { ok: false, reason: "usage" };
  let port: number | undefined;
  if (portFlag.value !== undefined) {
    const parsedPort = parseServePortValue(portFlag.value);
    if (parsedPort === null) return { ok: false, reason: "usage" };
    port = parsedPort;
  }
  if (envFileFlag.value !== undefined && !isSafeServeEnvFile(envFileFlag.value)) return { ok: false, reason: "usage" };

  return {
    ok: true,
    configPath: configFlag.value,
    mode: dryRun ? "dry-run" : "live",
    paas: hasFlagName(args, "--paas"),
    printRoutes: hasFlagName(args, "--print-routes"),
    ...(envFileFlag.value !== undefined ? { envFile: envFileFlag.value } : {}),
    ...(profileFlag.value !== undefined ? { profileName: profileFlag.value } : {}),
    ...(hostFlag.value !== undefined ? { host: hostFlag.value } : {}),
    ...(port !== undefined ? { port } : {})
  };
}

function serveProfileWithOverrides(profile: WatsProfileConfig, parsed: ServeArgs & { ok: true }): WatsProfileConfig {
  return Object.freeze({
    ...profile,
    service: Object.freeze({
      ...profile.service,
      ...(parsed.host !== undefined ? { host: parsed.host } : {}),
      ...(parsed.port !== undefined ? { port: parsed.port } : {})
    })
  }) as WatsProfileConfig;
}

// WATS-129: native PaaS bind resolution. Only consulted when --paas is passed,
// so default/local behavior is byte-identical for forks that ignore PaaS deploy.
// When --paas is set and the port is not pinned by an explicit --port, read the
// platform-injected $PORT (PaaS platforms inject it); when the host is not pinned
// by an explicit --host, default the bind host to 0.0.0.0. Explicit --host/--port
// always win. Returns null when --paas needs $PORT but it is missing/invalid, so
// the caller fails closed instead of binding a wrong/loopback port.
function resolvePaasServeProfile(
  profile: WatsProfileConfig,
  parsed: ServeArgs & { ok: true },
  env: Record<string, string | undefined>
): WatsProfileConfig | null {
  if (!parsed.paas) return profile;
  const hostPinned = parsed.host !== undefined;
  const portPinned = parsed.port !== undefined;
  let port = profile.service.port;
  if (!portPinned) {
    const rawPort = env.PORT;
    if (typeof rawPort !== "string") return null;
    const parsedPort = parseServePortValue(rawPort);
    // Reject non-canonical forms (e.g. leading zeros like "08080") for byte-exact
    // $PORT discipline, mirroring isSafeServeHost's IP-octet canonicalization.
    if (parsedPort === null || String(parsedPort) !== rawPort) return null;
    port = parsedPort;
  }
  const host = hostPinned ? profile.service.host : "0.0.0.0";
  return Object.freeze({
    ...profile,
    service: Object.freeze({ ...profile.service, host, port })
  }) as WatsProfileConfig;
}

function serveRouteLines(profile: WatsProfileConfig): readonly string[] {
  return Object.freeze([
    "GET /healthz",
    "GET /readyz",
    "GET /openapi.json",
    `GET|POST ${profile.webhook.path}`,
    `POST ${profile.service.apiPrefix}/messages/text`,
    `POST ${profile.service.apiPrefix}/messages`
  ]);
}

function formatServeRoutes(profile: WatsProfileConfig, mode: ServeMode): string {
  return [`serve ${mode} routes`, ...serveRouteLines(profile)].join("\n") + "\n";
}

function formatServeReady(host: string, port: number, mode: ServeMode): string {
  return [
    `serve ${mode}`,
    "status: listening",
    `address: http://${host}:${port}`,
    `graph: ${mode === "dry-run" ? "dry-run mock transport" : "live fetch transport"}`,
    "profile: [REDACTED_PROFILE]",
    mode === "dry-run" ? "No live credentials are read or required by this command." : "live credentials: resolved from explicit env-file/process env"
  ].join("\n") + "\n";
}

function dryRunTransportResponse(body: unknown): TransportResponseLike {
  const json = JSON.stringify(body);
  const bytes = new TextEncoder().encode(json);
  const headers = new Headers({ "content-type": "application/json" });
  const makeCopy = (): ArrayBuffer => {
    const out = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(out).set(bytes);
    return out;
  };
  return {
    status: 200,
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice());
        controller.close();
      }
    }),
    async arrayBuffer(): Promise<ArrayBuffer> {
      return makeCopy();
    },
    async text(): Promise<string> {
      return json;
    },
    async json<T = unknown>(): Promise<T> {
      return JSON.parse(json) as T;
    }
  };
}

function createDryRunTransport(): TransportLike {
  return Object.freeze({
    async request(): Promise<TransportResponseLike> {
      return dryRunTransportResponse({
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.DRY_RUN" }],
        dryRun: true
      });
    }
  });
}

type ResolvedServiceSecrets = Readonly<{
  accessToken: string;
  webhookVerifyToken: string;
  webhookAppSecret: string;
  serviceBearerToken: string;
}>;

type EnvFileRead = Readonly<{ ok: true; values: Record<string, string> }> | Readonly<{ ok: false }>;

function syntheticServiceConfig(profile: WatsProfileConfig) {
  return {
    profile,
    secrets: {
      accessToken: DRY_RUN_PLACEHOLDERS.access,
      webhookVerifyToken: DRY_RUN_PLACEHOLDERS.verify,
      webhookAppSecret: DRY_RUN_PLACEHOLDERS.app,
      serviceBearerToken: DRY_RUN_PLACEHOLDERS.service
    },
    transport: createDryRunTransport(),
    whatsapp: Object.freeze({
      async dispatch(): Promise<void> {
        return undefined;
      }
    })
  };
}

function processEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

function stderrIsTty(): boolean {
  return (globalThis as { process?: { stderr?: { isTTY?: boolean } } }).process?.stderr?.isTTY === true;
}

function mergeEnvValues(base: Record<string, string | undefined>, overlay: Record<string, string>): Record<string, string | undefined> {
  return { ...base, ...overlay };
}

function resolveEnvFilePath(configPath: string, envFile: string): string {
  const slashIndex = configPath.lastIndexOf("/");
  const baseDir = slashIndex === -1 ? "." : configPath.slice(0, slashIndex);
  return `${baseDir.replace(/\/+$/u, "")}/${envFile}`;
}

async function readServeEnvFile(configPath: string, envFile: string): Promise<EnvFileRead> {
  try {
    const fsPromisesSpecifier = "node:fs/promises";
    const fs = await import(/* @vite-ignore */ fsPromisesSpecifier) as { readFile(path: string, encoding: "utf8"): Promise<string>; stat(path: string): Promise<{ size: number; isFile(): boolean }> };
    const path = resolveEnvFilePath(configPath, envFile);
    const stat = await fs.stat(path);
    if (!stat.isFile() || stat.size > ENV_FILE_MAX_BYTES) return { ok: false };
    const text = await fs.readFile(path, "utf8");
    const values: Record<string, string> = {};
    for (const rawLine of text.replace(/\r\n?/gu, "\n").split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) return { ok: false };
      const key = line.slice(0, equalsIndex);
      const value = line.slice(equalsIndex + 1);
      if (!ENV_FILE_ALLOWED_KEYS.has(key) || Object.prototype.hasOwnProperty.call(values, key) || !isSafeSetupSecret(value)) return { ok: false };
      values[key] = value;
    }
    return { ok: true, values };
  } catch {
    return { ok: false };
  }
}

function secretFromEnv(env: Record<string, string | undefined>, envName: string): string | null {
  const value = env[envName];
  return typeof value === "string" && isSafeSetupSecret(value) ? value : null;
}

async function resolveLiveServiceSecrets(profile: WatsProfileConfig, parsed: ServeArgs & { ok: true; mode: "live" }): Promise<ResolvedServiceSecrets | null> {
  if (parsed.envFile === undefined) return null;
  const file = await readServeEnvFile(parsed.configPath, parsed.envFile);
  if (!file.ok) return null;
  const env = mergeEnvValues(processEnv(), file.values);
  const accessToken = secretFromEnv(env, profile.auth.accessToken.env);
  const webhookVerifyToken = secretFromEnv(env, profile.webhook.verifyToken.env);
  const webhookAppSecret = secretFromEnv(env, profile.webhook.appSecret.env);
  const serviceBearerToken = secretFromEnv(env, profile.service.bearerToken.env);
  if (accessToken === null || webhookVerifyToken === null || webhookAppSecret === null || serviceBearerToken === null) return null;
  return { accessToken, webhookVerifyToken, webhookAppSecret, serviceBearerToken };
}

function liveServiceConfig(profile: WatsProfileConfig, secrets: ResolvedServiceSecrets) {
  return { profile, secrets };
}

function getBunRuntime(): BunLike | null {
  const maybeBun = (globalThis as { Bun?: unknown }).Bun;
  if (typeof maybeBun !== "object" || maybeBun === null || !("serve" in maybeBun) || typeof (maybeBun as { serve?: unknown }).serve !== "function") {
    return null;
  }
  return maybeBun as BunLike;
}

function createServeShutdown(server: BunServer): () => void {
  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      server.stop(true);
    }
  };
}

async function serveCommand(args: readonly string[]): Promise<CliCommandResult> {
  const parsed = parseServeArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(SERVE_HELP);
    if (parsed.reason === "live_missing") return fail(LIVE_MISSING_ERROR);
    return fail("Invalid serve arguments. Run `wats serve --help` for usage.\n");
  }

  try {
    const config = await loadConfig(parsed.configPath);
    const selected = selectProfile(config, parsed.profileName);
    if (selected === null) return fail("Invalid profile selection. Run `wats serve --help` for usage.\n");
    const profile = serveProfileWithOverrides(selected, parsed);

    // Reuse service OpenAPI generation for route collision and URL validation before binding.
    createWatsServiceOpenApiDocument(profile);
    if (parsed.printRoutes) return ok(formatServeRoutes(profile, parsed.mode));

    // WATS-129: apply native PaaS bind resolution ($PORT / 0.0.0.0) only when --paas
    // is set, and only on the binding path (print-routes above never needs $PORT).
    const boundProfile = resolvePaasServeProfile(profile, parsed, processEnv());
    if (boundProfile === null) return fail("Invalid serve arguments. Run `wats serve --help` for usage.\n");

    const bunRuntime = getBunRuntime();
    if (bunRuntime === null) return fail("Bun runtime unavailable. Run `wats serve --help` for usage.\n");

    const serviceConfig = parsed.mode === "dry-run"
      ? syntheticServiceConfig(boundProfile)
      : await resolveLiveServiceSecrets(boundProfile, parsed as ServeArgs & { ok: true; mode: "live" }).then((secrets) => secrets === null ? null : liveServiceConfig(boundProfile, secrets));
    if (serviceConfig === null) return fail("SecretResolutionError\nMissing or invalid live env values. Run `wats serve --help` for usage.\n");

    const app = createWatsServiceApp(serviceConfig);
    const server = bunRuntime.serve({ hostname: boundProfile.service.host, port: boundProfile.service.port, fetch: app.fetch });
    return Object.freeze({ ...ok(formatServeReady(boundProfile.service.host, server.port, parsed.mode)), shutdown: createServeShutdown(server) });
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return fail(formatConfigValidationError(error, "wats serve --help"));
    }
    if (error instanceof WatsServiceError) {
      const safe = error.code === "invalid_path"
        ? new WatsServiceError(error.code, "Service route configuration is invalid.")
        : error;
      return fail(formatWatsServiceError(safe, "wats serve --help"));
    }
    return fail("Serve bind failed. Run `wats serve --help` for usage.\n");
  }
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


type DoctorCheckStatus = "ok" | "warning" | "error";

type DoctorCheck = Readonly<{
  name: string;
  status: DoctorCheckStatus;
  message: string;
}>;


function parseUpgradeArgs(args: readonly string[]): UpgradeArgs {
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) return { ok: false, reason: "usage" };
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (ROOT_HELP_FLAGS.has(flagName)) {
      const unknownHelpSidecar = args.find((sidecar) => sidecar.startsWith("-") && !ROOT_HELP_FLAGS.has(sidecar.includes("=") ? sidecar.slice(0, sidecar.indexOf("=")) : sidecar));
      return unknownHelpSidecar === undefined ? { ok: false, reason: "help" } : { ok: false, reason: "usage" };
    }
    if (!UPGRADE_ALLOWED_FLAGS.includes(flagName as typeof UPGRADE_ALLOWED_FLAGS[number])) return { ok: false, reason: "usage" };
    if (flagName === "--dry-run") {
      if (dryRun || arg.includes("=")) return { ok: false, reason: "usage" };
      dryRun = true;
    }
  }
  return { ok: true, dryRun };
}

async function readProjectPackageJson(cwd: string): Promise<Record<string, unknown> | null> {
  try {
    const fsPromisesSpecifier = "node:fs/promises";
    const fs = await import(/* @vite-ignore */ fsPromisesSpecifier) as { readFile(path: string, encoding: "utf8"): Promise<string> };
    const text = await fs.readFile(`${cwd.endsWith("/") ? cwd.slice(0, -1) : cwd}/package.json`, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function readCliPackageVersion(): Promise<string | null> {
  try {
    const fsPromisesSpecifier = "node:fs/promises";
    const fs = await import(/* @vite-ignore */ fsPromisesSpecifier) as { readFile(path: string | URL, encoding: "utf8"): Promise<string> };
    const text = await fs.readFile(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" && parseVersionTuple(version) !== null ? version : null;
  } catch {
    return null;
  }
}

function manifestSections(manifest: Record<string, unknown>): readonly Record<string, unknown>[] {
  const sections: Record<string, unknown>[] = [];
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
    const value = manifest[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) sections.push(value as Record<string, unknown>);
  }
  return sections;
}

function manifestWatsVersions(manifest: Record<string, unknown>): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const section of manifestSections(manifest)) {
    for (const packageName of PUBLIC_WATS_UPGRADE_PACKAGES) {
      const version = section[packageName];
      if (typeof version === "string") versions[packageName] = version;
    }
  }
  return versions;
}

function parseVersionTuple(value: string): readonly [number, number, number] | null {
  const match = /^(?:workspace:|npm:)?\^?~?(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/u.exec(value.trim());
  if (match === null) return null;
  return [Number.parseInt(match[1] ?? "0", 10), Number.parseInt(match[2] ?? "0", 10), Number.parseInt(match[3] ?? "0", 10)] as const;
}

function isVersionOlderThan(value: string, referenceVersion: string): boolean {
  if (value.startsWith("workspace:") || value.startsWith("link:") || value.startsWith("file:")) return false;
  const current = parseVersionTuple(value);
  const cli = parseVersionTuple(referenceVersion);
  if (current === null || cli === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] < cli[index]) return true;
    if (current[index] > cli[index]) return false;
  }
  return false;
}

function countOutdatedWatsPackages(manifest: Record<string, unknown>, referenceVersion: string): number {
  return Object.values(manifestWatsVersions(manifest)).filter((version) => isVersionOlderThan(version, referenceVersion)).length;
}

function upgradeCommandText(): string {
  return `bun update --latest ${PUBLIC_WATS_UPGRADE_PACKAGES.join(" ")}`;
}

async function defaultSpawn(command: string, args: readonly string[], options: Readonly<{ cwd: string }>): Promise<CliSpawnResult> {
  try {
    const proc = (globalThis as unknown as { Bun?: { spawnSync?: (command: readonly string[], options: { cwd: string; stdout: "pipe"; stderr: "pipe" }) => { exitCode: number | null; stdout: Uint8Array; stderr: Uint8Array } } }).Bun;
    if (proc?.spawnSync === undefined) return { exitCode: 1, stdout: "", stderr: "" };
    const completed = proc.spawnSync([command, ...args], { cwd: options.cwd, stdout: "pipe", stderr: "pipe" });
    const decoder = new TextDecoder();
    return { exitCode: completed.exitCode ?? 1, stdout: decoder.decode(completed.stdout), stderr: decoder.decode(completed.stderr) };
  } catch {
    return { exitCode: 1, stdout: "", stderr: "" };
  }
}

async function upgradeCommand(args: readonly string[], context: CliCommandContext = {}): Promise<CliCommandResult> {
  const parsed = parseUpgradeArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(UPGRADE_HELP);
    return cliUsageError("wats upgrade --help");
  }

  const cwd = context.cwd ?? (globalThis as { process?: { cwd(): string } }).process?.cwd?.() ?? ".";
  const manifest = await readProjectPackageJson(cwd);
  if (manifest === null) return fail("PackageManifestError\npackage manifest could not be read. Run `wats upgrade --help` for usage.\n");

  const commandArgs = ["update", "--latest", ...PUBLIC_WATS_UPGRADE_PACKAGES] as const;
  if (parsed.dryRun) return ok(["upgrade dry-run", `command: ${upgradeCommandText()}`].join("\n") + "\n");

  const spawn = context.spawn ?? defaultSpawn;
  const result = await spawn("bun", commandArgs, { cwd });
  if (result.exitCode !== 0) return fail("PackageUpgradeError\nbun update failed. Run `wats upgrade --help` for usage.\n");
  return ok(["upgrade complete", `packages: ${PUBLIC_WATS_UPGRADE_PACKAGES.length}`].join("\n") + "\n");
}

function parseDoctorArgs(args: readonly string[]): DoctorArgs {
  let checkEnv = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) return { ok: false, reason: "usage" };
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (ROOT_HELP_FLAGS.has(flagName)) {
      const unknownHelpSidecar = args.find((sidecar) => sidecar.startsWith("-") && !ROOT_HELP_FLAGS.has(sidecar.includes("=") ? sidecar.slice(0, sidecar.indexOf("=")) : sidecar));
      return unknownHelpSidecar === undefined ? { ok: false, reason: "help" } : { ok: false, reason: "usage" };
    }
    if (!DOCTOR_ALLOWED_FLAGS.includes(flagName as typeof DOCTOR_ALLOWED_FLAGS[number])) return { ok: false, reason: "usage" };
    if (flagName === "--check-env") {
      if (checkEnv || arg.includes("=")) return { ok: false, reason: "usage" };
      checkEnv = true;
      continue;
    }
    if (!arg.includes("=")) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) return { ok: false, reason: "usage" };
      index += 1;
    }
  }

  const valueArgs = args.filter((arg) => arg !== "--check-env");
  const configFlag = parseFlagValue(valueArgs, ["--config"], DOCTOR_VALUE_FLAGS);
  const profileFlag = parseFlagValue(valueArgs, ["--profile"], DOCTOR_VALUE_FLAGS);
  const formatFlag = parseFlagValue(valueArgs, ["--format"], DOCTOR_VALUE_FLAGS);
  if (!configFlag.ok || !profileFlag.ok || !formatFlag.ok) return { ok: false, reason: "usage" };
  if (!configFlag.present || configFlag.value === undefined) return { ok: false, reason: "missing_config" };
  const positionals = nonFlagArgs(valueArgs, DOCTOR_VALUE_FLAGS);
  if (positionals === null || positionals.some((arg) => arg.trim().length > 0)) return { ok: false, reason: "usage" };
  const format = formatFlag.value ?? "text";
  if (format !== "text" && format !== "json") return { ok: false, reason: "usage" };
  return {
    ok: true,
    configPath: configFlag.value,
    ...(profileFlag.value !== undefined ? { profileName: profileFlag.value } : {}),
    checkEnv,
    format
  };
}

function doctorCheck(name: string, status: DoctorCheckStatus, message: string): DoctorCheck {
  return Object.freeze({ name, status, message });
}

function doctorSummary(checks: readonly DoctorCheck[]): { ok: number; warning: number; error: number } {
  return {
    ok: checks.filter((check) => check.status === "ok").length,
    warning: checks.filter((check) => check.status === "warning").length,
    error: checks.filter((check) => check.status === "error").length
  };
}

function formatDoctorJson(checks: readonly DoctorCheck[]): string {
  const summary = doctorSummary(checks);
  return `${JSON.stringify({ ok: summary.error === 0, summary, checks }, null, 2)}\n`;
}

function formatDoctorText(checks: readonly DoctorCheck[]): string {
  const summary = doctorSummary(checks);
  const lines = [summary.error === 0 ? "doctor ok" : "doctor failed"];
  for (const check of checks) lines.push(`${check.name}: ${check.status}`);
  lines.push(`summary: ok=${summary.ok} warning=${summary.warning} error=${summary.error}`);
  return `${lines.join("\n")}\n`;
}

function requiredEnvRefs(profile: WatsProfileConfig): readonly string[] {
  return [
    profile.auth.accessToken.env,
    profile.webhook.verifyToken.env,
    profile.webhook.appSecret.env,
    profile.service.bearerToken.env
  ];
}

function countMissingEnv(profile: WatsProfileConfig): number {
  let missing = 0;
  for (const envName of requiredEnvRefs(profile)) {
    const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[envName];
    if (value === undefined || value.length === 0) missing += 1;
  }
  return missing;
}

async function doctorCommand(args: readonly string[], context: CliCommandContext = {}): Promise<CliCommandResult> {
  const parsed = parseDoctorArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(DOCTOR_HELP);
    if (parsed.reason === "missing_config") {
      return fail(
        "DoctorConfigError\n" +
        "No config path was provided. Run `wats init` to create one, or pass " +
        "`--config <path>` to point at an existing file. Run `wats doctor --help` " +
        "for usage.\n"
      );
    }
    return fail("Invalid doctor arguments. Run `wats doctor --help` for usage.\n");
  }

  const checks: DoctorCheck[] = [
    doctorCheck("runtime", "ok", "Runtime supports WATS CLI offline diagnostics."),
    doctorCheck("package-imports", "ok", "Required WATS packages are importable.")
  ];

  const manifest = await readProjectPackageJson(context.cwd ?? (globalThis as { process?: { cwd(): string } }).process?.cwd?.() ?? ".");
  const cliVersion = await readCliPackageVersion();
  if (manifest === null || cliVersion === null) {
    checks.push(doctorCheck("packages", "warning", "Package versions could not be checked."));
  } else {
    const outdatedCount = countOutdatedWatsPackages(manifest, cliVersion);
    checks.push(outdatedCount === 0
      ? doctorCheck("packages", "ok", "WATS package versions look current for this CLI.")
      : doctorCheck("packages", "warning", `${outdatedCount} WATS package${outdatedCount === 1 ? " appears" : "s appear"} older than this CLI.`));
  }

  let config: WatsConfig | null = null;
  try {
    config = await loadConfig(parsed.configPath);
    checks.push(doctorCheck("config", "ok", "Config file is valid."));
  } catch (error) {
    checks.push(doctorCheck("config", "error", error instanceof ConfigValidationError ? "Config validation failed." : "Config file could not be loaded."));
  }

  let profile: WatsProfileConfig | null = null;
  if (config !== null) {
    profile = selectProfile(config, parsed.profileName);
    if (profile === null) {
      checks.push(doctorCheck("profile", "error", "Selected profile is unavailable."));
      profile = selectProfile(config, undefined);
    } else {
      checks.push(doctorCheck("profile", "ok", "Selected profile is available."));
    }
  } else {
    checks.push(doctorCheck("profile", "error", "Selected profile could not be checked."));
  }

  if (parsed.checkEnv) {
    if (profile === null) {
      checks.push(doctorCheck("env", "error", "Required env values could not be checked."));
    } else {
      const missing = countMissingEnv(profile);
      checks.push(missing === 0
        ? doctorCheck("env", "ok", "All required env values are present.")
        : doctorCheck("env", "error", `missing ${missing} required env value${missing === 1 ? "" : "s"}`));
    }
  }

  if (profile === null) {
    checks.push(doctorCheck("routes", "error", "Service routes could not be checked."));
    checks.push(doctorCheck("openapi", "error", "OpenAPI document could not be generated."));
  } else {
    try {
      createWatsServiceOpenApiDocument(profile);
      checks.push(doctorCheck("routes", "ok", "Service routes do not collide."));
      checks.push(doctorCheck("openapi", "ok", "OpenAPI document can be generated."));
    } catch (error) {
      checks.push(doctorCheck("routes", "error", error instanceof WatsServiceError ? "Service route configuration is invalid." : "Service routes could not be checked."));
      checks.push(doctorCheck("openapi", "error", "OpenAPI document could not be generated."));
    }
  }

  const summary = doctorSummary(checks);
  const stdout = parsed.format === "json" ? formatDoctorJson(checks) : formatDoctorText(checks);
  return Object.freeze({ exitCode: summary.error === 0 ? 0 : 1, stdout, stderr: "" });
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

// WATS-123: arg parsers for `wats messages list/show`.
function isMessagesLimitInteger(value: string): boolean {
  return /^[1-9][0-9]*$/u.test(value);
}

function parseMessagesListArgs(args: readonly string[]): MessagesListArgs {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.trim().length === 0) return { ok: false, reason: "usage" };
    if (!arg.startsWith("-")) return { ok: false, reason: "usage" };
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (ROOT_HELP_FLAGS.has(flagName)) {
      const unknownHelpSidecar = args.find((sidecar) => {
        if (!sidecar.startsWith("-")) return false;
        const sidecarName = sidecar.includes("=") ? sidecar.slice(0, sidecar.indexOf("=")) : sidecar;
        return !ROOT_HELP_FLAGS.has(sidecarName);
      });
      return unknownHelpSidecar === undefined ? { ok: false, reason: "help" } : { ok: false, reason: "usage" };
    }
    if (!MESSAGES_LIST_ALLOWED_FLAGS.includes(flagName as typeof MESSAGES_LIST_ALLOWED_FLAGS[number])) return { ok: false, reason: "usage" };
    if (flagName === "--json") {
      if (arg.includes("=") || hasFlagName(args.slice(index + 1), flagName)) return { ok: false, reason: "usage" };
      continue;
    }
    if (!arg.includes("=")) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) return { ok: false, reason: "usage" };
      index += 1;
    }
  }

  const valueArgs = args.filter((arg) => arg !== "--json");
  const configFlag = parseFlagValue(valueArgs, ["--config"], MESSAGES_LIST_VALUE_FLAGS);
  const profileFlag = parseFlagValue(valueArgs, ["--profile"], MESSAGES_LIST_VALUE_FLAGS);
  const envFileFlag = parseFlagValue(valueArgs, ["--env-file"], MESSAGES_LIST_VALUE_FLAGS);
  const limitFlag = parseFlagValue(valueArgs, ["--limit"], MESSAGES_LIST_VALUE_FLAGS);
  const cursorFlag = parseFlagValue(valueArgs, ["--cursor"], MESSAGES_LIST_VALUE_FLAGS);
  if (!configFlag.ok || !profileFlag.ok || !envFileFlag.ok || !limitFlag.ok || !cursorFlag.ok
      || !configFlag.present || configFlag.value === undefined) {
    return { ok: false, reason: "usage" };
  }
  const positionals = nonFlagArgs(valueArgs, MESSAGES_LIST_VALUE_FLAGS);
  if (positionals === null || positionals.some((arg) => arg.trim().length > 0)) return { ok: false, reason: "usage" };

  if (profileFlag.value !== undefined && !isSafeProfileName(profileFlag.value)) return { ok: false, reason: "usage" };
  if (envFileFlag.value !== undefined && !isSafeServeEnvFile(envFileFlag.value)) return { ok: false, reason: "usage" };
  if (limitFlag.value !== undefined && !isMessagesLimitInteger(limitFlag.value)) return { ok: false, reason: "usage" };
  if (cursorFlag.value !== undefined && !isNonEmptyArg(cursorFlag.value)) return { ok: false, reason: "usage" };

  return {
    ok: true,
    configPath: configFlag.value,
    json: hasFlagName(args, "--json"),
    ...(profileFlag.value !== undefined ? { profileName: profileFlag.value } : {}),
    ...(envFileFlag.value !== undefined ? { envFilePath: envFileFlag.value } : {}),
    ...(limitFlag.value !== undefined ? { limit: Number.parseInt(limitFlag.value, 10) } : {}),
    ...(cursorFlag.value !== undefined ? { cursor: cursorFlag.value } : {})
  };
}

function parseMessagesShowArgs(args: readonly string[]): MessagesShowArgs {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.trim().length === 0) return { ok: false, reason: "usage" };
    if (!arg.startsWith("-")) continue;
    const flagName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (ROOT_HELP_FLAGS.has(flagName)) {
      const unknownHelpSidecar = args.find((sidecar) => {
        if (!sidecar.startsWith("-")) return false;
        const sidecarName = sidecar.includes("=") ? sidecar.slice(0, sidecar.indexOf("=")) : sidecar;
        return !ROOT_HELP_FLAGS.has(sidecarName);
      });
      return unknownHelpSidecar === undefined ? { ok: false, reason: "help" } : { ok: false, reason: "usage" };
    }
    if (!MESSAGES_SHOW_ALLOWED_FLAGS.includes(flagName as typeof MESSAGES_SHOW_ALLOWED_FLAGS[number])) return { ok: false, reason: "usage" };
    if (flagName === "--json") {
      if (arg.includes("=") || hasFlagName(args.slice(index + 1), flagName)) return { ok: false, reason: "usage" };
      continue;
    }
    if (!arg.includes("=")) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) return { ok: false, reason: "usage" };
      index += 1;
    }
  }

  const valueArgs = args.filter((arg) => arg !== "--json");
  const configFlag = parseFlagValue(valueArgs, ["--config"], MESSAGES_SHOW_VALUE_FLAGS);
  const profileFlag = parseFlagValue(valueArgs, ["--profile"], MESSAGES_SHOW_VALUE_FLAGS);
  const envFileFlag = parseFlagValue(valueArgs, ["--env-file"], MESSAGES_SHOW_VALUE_FLAGS);
  if (!configFlag.ok || !profileFlag.ok || !envFileFlag.ok
      || !configFlag.present || configFlag.value === undefined) {
    return { ok: false, reason: "usage" };
  }
  const positionals = nonFlagArgs(valueArgs, MESSAGES_SHOW_VALUE_FLAGS);
  if (positionals === null) return { ok: false, reason: "usage" };
  const cleanPositionals = positionals.filter((arg) => arg.trim().length > 0);
  if (cleanPositionals.length !== 1 || !isNonEmptyArg(cleanPositionals[0])) return { ok: false, reason: "usage" };

  if (profileFlag.value !== undefined && !isSafeProfileName(profileFlag.value)) return { ok: false, reason: "usage" };
  if (envFileFlag.value !== undefined && !isSafeServeEnvFile(envFileFlag.value)) return { ok: false, reason: "usage" };

  return {
    ok: true,
    configPath: configFlag.value,
    messageId: cleanPositionals[0],
    json: hasFlagName(args, "--json"),
    ...(profileFlag.value !== undefined ? { profileName: profileFlag.value } : {}),
    ...(envFileFlag.value !== undefined ? { envFilePath: envFileFlag.value } : {})
  };
}

async function fetchServiceJson(opts: ServiceClientOptions, pathAndQuery: string): Promise<FetchServiceJsonResult> {
  const url = `${opts.baseUrl}${pathAndQuery}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" }
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message: rawMessage };
  }

  if (!response.ok) {
    let body: ServiceErrorBody;
    try {
      const parsed = await response.json() as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          && typeof (parsed as { error?: unknown }).error === "object"
          && (parsed as { error?: unknown }).error !== null) {
        const err = (parsed as { error: { code?: unknown; message?: unknown } }).error;
        body = {
          error: {
            code: typeof err.code === "string" ? err.code : `http_${response.status}`,
            ...(typeof err.message === "string" ? { message: err.message } : {})
          }
        };
      } else {
        throw new Error("non-standard error body");
      }
    } catch {
      let snippet = "";
      try {
        snippet = (await response.text()).slice(0, 200);
      } catch {
        snippet = "";
      }
      body = { error: { code: `http_${response.status}`, ...(snippet.length > 0 ? { message: snippet } : {}) } };
    }
    return { ok: false, kind: "http", status: response.status, body };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message: rawMessage };
  }
  return { ok: true, status: response.status, body };
}

function formatMessageRecordText(record: MessageRecordWire): string {
  const lines = [
    `rowId: ${record.rowId}`,
    `waMessageId: ${record.waMessageId}`,
    `direction: ${record.direction}`,
    `fromPhone: ${record.fromPhone === null ? "null" : record.fromPhone}`,
    `toPhone: ${record.toPhone === null ? "null" : record.toPhone}`,
    `type: ${record.type}`,
    `status: ${record.status}`,
    `graphMessageId: ${record.graphMessageId === null ? "null" : record.graphMessageId}`,
    `createdAt: ${record.createdAt}`,
    `updatedAt: ${record.updatedAt}`
  ];
  return `${lines.join("\n")}\n`;
}

function formatMessagesListText(body: MessagesListResponseWire): { stdout: string; stderr: string } {
  const header = "createdAt\tdirection\twaMessageId\ttype\tstatus\tfrom\tto";
  const rows = body.items.map((item) => [
    item.createdAt,
    item.direction,
    item.waMessageId,
    item.type,
    item.status,
    item.fromPhone ?? "",
    item.toPhone ?? ""
  ].join("\t"));
  const stdout = `${[header, ...rows].join("\n")}\n`;
  const stderr = `nextCursor: ${body.nextCursor === null ? "(none)" : body.nextCursor}\n`;
  return { stdout, stderr };
}

async function runMessagesListCommand(args: readonly string[]): Promise<CliCommandResult> {
  const parsed = parseMessagesListArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(MESSAGES_LIST_HELP);
    return cliUsageError("wats messages list --help");
  }

  try {
    const config = await loadConfig(parsed.configPath);
    const profile = selectProfile(config, parsed.profileName);
    if (profile === null) return fail("Requested profile not found in config.\n");

    let env = processEnv();
    if (parsed.envFilePath !== undefined) {
      const file = await readServeEnvFile(parsed.configPath, parsed.envFilePath);
      if (!file.ok) return fail("Env file could not be read. Run `wats messages list --help` for usage.\n");
      env = mergeEnvValues(env, file.values);
    }
    const token = secretFromEnv(env, profile.service.bearerToken.env);
    if (token === null) {
      return fail(`Service bearer token is not set. Set the ${profile.service.bearerToken.env} environment variable (or provide --env-file).\n`);
    }

    const baseUrl = `http://${profile.service.host}:${profile.service.port}${profile.service.apiPrefix}`;
    let pathAndQuery = `/messages?limit=${parsed.limit ?? 50}`;
    if (parsed.cursor !== undefined) pathAndQuery += `&cursor=${encodeURIComponent(parsed.cursor)}`;

    const result = await fetchServiceJson({ baseUrl, token }, pathAndQuery);
    if (!result.ok) {
      if (result.kind === "network") {
        return fail(`Could not reach the local service at ${profile.service.host}:${profile.service.port}. Is 'wats serve' running? (${result.message})\n`);
      }
      const errCode = result.body.error.code;
      const errMsg = result.body.error.message !== undefined ? `: ${result.body.error.message}` : "";
      return fail(`Service responded ${result.status} ${errCode}${errMsg}.\n`);
    }

    if (parsed.json) {
      return ok(`${JSON.stringify(result.body, null, 2)}\n`);
    }
    const body = result.body as MessagesListResponseWire;
    const formatted = formatMessagesListText(body);
    const statusSummary = processEnv().WATS_CLI_STATUS_UI === "1" && stderrIsTty()
      ? formatMessagesStatusSummaryLine({ records: body.items, fetchedAt: new Date().toISOString() })
      : "";
    return Object.freeze({ exitCode: 0, stdout: formatted.stdout, stderr: `${formatted.stderr}${statusSummary}` });
  } catch {
    return fail(safeGenericError("wats messages list --help"));
  }
}

async function runMessagesShowCommand(args: readonly string[]): Promise<CliCommandResult> {
  const parsed = parseMessagesShowArgs(args);
  if (!parsed.ok) {
    if (parsed.reason === "help") return ok(MESSAGES_SHOW_HELP);
    return cliUsageError("wats messages show --help");
  }

  try {
    const config = await loadConfig(parsed.configPath);
    const profile = selectProfile(config, parsed.profileName);
    if (profile === null) return fail("Requested profile not found in config.\n");

    let env = processEnv();
    if (parsed.envFilePath !== undefined) {
      const file = await readServeEnvFile(parsed.configPath, parsed.envFilePath);
      if (!file.ok) return fail("Env file could not be read. Run `wats messages show --help` for usage.\n");
      env = mergeEnvValues(env, file.values);
    }
    const token = secretFromEnv(env, profile.service.bearerToken.env);
    if (token === null) {
      return fail(`Service bearer token is not set. Set the ${profile.service.bearerToken.env} environment variable (or provide --env-file).\n`);
    }

    const baseUrl = `http://${profile.service.host}:${profile.service.port}${profile.service.apiPrefix}`;
    const pathAndQuery = `/messages/${encodeURIComponent(parsed.messageId)}`;

    const result = await fetchServiceJson({ baseUrl, token }, pathAndQuery);
    if (!result.ok) {
      if (result.kind === "network") {
        return fail(`Could not reach the local service at ${profile.service.host}:${profile.service.port}. Is 'wats serve' running? (${result.message})\n`);
      }
      const errCode = result.body.error.code;
      const errMsg = result.body.error.message !== undefined ? `: ${result.body.error.message}` : "";
      return fail(`Service responded ${result.status} ${errCode}${errMsg}.\n`);
    }

    if (parsed.json) {
      return ok(`${JSON.stringify(result.body, null, 2)}\n`);
    }
    return ok(formatMessageRecordText(result.body as MessageRecordWire));
  } catch {
    return fail(safeGenericError("wats messages show --help"));
  }
}

async function runMessagesCommand(args: readonly string[]): Promise<CliCommandResult> {
  const [subcommand, ...rest] = args;

  if (subcommand === undefined || ROOT_HELP_FLAGS.has(subcommand)) {
    return ok(MESSAGES_HELP);
  }
  if (subcommand === "list") return runMessagesListCommand(rest);
  if (subcommand === "show") return runMessagesShowCommand(rest);
  return fail("Unknown command. Run `wats --help` for usage.\n");
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

export async function runCli(argv: readonly string[] = [], context: CliCommandContext = {}): Promise<CliCommandResult> {
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string")) {
    return cliUsageError("wats --help");
  }
  const args = argv.filter((arg) => arg.length > 0);
  const [command, ...rest] = args;

  if (command === undefined) {
    return ok(ROOT_HELP);
  }

  if (ROOT_HELP_FLAGS.has(command)) {
    return rest.length === 0 ? ok(ROOT_HELP) : cliUsageError("wats --help");
  }

  if (command === "--version" || command === "-v") {
    if (rest.length !== 0) return cliUsageError("wats --help");
    const version = await readCliPackageVersion();
    return version === null ? fail("VersionError\nCLI package version could not be read. Run `wats --help` for usage.\n") : ok(`${version}\n`);
  }

  if (command.startsWith("-")) {
    return fail("Unknown option. Run `wats --help` for usage.\n");
  }

  switch (command) {
    case "init":
      return initCommand(rest);

    case "setup":
      return setupCommand(rest, context);

    case "onboarding":
      return onboardingCommand(rest);

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
      return doctorCommand(rest, context);

    case "upgrade":
    case "update":
      return upgradeCommand(rest, context);

    case "openapi":
      return openApiCommand(rest);

    case "serve":
      return serveCommand(rest);

    case "webhook":
      return runWebhookCommand(rest);

    case "messages":
      return runMessagesCommand(rest);

    default:
      return fail(`Unknown command ${sanitizeCommandLabel(args)}. Run \`wats --help\` for usage.\n`);
  }
}
