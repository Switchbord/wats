// WATS-191 consumer fixture: assert the deprecated WATS-176 untyped
// parser/router/filters surface is ABSENT from the @wats/core namespace
// and the typed replacements are PRESENT with correct runtime shape.
//
// Imports ONLY through the published package specifiers `@wats/core` and
// `@wats/core/filtersTyped` (never via relative paths) so the external
// export-surface contract is exercised across the workspace boundary.
// This satisfies the adversarial battery section 7 (export surface and
// consumer fixture) for the removal.
//
// Emits a single-line JSON report on stdout and the success sentinel
// `wats191-legacy-removal:ok` as the last line. On any failed check it
// emits the fail sentinel `wats191-legacy-removal:fail` and exits 1.

import * as coreRoot from "@wats/core";
import {
  TypedRouter,
  normalizeWebhookEnvelope,
  WebhookNormalizationError,
  DEFAULT_MAX_EVENTS_PER_ENVELOPE,
  filtersTyped,
  createListenerRegistry,
  WhatsApp
} from "@wats/core";
import {
  createTypedFilter,
  isTypedFilter,
  FILTER_BRAND,
  FilterValidationError,
  and,
  or,
  not,
  message,
  status
} from "@wats/core/filtersTyped";

interface ReportOk {
  readonly ok: true;
  readonly sentinel: "wats191-legacy-removal:ok";
  readonly checks: Readonly<Record<string, boolean>>;
}
interface ReportFail {
  readonly ok: false;
  readonly sentinel: "wats191-legacy-removal:fail";
  readonly checks: Readonly<Record<string, boolean>>;
  readonly failed: readonly string[];
}

// Root namespace as a record to probe for legacy symbols that TypeScript
// no longer types (they are gone from the .d.ts after removal). Probing
// via `in` and `=== undefined` catches both re-export removal and any
// accidental re-homing.
const root = coreRoot as unknown as Record<string, unknown>;

// Full legacy WATS-176 surface that MUST be absent from the @wats/core
// root namespace after the removal. Names match the symbols declared in
// updateParser.ts, router.ts, and filters/{base,builtins-message,
// builtins-status}.ts. The untyped `and`/`or`/`not` were root exports
// via `export * from "./filters/index.js"`; the typed `and`/`or`/`not`
// live under the `filtersTyped` namespace, not the root.
const legacyRootSymbols: readonly string[] = [
  "createUpdateRouter",
  "parseWebhookUpdate",
  "DEFAULT_UPDATE_ROUTER_LIMITS",
  "hasMessageText",
  "messageTextContains",
  "messageFromWaId",
  "hasMessageStatus",
  "messageStatusIn",
  "and",
  "or",
  "not",
  "UpdateRouter",
  "UpdateFilter",
  "ParsedUpdateEvent",
  "UpdateParserError",
  "UpdateParserOptions",
  "UpdateParserErrorCode",
  "ParseWebhookUpdateResult",
  "ParsedUpdateDiscriminator",
  "ParsedUpdateEntryMetadata",
  "ParsedUpdateChangeMetadata",
  "ParsedUpdateRawRefs",
  "UpdateRouteSelector",
  "UpdateRouteHandler",
  "DispatchErrorRecord",
  "DispatchLimitErrorCode",
  "DispatchLimitError",
  "DispatchSummary",
  "UpdateRouterOptions",
  "MessageTextContainsOptions"
];

function isFunction(value: unknown): value is Function {
  return typeof value === "function";
}

function isClassLike(value: unknown): boolean {
  // A JS class is a function whose `.prototype` is an object.
  return typeof value === "function" && typeof (value as { prototype?: unknown }).prototype === "object";
}

