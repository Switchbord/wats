// @wats/core — filtersTyped/status.ts (F-9 GREEN)
//
// The `status` export is BOTH a kind-filter (narrow TypedUpdate to
// TypedStatusUpdate) AND a namespace carrying message-status
// built-ins: `sent`, `delivered`, `read`, `played`, `failed`. `deleted`,
// `warning`, and per-error-code matchers are forward-declared — consumers
// compose via `custom(predicate)` in the interim.

import type { TypedStatusUpdate, TypedUpdate } from "../webhookNormalizer.js";
import type { WhatsAppMessageStatusKind } from "@wats/types";
import { FILTER_BRAND, type TypedFilter } from "./typedFilter.js";

function isStatus(u: TypedUpdate): u is TypedStatusUpdate {
  return u.kind === "status";
}

function buildStatusFilter(
  expected: WhatsAppMessageStatusKind,
  label: string
): TypedFilter<TypedStatusUpdate> {
  const predicate = (u: TypedUpdate): u is TypedStatusUpdate => {
    if (!isStatus(u)) {
      return false;
    }
    return u.status.status === expected;
  };
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => label
  });
}

export interface StatusFilterNamespace extends TypedFilter<TypedStatusUpdate> {
  sent(): TypedFilter<TypedStatusUpdate>;
  delivered(): TypedFilter<TypedStatusUpdate>;
  read(): TypedFilter<TypedStatusUpdate>;
  played(): TypedFilter<TypedStatusUpdate>;
  failed(): TypedFilter<TypedStatusUpdate>;
}

const kindPredicate = (u: TypedUpdate): u is TypedStatusUpdate =>
  u.kind === "status";

export const status: StatusFilterNamespace = Object.freeze(
  Object.assign(
    {
      [FILTER_BRAND]: true as const,
      predicate: kindPredicate,
      describe: (): string => "status"
    },
    {
      sent: (): TypedFilter<TypedStatusUpdate> =>
        buildStatusFilter("sent", "status.sent()"),
      delivered: (): TypedFilter<TypedStatusUpdate> =>
        buildStatusFilter("delivered", "status.delivered()"),
      read: (): TypedFilter<TypedStatusUpdate> =>
        buildStatusFilter("read", "status.read()"),
      played: (): TypedFilter<TypedStatusUpdate> =>
        buildStatusFilter("played", "status.played()"),
      failed: (): TypedFilter<TypedStatusUpdate> =>
        buildStatusFilter("failed", "status.failed()")
    }
  )
);
