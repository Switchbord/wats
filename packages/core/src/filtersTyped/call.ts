// @switchbord/core — typed calling filters (WATS-41).

import type {
  CallDirection,
  CallStatusType,
  TypedCallStatusUpdate,
  TypedCallUpdate,
  TypedUpdate
} from "../webhookNormalizer";
import { FILTER_BRAND, type TypedFilter } from "./typedFilter";

type AnyCallUpdate = TypedCallUpdate | TypedCallStatusUpdate;

function isCallUpdate(u: TypedUpdate): u is AnyCallUpdate {
  return u.kind === "callConnect" || u.kind === "callTerminate" || u.kind === "callStatus";
}

function buildCallFilter<T extends AnyCallUpdate>(
  predicate: (u: TypedUpdate) => u is T,
  label: string
): TypedFilter<T> {
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => label
  });
}

function callEvent(kind: "callConnect" | "callTerminate", label: string): TypedFilter<TypedCallUpdate> {
  return buildCallFilter((u: TypedUpdate): u is TypedCallUpdate => u.kind === kind, label);
}

function callStatusFilter(status: CallStatusType, label: string): TypedFilter<TypedCallStatusUpdate> {
  return buildCallFilter(
    (u: TypedUpdate): u is TypedCallStatusUpdate =>
      u.kind === "callStatus" && u.callStatus.status === status,
    label
  );
}

function callDirectionFilter(direction: CallDirection, label: string): TypedFilter<TypedCallUpdate> {
  return buildCallFilter(
    (u: TypedUpdate): u is TypedCallUpdate =>
      (u.kind === "callConnect" || u.kind === "callTerminate") && u.call.direction === direction,
    label
  );
}

export interface CallFilterNamespace extends TypedFilter<AnyCallUpdate> {
  connect(): TypedFilter<TypedCallUpdate>;
  terminate(): TypedFilter<TypedCallUpdate>;
  status(): TypedFilter<TypedCallStatusUpdate>;
  ringing(): TypedFilter<TypedCallStatusUpdate>;
  answered(): TypedFilter<TypedCallStatusUpdate>;
  rejected(): TypedFilter<TypedCallStatusUpdate>;
  incoming(): TypedFilter<TypedCallUpdate>;
  outgoing(): TypedFilter<TypedCallUpdate>;
}

export const call: CallFilterNamespace = Object.freeze(
  Object.assign(
    {
      [FILTER_BRAND]: true as const,
      predicate: isCallUpdate,
      describe: (): string => "call"
    },
    {
      connect: (): TypedFilter<TypedCallUpdate> => callEvent("callConnect", "call.connect()"),
      terminate: (): TypedFilter<TypedCallUpdate> => callEvent("callTerminate", "call.terminate()"),
      status: (): TypedFilter<TypedCallStatusUpdate> => buildCallFilter((u: TypedUpdate): u is TypedCallStatusUpdate => u.kind === "callStatus", "call.status()"),
      ringing: (): TypedFilter<TypedCallStatusUpdate> => callStatusFilter("RINGING", "call.ringing()"),
      answered: (): TypedFilter<TypedCallStatusUpdate> => callStatusFilter("ACCEPTED", "call.answered()"),
      rejected: (): TypedFilter<TypedCallStatusUpdate> => callStatusFilter("REJECTED", "call.rejected()"),
      incoming: (): TypedFilter<TypedCallUpdate> => callDirectionFilter("USER_INITIATED", "call.incoming()"),
      outgoing: (): TypedFilter<TypedCallUpdate> => callDirectionFilter("BUSINESS_INITIATED", "call.outgoing()")
    }
  )
);