function verify(): ReportOk | ReportFail {
  const checks: Record<string, boolean> = {};
  const failed: string[] = [];

  // --- Legacy symbols MUST be absent from the @wats/core root namespace.
  for (const name of legacyRootSymbols) {
    const present = name in root && root[name] !== undefined;
    const ok = !present;
    checks[`legacy root symbol "${name}" is absent`] = ok;
    if (!ok) failed.push(`legacy root symbol "${name}" is absent`);
  }

  // --- Typed replacements MUST be present with correct runtime shape
  // (battery section 7: typeof / constructor identity / function signatures).

  checks["TypedRouter is a class (function with prototype)"] = isClassLike(TypedRouter);
  checks["TypedRouter.prototype.on is a function"] =
    isFunction((TypedRouter as unknown as { prototype: { on?: unknown } }).prototype.on);
  checks["TypedRouter.prototype.dispatch is a function"] =
    isFunction((TypedRouter as unknown as { prototype: { dispatch?: unknown } }).prototype.dispatch);

  let routerInstance: TypedRouter | undefined;
  try {
    routerInstance = new TypedRouter();
  } catch {
    routerInstance = undefined;
  }
  checks["new TypedRouter() yields a TypedRouter instance"] =
    routerInstance instanceof TypedRouter;
  checks["TypedRouter instance has .on and .dispatch methods"] =
    routerInstance !== undefined &&
    isFunction(routerInstance.on) &&
    isFunction(routerInstance.dispatch);

  checks["normalizeWebhookEnvelope is a function"] = isFunction(normalizeWebhookEnvelope);
  checks["WebhookNormalizationError is a class"] = isClassLike(WebhookNormalizationError);

  checks["DEFAULT_MAX_EVENTS_PER_ENVELOPE is a finite positive integer"] =
    typeof DEFAULT_MAX_EVENTS_PER_ENVELOPE === "number" &&
    Number.isFinite(DEFAULT_MAX_EVENTS_PER_ENVELOPE) &&
    Number.isInteger(DEFAULT_MAX_EVENTS_PER_ENVELOPE) &&
    DEFAULT_MAX_EVENTS_PER_ENVELOPE > 0;

  // --- filtersTyped namespace shape (root re-export).
  checks["filtersTyped is a non-null object namespace"] =
    typeof filtersTyped === "object" && filtersTyped !== null;
  const ft = filtersTyped as Record<string, unknown>;
  checks["filtersTyped.message is a function/object"] =
    typeof ft.message === "function" || typeof ft.message === "object";
  checks["filtersTyped.status is a function/object"] =
    typeof ft.status === "function" || typeof ft.status === "object";
  checks["filtersTyped.account is a function/object"] =
    typeof ft.account === "function" || typeof ft.account === "object";
  checks["filtersTyped.and is a function"] = isFunction(ft.and);
  checks["filtersTyped.or is a function"] = isFunction(ft.or);
  checks["filtersTyped.not is a function"] = isFunction(ft.not);
  checks["filtersTyped.custom is a function"] = isFunction(ft.custom);
  checks["filtersTyped.createTypedFilter is a function"] = isFunction(ft.createTypedFilter);
  checks["filtersTyped.isTypedFilter is a function"] = isFunction(ft.isTypedFilter);
  checks["filtersTyped.FILTER_BRAND is a symbol"] = typeof ft.FILTER_BRAND === "symbol";
  checks["filtersTyped.FilterValidationError is a class"] =
    isClassLike(ft.FilterValidationError);

  // --- WhatsApp facade + listener registry present (non-legacy surface).
  checks["WhatsApp is a class"] = isClassLike(WhatsApp);
  checks["createListenerRegistry is a function"] = isFunction(createListenerRegistry);

  // --- filtersTyped subpath import surface (section 7 consumer fixture).
  checks["subpath @wats/core/filtersTyped exports createTypedFilter"] = isFunction(createTypedFilter);
  checks["subpath @wats/core/filtersTyped exports isTypedFilter"] = isFunction(isTypedFilter);
  checks["subpath @wats/core/filtersTyped FILTER_BRAND is interned via Symbol.for"] =
    FILTER_BRAND === Symbol.for("@wats/core/filter-brand");
  checks["subpath @wats/core/filtersTyped FilterValidationError is a class"] =
    isClassLike(FilterValidationError);
  checks["subpath and/or/not are functions"] =
    isFunction(and) && isFunction(or) && isFunction(not);
  checks["subpath message/status are filter namespaces"] =
    (typeof message === "function" || typeof message === "object") &&
    (typeof status === "function" || typeof status === "object");

  // Sibling-NOT: the root `and`/`or`/`not` (legacy untyped) must be gone,
  // while the typed `and`/`or`/`not` live under `filtersTyped`.
  checks["root `and` gone; filtersTyped.and is the only and"] =
    root.and === undefined && isFunction(ft.and);

  // Construction-time FilterValidationError behavior (typed surface liveness).
  let emptyTextCaught: unknown;
  try {
    // message.text("") must throw FilterValidationError("empty_substring").
    (message as unknown as { text: (s: string) => unknown }).text("");
  } catch (err) {
    emptyTextCaught = err;
  }
  checks["message.text('') throws FilterValidationError(empty_substring)"] =
    emptyTextCaught instanceof FilterValidationError &&
    (emptyTextCaught as { code?: string }).code === "empty_substring";

  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) failed.push(label);
  }

  if (failed.length > 0) {
    return { ok: false, sentinel: "wats191-legacy-removal:fail", checks, failed };
  }
  return { ok: true, sentinel: "wats191-legacy-removal:ok", checks };
}

const report = verify();
console.log(JSON.stringify(report));
console.log(report.sentinel);
if (!report.ok) {
  process.exit(1);
}
process.exit(0);
