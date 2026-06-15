// F-9 RED — typedFilter surface: brand + createTypedFilter +
// FilterValidationError + isTypedFilter + and/or/not/custom
// combinators + kind filters (message/status/account/unknown).
// Drives the GREEN implementation; expects the stub surface in
// `packages/core/src/filtersTyped/*` to throw until F-9 GREEN.

import { describe, expect, test } from "bun:test";
import type {
  TypedAccountUpdate,
  TypedMessageUpdate,
  TypedStatusUpdate,
  TypedUnknownUpdate,
  TypedUpdate
} from "../../src/webhookNormalizer";
import {
  FILTER_BRAND,
  FilterValidationError,
  account,
  and,
  createTypedFilter,
  custom,
  isTypedFilter,
  message,
  not,
  or,
  status,
  unknown,
  type TypedFilter
} from "../../src/filtersTyped/index";

// ---------------- update factories --------------------------------

function msgUpdate(body = "hello world", type: string = "text", from = "15551234567"): TypedMessageUpdate {
  return {
    kind: "message",
    updateId: "wamid.X",
    phoneNumberId: "111",
    wabaId: "W",
    receivedAt: 1,
    message: {
      id: "wamid.X",
      type: type as "text",
      from,
      timestamp: "1",
      text: { body }
    } as TypedMessageUpdate["message"],
    rawChange: {} as TypedMessageUpdate["rawChange"]
  };
}

function statusUpdate(s: "sent" | "delivered" | "read" | "failed" = "delivered"): TypedStatusUpdate {
  return {
    kind: "status",
    updateId: "wamid.S",
    phoneNumberId: "111",
    wabaId: "W",
    receivedAt: 1,
    status: {
      id: "wamid.S",
      recipientId: "15551234567",
      status: s,
      timestamp: "1"
    },
    rawChange: {} as TypedStatusUpdate["rawChange"]
  };
}

function accountUpdate(): TypedAccountUpdate {
  return {
    kind: "account",
    updateId: "acct.1",
    wabaId: "W",
    receivedAt: 1,
    eventName: "account_update",
    payload: {},
    rawChange: {} as TypedAccountUpdate["rawChange"]
  };
}

function unknownUpdate(): TypedUnknownUpdate {
  return {
    kind: "unknown",
    updateId: "u.1",
    wabaId: "W",
    receivedAt: 1,
    field: "some_future_field",
    rawChange: {} as TypedUnknownUpdate["rawChange"]
  };
}

// ---------------- createTypedFilter --------------------------------

describe("F-9 createTypedFilter + brand + isTypedFilter", () => {
  test("returns a branded object with predicate + describe", () => {
    const f = createTypedFilter<TypedMessageUpdate>(
      (u): u is TypedMessageUpdate => u.kind === "message",
      () => "manual-message"
    );
    expect(f[FILTER_BRAND]).toBe(true);
    expect(typeof f.predicate).toBe("function");
    expect(f.describe()).toBe("manual-message");
    expect(isTypedFilter(f)).toBe(true);
  });

  test("FILTER_BRAND is a registered symbol across module boundaries", () => {
    // `Symbol.for` interns globally — any other module importing
    // `@wats/core/filtersTyped` sees the same symbol.
    // FILTER_BRAND is a `unique symbol`; widen the matcher to plain `symbol`
    // so the runtime registered-symbol identity check typechecks.
    expect<symbol>(FILTER_BRAND).toBe(Symbol.for("@wats/core/filter-brand"));
    expect(typeof FILTER_BRAND).toBe("symbol");
  });

  test("isTypedFilter is false for plain objects, functions, null, arrays", () => {
    expect(isTypedFilter(null)).toBe(false);
    expect(isTypedFilter(undefined)).toBe(false);
    expect(isTypedFilter({})).toBe(false);
    expect(isTypedFilter([])).toBe(false);
    expect(isTypedFilter(() => true)).toBe(false);
    expect(isTypedFilter(42)).toBe(false);
    expect(isTypedFilter("message")).toBe(false);
    // Object shaped like a filter but missing the brand → false.
    const fake = { predicate: () => true, describe: () => "x" };
    expect(isTypedFilter(fake)).toBe(false);
  });

  test("createTypedFilter rejects non-function predicate", () => {
    expect(() =>
      createTypedFilter(
        123 as unknown as (u: TypedUpdate) => u is TypedMessageUpdate,
        () => "bad"
      )
    ).toThrow(FilterValidationError);
  });

  test("createTypedFilter rejects non-function describe", () => {
    expect(() =>
      createTypedFilter(
        (u: TypedUpdate): u is TypedMessageUpdate => u.kind === "message",
        "not-a-function" as unknown as () => string
      )
    ).toThrow(FilterValidationError);
  });

  test("FilterValidationError carries .code and a stable .name", () => {
    const err = new FilterValidationError("empty_args", "no filters");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("FilterValidationError");
    expect(err.code).toBe("empty_args");
    expect(err.message).toContain("no filters");
  });
});

