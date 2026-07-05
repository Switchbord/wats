import type { ParsedUpdateEvent } from "../updateParser.js";

/**
 * @deprecated WATS-176: the untyped `UpdateFilter` predicate is
 * superseded by the branded `TypedFilter` from `filtersTyped/typedFilter.ts`
 * (re-exported via the `filtersTyped` namespace). Typed filters narrow
 * `TypedUpdate` variants with compile-time safety. Scheduled for barrel
 * removal next minor.
 * @see TypedFilter
 */
export type UpdateFilter = (event: ParsedUpdateEvent) => boolean;

function isFilterPass(result: unknown): result is true {
  return result === true;
}

/**
 * @deprecated WATS-176: legacy boolean combinator. Use the typed
 * `and` from `filtersTyped/combinators.ts` (re-exported via the
 * `filtersTyped` namespace) instead. Scheduled for barrel removal
 * next minor.
 * @see filtersTyped.and
 */
export function and(...filters: readonly UpdateFilter[]): UpdateFilter {
  return (event) => {
    for (const filter of filters) {
      if (!isFilterPass(filter(event))) {
        return false;
      }
    }

    return true;
  };
}

/**
 * @deprecated WATS-176: legacy boolean combinator. Use the typed
 * `or` from `filtersTyped/combinators.ts` (re-exported via the
 * `filtersTyped` namespace) instead. Scheduled for barrel removal
 * next minor.
 * @see filtersTyped.or
 */
export function or(...filters: readonly UpdateFilter[]): UpdateFilter {
  return (event) => {
    for (const filter of filters) {
      if (isFilterPass(filter(event))) {
        return true;
      }
    }

    return false;
  };
}

/**
 * @deprecated WATS-176: legacy boolean combinator. Use the typed
 * `not` from `filtersTyped/combinators.ts` (re-exported via the
 * `filtersTyped` namespace) instead. Scheduled for barrel removal
 * next minor.
 * @see filtersTyped.not
 */
export function not(filter: UpdateFilter): UpdateFilter {
  return (event) => !isFilterPass(filter(event));
}
