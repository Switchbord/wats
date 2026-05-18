// @wats/core — filtersTyped/core.ts (F-9 GREEN)
//
// Pre-built "kind" filters narrowing TypedUpdate to each of its
// four discriminated-union variants. `message` and `status` live
// alongside their namespace built-ins in their own modules; this
// module hosts `account` and `unknown`, which have no built-in
// sub-factories in F-9.

import type {
  TypedAccountUpdate,
  TypedUnknownUpdate,
  TypedUpdate
} from "../webhookNormalizer.js";
import { FILTER_BRAND, type TypedFilter } from "./typedFilter.js";

/**
 * Factory used internally to manufacture a plain kind-filter. Not
 * exposed — consumers build their own filters via `createTypedFilter`
 * or by composing built-ins.
 */
export function kindFilter<T extends TypedUpdate>(
  kind: T["kind"],
  label: string
): TypedFilter<T> {
  const predicate = (u: TypedUpdate): u is T => u.kind === kind;
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => label
  });
}

export const account: TypedFilter<TypedAccountUpdate> = kindFilter<TypedAccountUpdate>(
  "account",
  "account"
);

export const unknown: TypedFilter<TypedUnknownUpdate> = kindFilter<TypedUnknownUpdate>(
  "unknown",
  "unknown"
);
