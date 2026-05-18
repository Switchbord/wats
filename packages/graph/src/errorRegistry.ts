// F-5 Graph error code registry.
//
// Per-code / per-(code, subcode) mapping from Graph API error envelopes
// to concrete GraphApiError subclasses. Registered at module load for
// the built-in seed set from endpoint registry architecture (which mirrors pywa/errors.py); consumers
// may call registerErrorCode to layer app-specific subclasses on top.
//
// F-5 remediation (WATS-29): the built-in-seeding guard lives in THIS
// module as part of the registry state, so `clearErrorRegistry()`
// naturally resets it. This eliminates the previous footgun where
// clearing the registry + calling registerBuiltInErrorCodes() silently
// no-opped because the guard was maintained in errorSubclasses.ts.

import type { GraphApiError, GraphApiErrorPayload } from "./errors.js";

export interface GraphErrorFactoryContext {
  readonly payload: GraphApiErrorPayload | undefined;
  readonly status: number;
  readonly headers: Headers;
  readonly requestUrl: string;
}

export interface GraphErrorRegistryEntry {
  readonly code: number;
  readonly subcode?: number;
  readonly errorName: string;
  readonly factory: (context: GraphErrorFactoryContext) => GraphApiError;
}

/**
 * Keyed registry. Key shape:
 *   `${code}:${subcode}` — narrowest match
 *   `${code}:`           — any-subcode fallback
 */
const entries = new Map<string, GraphErrorRegistryEntry>();

/**
 * Built-in-seeding guard. Lives on the registry so `clearErrorRegistry()`
 * naturally resets it — preventing the F-5 footgun where clearing the
 * registry left this flag untouched and subsequent
 * `registerBuiltInErrorCodes()` calls silently no-opped.
 */
let builtInRegistered = false;

function keyFor(code: number, subcode: number | undefined): string {
  return subcode === undefined ? `${code}:` : `${code}:${subcode}`;
}

function validateEntry(entry: GraphErrorRegistryEntry): void {
  if (typeof entry !== "object" || entry === null) {
    throw new TypeError("registerErrorCode: entry must be an object");
  }
  if (typeof entry.code !== "number") {
    throw new TypeError(
      "registerErrorCode: entry.code must be a number"
    );
  }
  if (!Number.isFinite(entry.code)) {
    throw new RangeError(
      "registerErrorCode: entry.code must be a finite number"
    );
  }
  if (!Number.isInteger(entry.code)) {
    throw new RangeError(
      "registerErrorCode: entry.code must be an integer"
    );
  }
  if (entry.code < 0) {
    throw new RangeError(
      "registerErrorCode: entry.code must be non-negative"
    );
  }
  if (entry.subcode !== undefined) {
    if (typeof entry.subcode !== "number") {
      throw new TypeError(
        "registerErrorCode: entry.subcode must be a number when provided"
      );
    }
    if (!Number.isFinite(entry.subcode)) {
      throw new RangeError(
        "registerErrorCode: entry.subcode must be a finite number"
      );
    }
    if (!Number.isInteger(entry.subcode)) {
      throw new RangeError(
        "registerErrorCode: entry.subcode must be an integer when provided"
      );
    }
    if (entry.subcode < 0) {
      throw new RangeError(
        "registerErrorCode: entry.subcode must be non-negative when provided"
      );
    }
  }
  if (typeof entry.errorName !== "string" || entry.errorName.length === 0) {
    throw new TypeError(
      "registerErrorCode: entry.errorName must be a non-empty string"
    );
  }
  if (typeof entry.factory !== "function") {
    throw new TypeError(
      "registerErrorCode: entry.factory must be a function"
    );
  }
}

/**
 * Register (or replace) an entry for (code, subcode?). Last-writer-wins:
 * re-registering the same (code, subcode?) key replaces the prior entry.
 * This is intentional so consumers can layer overrides on top of the
 * built-in seeds without an explicit deregister step.
 */
export function registerErrorCode(entry: GraphErrorRegistryEntry): void {
  validateEntry(entry);
  entries.set(keyFor(entry.code, entry.subcode), entry);
}

/**
 * Reset the registry. Also clears the built-in-seeding guard so a
 * subsequent `registerBuiltInErrorCodes()` call re-seeds cleanly. This
 * is the ONLY public reset hook — the previous `clearErrorRegistryForTesting()`
 * has been removed; this function is now both the public entry point
 * AND the test-only re-seed hook.
 */
export function clearErrorRegistry(): void {
  entries.clear();
  builtInRegistered = false;
}

/**
 * Resolve the narrowest registered entry for (code, subcode).
 * Order:
 *   1. exact `(code, subcode)` when subcode provided;
 *   2. fall back to `(code, undefined)`;
 *   3. undefined when no entry matches.
 */
export function resolveRegisteredError(
  code: number,
  subcode: number | undefined
): GraphErrorRegistryEntry | undefined {
  if (subcode !== undefined) {
    const specific = entries.get(keyFor(code, subcode));
    if (specific !== undefined) {
      return specific;
    }
  }
  return entries.get(keyFor(code, undefined));
}

/**
 * Read-only view of every currently registered entry. Primarily for
 * diagnostics and docs generation.
 */
export function listRegisteredErrors(): readonly GraphErrorRegistryEntry[] {
  return Array.from(entries.values());
}

// ---------------------------------------------------------------------
// Built-in-seeding guard accessors. Exposed only to the subclasses
// module so the seeding function remains idempotent across re-imports.
// The flag is registry-module state, so `clearErrorRegistry()` resets
// it automatically.
// ---------------------------------------------------------------------

/** @internal — used by errorSubclasses' top-level seeding block. */
export function isBuiltInRegistered(): boolean {
  return builtInRegistered;
}

/** @internal — set by errorSubclasses after seeding completes. */
export function markBuiltInRegistered(): void {
  builtInRegistered = true;
}
