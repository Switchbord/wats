// @switchbord/core — filtersTyped/combinators.ts (F-9 GREEN)
//
// and/or/not/custom combinators over the TypedFilter brand. All
// factories validate at construction (never swallow consumer errors)
// and short-circuit at evaluation. Inner predicate throws propagate;
// the router/dispatch layer (F-10) owns the final try/catch.

import type { TypedUpdate } from "../webhookNormalizer";
import {
  FILTER_BRAND,
  FilterValidationError,
  isTypedFilter,
  type TypedFilter
} from "./typedFilter";

function assertAllFilters(
  filters: readonly unknown[],
  label: "and" | "or"
): void {
  if (filters.length === 0) {
    throw new FilterValidationError(
      "empty_args",
      `${label}() requires at least one filter argument.`
    );
  }
  for (let i = 0; i < filters.length; i += 1) {
    if (!isTypedFilter(filters[i])) {
      throw new FilterValidationError(
        "not_a_filter",
        `${label}() argument at index ${i} is not a TypedFilter.`
      );
    }
  }
}

function joinDescriptions(
  op: "and" | "or",
  filters: readonly TypedFilter[]
): () => string {
  return () => {
    const parts: string[] = [];
    for (const f of filters) {
      parts.push(f.describe());
    }
    return `${op}(${parts.join(", ")})`;
  };
}

/**
 * Intersection of filters. Short-circuits on the first `false`. The
 * return type narrows to `TypedFilter<T>` for the simple homogeneous
 * case; heterogeneous `and(a, b)` narrows to the intersection (A & B)
 * at the call site via TypeScript's inference. Inner predicate throws
 * propagate unchanged.
 */
export function and<T extends TypedUpdate>(
  ...filters: readonly TypedFilter<T>[]
): TypedFilter<T> {
  assertAllFilters(filters, "and");
  const frozen = filters.slice();
  const predicate = (u: TypedUpdate): u is T => {
    for (const f of frozen) {
      if (!f.predicate(u)) {
        return false;
      }
    }
    return true;
  };
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: joinDescriptions("and", frozen)
  });
}

/**
 * Union of filters. Short-circuits on the first `true`.
 */
export function or<T extends TypedUpdate>(
  ...filters: readonly TypedFilter<T>[]
): TypedFilter<T> {
  assertAllFilters(filters, "or");
  const frozen = filters.slice();
  const predicate = (u: TypedUpdate): u is T => {
    for (const f of frozen) {
      if (f.predicate(u)) {
        return true;
      }
    }
    return false;
  };
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: joinDescriptions("or", frozen)
  });
}

/**
 * Inverts a filter. Note: `not(message)` does NOT narrow — the
 * returned TypedFilter is over the full TypedUpdate union because
 * "not a message" is still "might be a status/account/unknown".
 */
export function not<T extends TypedUpdate>(
  filter: TypedFilter<T>
): TypedFilter<TypedUpdate> {
  if (!isTypedFilter(filter)) {
    throw new FilterValidationError(
      "not_a_filter",
      "not() argument is not a TypedFilter."
    );
  }
  const inner = filter;
  const predicate = (u: TypedUpdate): u is TypedUpdate => !inner.predicate(u);
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => `not(${inner.describe()})`
  });
}

/**
 * Wraps an arbitrary type-guard predicate into a TypedFilter.
 * Synchronous by contract; if the predicate throws, the throw
 * propagates to whoever invokes the filter (or the enclosing
 * combinator).
 */
export function custom<T extends TypedUpdate>(
  predicate: (u: TypedUpdate) => u is T,
  describe?: string
): TypedFilter<T> {
  if (typeof predicate !== "function") {
    throw new FilterValidationError(
      "invalid_predicate",
      "custom() predicate must be a function."
    );
  }
  const label = typeof describe === "string" && describe.length > 0
    ? describe
    : "custom";
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => label
  });
}
