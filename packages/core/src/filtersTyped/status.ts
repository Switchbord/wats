// @switchbord/core — filtersTyped/status.ts (F-9 GREEN)
//
// The `status` export is BOTH a kind-filter (narrow TypedUpdate to
// TypedStatusUpdate) AND a namespace carrying the four message-status
// built-ins: `sent`, `delivered`, `read`, `failed`. `deleted` and
// per-error-code matchers are forward-declared — consumers compose
// via `custom(predicate)` in the interim.

import type { TypedStatusUpdate, TypedUpdate } from "../webhookNormalizer";
import type { WhatsAppMessageStatusKind } from "@switchbord/types";
import { FILTER_BRAND, type TypedFilter } from "./typedFilter";

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
      failed: (): TypedFilter<TypedStatusUpdate> =>
        buildStatusFilter("failed", "status.failed()")
    }
  )
);
