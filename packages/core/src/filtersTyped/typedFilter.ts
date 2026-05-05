// @switchbord/core — filtersTyped/typedFilter.ts (F-9 GREEN)
//
// Branded TypedFilter surface above the F-8 TypedUpdate discriminated
// union (see packages/core/src/webhookNormalizer.ts).
//
// Design:
//   - A TypedFilter<T> is an immutable, frozen object carrying a
//     FILTER_BRAND symbol, a user-defined type-guard predicate
//     `(u: TypedUpdate) => u is T`, and a `describe()` label for
//     logging / debugging.
//   - The brand uses `Symbol.for("@switchbord/core/filter-brand")` so
//     filters produced in a consumer package (or a sibling
//     @switchbord/* module) still identify as filters across module
//     boundaries under Bun / Node.
//   - All factories validate their inputs at construction time and
//     throw `FilterValidationError` with a stable `.code`. Predicates
//     are NEVER invoked at construction.
//   - Filters are pure and bounded: no caches, no global mutation,
//     no memoization. A combinator composes its children lazily at
//     predicate-invocation time.
//
// Predicate exception policy (WATS-14 L8, ADR-004):
//   - If a consumer-supplied `custom()` predicate throws, the
//     combinator MUST propagate the throw unchanged — swallowing it
//     would hide programmer error. Router/dispatch (F-10) will own
//     the final try/catch boundary.
//
// Injection defense (§4):
//   - Filters operate exclusively on in-memory TypedUpdate values.
//     They do not build URLs, headers, or execute dynamic code from
//     user-controlled content. Substring/RegExp matching targets the
//     post-normalized message body ONLY.

import type { TypedUpdate } from "../webhookNormalizer";

/**
 * Globally-interned brand symbol. Produced via `Symbol.for` so that
 * filter objects manufactured in a consumer workspace identify as
 * TypedFilter under this module's `isTypedFilter` guard.
 */
export const FILTER_BRAND: unique symbol = Symbol.for("@switchbord/core/filter-brand");

export interface TypedFilter<T extends TypedUpdate = TypedUpdate> {
  readonly [FILTER_BRAND]: true;
  readonly predicate: (update: TypedUpdate) => update is T;
  readonly describe: () => string;
}

export type FilterValidationErrorCode =
  | "empty_args"
  | "not_a_filter"
  | "invalid_pattern"
  | "invalid_predicate"
  | "empty_substring"
  | "invalid_describe";

export class FilterValidationError extends Error {
  readonly code: FilterValidationErrorCode;
  constructor(code: FilterValidationErrorCode, message?: string) {
    super(message ?? defaultMessageFor(code));
    this.name = "FilterValidationError";
    this.code = code;
  }
}

function defaultMessageFor(code: FilterValidationErrorCode): string {
  switch (code) {
    case "empty_args":
      return "Filter combinator requires at least one argument.";
    case "not_a_filter":
      return "Argument is not a TypedFilter (missing FILTER_BRAND).";
    case "invalid_pattern":
      return "Pattern is not a parseable RegExp.";
    case "invalid_predicate":
      return "Predicate must be a synchronous function.";
    case "empty_substring":
      return "Substring must be a non-empty string.";
    case "invalid_describe":
      return "describe must be a function returning a string.";
  }
}

/**
 * Brand check: returns true for any TypedFilter instance produced by
 * `createTypedFilter` or any of the built-in factories / combinators.
 * Never throws; accepts `unknown`.
 */
export function isTypedFilter(value: unknown): value is TypedFilter {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<PropertyKey, unknown>;
  if (record[FILTER_BRAND] !== true) {
    return false;
  }
  if (typeof record.predicate !== "function") {
    return false;
  }
  if (typeof record.describe !== "function") {
    return false;
  }
  return true;
}

/**
 * Construction-time factory. Validates predicate + describe are
 * functions, then builds a frozen branded object. Predicate is NOT
 * invoked here.
 */
export function createTypedFilter<T extends TypedUpdate>(
  predicate: (u: TypedUpdate) => u is T,
  describe: () => string
): TypedFilter<T> {
  if (typeof predicate !== "function") {
    throw new FilterValidationError(
      "invalid_predicate",
      "createTypedFilter: predicate must be a function."
    );
  }
  if (typeof describe !== "function") {
    throw new FilterValidationError(
      "invalid_describe",
      "createTypedFilter: describe must be a function returning a string."
    );
  }
  const filter: TypedFilter<T> = Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe
  });
  return filter;
}