// ---------------- kind filters -------------------------------------

describe("F-9 kind filters: message / status / account / unknown", () => {
  test("message kind-filter matches TypedMessageUpdate only", () => {
    expect(isTypedFilter(message)).toBe(true);
    expect(message.predicate(msgUpdate())).toBe(true);
    // Sibling-NOT: status / account / unknown must be false.
    expect(message.predicate(statusUpdate())).toBe(false);
    expect(message.predicate(accountUpdate())).toBe(false);
    expect(message.predicate(unknownUpdate())).toBe(false);
    expect(message.describe()).toBe("message");
  });

  test("status kind-filter matches TypedStatusUpdate only", () => {
    expect(isTypedFilter(status)).toBe(true);
    expect(status.predicate(statusUpdate())).toBe(true);
    expect(status.predicate(msgUpdate())).toBe(false);
    expect(status.predicate(accountUpdate())).toBe(false);
    expect(status.predicate(unknownUpdate())).toBe(false);
    expect(status.describe()).toBe("status");
  });

  test("account kind-filter matches TypedAccountUpdate only", () => {
    expect(isTypedFilter(account)).toBe(true);
    expect(account.predicate(accountUpdate())).toBe(true);
    expect(account.predicate(msgUpdate())).toBe(false);
    expect(account.predicate(statusUpdate())).toBe(false);
    expect(account.predicate(unknownUpdate())).toBe(false);
    expect(account.describe()).toBe("account");
  });

  test("unknown kind-filter matches TypedUnknownUpdate only", () => {
    expect(isTypedFilter(unknown)).toBe(true);
    expect(unknown.predicate(unknownUpdate())).toBe(true);
    expect(unknown.predicate(msgUpdate())).toBe(false);
    expect(unknown.predicate(statusUpdate())).toBe(false);
    expect(unknown.predicate(accountUpdate())).toBe(false);
    expect(unknown.describe()).toBe("unknown");
  });

  test("applying a kind filter never throws even on wrong-kind inputs", () => {
    // Sibling-kind must produce a boolean (not throw).
    expect(() => message.predicate(statusUpdate())).not.toThrow();
    expect(() => status.predicate(msgUpdate())).not.toThrow();
    expect(() => account.predicate(msgUpdate())).not.toThrow();
    expect(() => unknown.predicate(msgUpdate())).not.toThrow();
  });
});

// ---------------- combinators --------------------------------------

describe("F-9 combinators: and / or / not / custom", () => {
  const alwaysTrue = createTypedFilter<TypedUpdate>(
    (_u): _u is TypedUpdate => true,
    () => "T"
  );
  const alwaysFalse = createTypedFilter<TypedUpdate>(
    (_u): _u is TypedUpdate => false,
    () => "F"
  );

  test("and: truth table", () => {
    const m = msgUpdate();
    expect(and(alwaysTrue, alwaysTrue).predicate(m)).toBe(true);
    expect(and(alwaysTrue, alwaysFalse).predicate(m)).toBe(false);
    expect(and(alwaysFalse, alwaysTrue).predicate(m)).toBe(false);
    expect(and(alwaysFalse, alwaysFalse).predicate(m)).toBe(false);
    expect(and(alwaysTrue).predicate(m)).toBe(true);
  });

  test("or: truth table", () => {
    const m = msgUpdate();
    expect(or(alwaysTrue, alwaysTrue).predicate(m)).toBe(true);
    expect(or(alwaysTrue, alwaysFalse).predicate(m)).toBe(true);
    expect(or(alwaysFalse, alwaysTrue).predicate(m)).toBe(true);
    expect(or(alwaysFalse, alwaysFalse).predicate(m)).toBe(false);
  });

  test("not: inverts", () => {
    const m = msgUpdate();
    expect(not(alwaysTrue).predicate(m)).toBe(false);
    expect(not(alwaysFalse).predicate(m)).toBe(true);
  });

  test("and/or reject zero args with FilterValidationError(empty_args)", () => {
    expect(() => and()).toThrow(FilterValidationError);
    expect(() => or()).toThrow(FilterValidationError);
    try {
      and();
    } catch (err) {
      expect(err).toBeInstanceOf(FilterValidationError);
      expect((err as FilterValidationError).code).toBe("empty_args");
    }
  });

  test("and/or/not reject non-filter args with FilterValidationError(not_a_filter)", () => {
    const notAFilter = { predicate: () => true, describe: () => "x" } as unknown as TypedFilter;
    expect(() => and(alwaysTrue, notAFilter)).toThrow(FilterValidationError);
    expect(() => or(notAFilter, alwaysTrue)).toThrow(FilterValidationError);
    expect(() => not(notAFilter)).toThrow(FilterValidationError);
    expect(() => not(null as unknown as TypedFilter)).toThrow(FilterValidationError);
    try {
      and(notAFilter);
    } catch (err) {
      expect((err as FilterValidationError).code).toBe("not_a_filter");
    }
  });

  test("and returns a branded filter whose describe contains the children", () => {
    const combined = and(message, alwaysTrue);
    expect(isTypedFilter(combined)).toBe(true);
    expect(combined.describe()).toMatch(/and/);
    expect(combined.describe()).toMatch(/message/);
  });

  test("composition: and(message, custom) narrows within message", () => {
    const isFromAlice = custom<TypedMessageUpdate>(
      (u): u is TypedMessageUpdate =>
        u.kind === "message" && u.message.from === "alice",
      "from=alice"
    );
    const filter = and(message, isFromAlice);
    expect(filter.predicate(msgUpdate("hi", "text", "alice"))).toBe(true);
    expect(filter.predicate(msgUpdate("hi", "text", "bob"))).toBe(false);
    // Sibling-NOT: not a message → false (message guard short-circuits).
    expect(filter.predicate(statusUpdate())).toBe(false);
  });

  test("custom rejects non-function predicate with FilterValidationError(invalid_predicate)", () => {
    expect(() =>
      custom(123 as unknown as (u: TypedUpdate) => u is TypedMessageUpdate)
    ).toThrow(FilterValidationError);
    try {
      custom(null as unknown as (u: TypedUpdate) => u is TypedMessageUpdate);
    } catch (err) {
      expect((err as FilterValidationError).code).toBe("invalid_predicate");
    }
  });

  test("custom propagates predicate throws (does NOT swallow)", () => {
    const boom = custom<TypedMessageUpdate>(
      (_u): _u is TypedMessageUpdate => {
        throw new Error("boom");
      },
      "boom"
    );
    expect(() => boom.predicate(msgUpdate())).toThrow("boom");
  });

  test("and short-circuits and propagates the first predicate's throw", () => {
    const boom = custom<TypedUpdate>(
      (_u): _u is TypedUpdate => {
        throw new Error("boom");
      },
      "boom"
    );
    // Inner throw must NOT be swallowed by the combinator.
    expect(() => and(boom, alwaysTrue).predicate(msgUpdate())).toThrow("boom");
  });
});
