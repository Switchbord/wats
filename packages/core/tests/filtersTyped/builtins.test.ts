// F-9 RED — built-in message / status filter catalog.
// Drives the GREEN implementation of:
//   message.text / textMatches / textEquals / type / from
//   status.sent / delivered / read / failed
// plus sibling-kind safety (e.g., a status update passed to a message
// built-in returns false, never throws).

import { describe, expect, test } from "bun:test";
import type {
  TypedMessageUpdate,
  TypedStatusUpdate
} from "../../src/webhookNormalizer";
import {
  FilterValidationError,
  and,
  message,
  status
} from "../../src/filtersTyped/index";

function msg(body: string | undefined, type = "text", from = "1"): TypedMessageUpdate {
  const inner: Record<string, unknown> = {
    id: "wamid.X",
    type,
    from,
    timestamp: "1"
  };
  if (body !== undefined) {
    inner.text = { body };
  }
  return {
    kind: "message",
    updateId: "wamid.X",
    phoneNumberId: "111",
    wabaId: "W",
    receivedAt: 1,
    message: inner as TypedMessageUpdate["message"],
    rawChange: {} as TypedMessageUpdate["rawChange"]
  };
}

function stat(s: "sent" | "delivered" | "read" | "failed"): TypedStatusUpdate {
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

// ---------------- message.text ------------------------------------

describe("F-9 message.text built-in", () => {
  test("message.text() (no substring) matches any text message", () => {
    const f = message.text();
    expect(f.predicate(msg("hello"))).toBe(true);
    expect(f.predicate(msg(""))).toBe(true);
    // Non-text message → false (not a text).
    expect(f.predicate(msg(undefined, "image"))).toBe(false);
    // Sibling-kind → false, never throws.
    expect(f.predicate(stat("sent"))).toBe(false);
  });

  test("message.text('hello') matches substring case-sensitively by default", () => {
    const f = message.text("hello");
    expect(f.predicate(msg("hello world"))).toBe(true);
    expect(f.predicate(msg("HELLO WORLD"))).toBe(false);
    expect(f.predicate(msg("hi"))).toBe(false);
  });

  test("message.text rejects empty string substring with FilterValidationError(empty_substring)", () => {
    expect(() => message.text("")).toThrow(FilterValidationError);
    try {
      message.text("");
    } catch (err) {
      expect((err as FilterValidationError).code).toBe("empty_substring");
    }
  });

  test("message.text rejects non-string substring", () => {
    expect(() => message.text(123 as unknown as string)).toThrow(
      FilterValidationError
    );
  });
});

// ---------------- message.textMatches -----------------------------

describe("F-9 message.textMatches built-in", () => {
  test("accepts a RegExp and matches", () => {
    const f = message.textMatches(/hello/i);
    expect(f.predicate(msg("Hello World"))).toBe(true);
    expect(f.predicate(msg("goodbye"))).toBe(false);
  });

  test("accepts a string pattern and compiles it", () => {
    const f = message.textMatches("^hi\\b");
    expect(f.predicate(msg("hi there"))).toBe(true);
    expect(f.predicate(msg("hit me"))).toBe(false);
  });

  test("rejects unparseable string pattern with FilterValidationError(invalid_pattern)", () => {
    expect(() => message.textMatches("[")).toThrow(FilterValidationError);
    try {
      message.textMatches("(unclosed");
    } catch (err) {
      expect((err as FilterValidationError).code).toBe("invalid_pattern");
    }
  });

  test("rejects non-string non-RegExp pattern", () => {
    expect(() =>
      message.textMatches(42 as unknown as string)
    ).toThrow(FilterValidationError);
  });

  test("sibling-kind: passing a status update returns false (never throws)", () => {
    const f = message.textMatches(/x/);
    expect(f.predicate(stat("delivered"))).toBe(false);
  });
});

// ---------------- message.textEquals -----------------------------

describe("F-9 message.textEquals built-in", () => {
  test("exact match, case-sensitive", () => {
    const f = message.textEquals("hello");
    expect(f.predicate(msg("hello"))).toBe(true);
    expect(f.predicate(msg("Hello"))).toBe(false);
    expect(f.predicate(msg("hello world"))).toBe(false);
  });

  test("rejects non-string", () => {
    expect(() => message.textEquals(null as unknown as string)).toThrow(
      FilterValidationError
    );
  });
});

// ---------------- message.type -----------------------------------

describe("F-9 message.type built-in", () => {
  test("matches on the TypedMessageUpdate inner type discriminator", () => {
    const f = message.type("image");
    expect(f.predicate(msg(undefined, "image"))).toBe(true);
    expect(f.predicate(msg("hi", "text"))).toBe(false);
  });

  test("rejects empty string messageType", () => {
    expect(() =>
      message.type("" as unknown as "text")
    ).toThrow(FilterValidationError);
  });

  test("rejects non-string messageType", () => {
    expect(() =>
      message.type(42 as unknown as "text")
    ).toThrow(FilterValidationError);
  });

  test("sibling-kind: status update on message.type → false, no throw", () => {
    const f = message.type("text");
    expect(f.predicate(stat("delivered"))).toBe(false);
  });
});

// ---------------- message.from -----------------------------------

describe("F-9 message.from built-in", () => {
  test("matches on message.from", () => {
    const f = message.from("15551234567");
    expect(f.predicate(msg("hi", "text", "15551234567"))).toBe(true);
    expect(f.predicate(msg("hi", "text", "15559999999"))).toBe(false);
  });

  test("rejects empty phoneNumber", () => {
    expect(() => message.from("")).toThrow(FilterValidationError);
  });

  test("rejects non-string phoneNumber", () => {
    expect(() =>
      message.from(null as unknown as string)
    ).toThrow(FilterValidationError);
  });
});

// ---------------- status built-ins -------------------------------

describe("F-9 status.* built-ins", () => {
  test("status.sent matches only sent", () => {
    const f = status.sent();
    expect(f.predicate(stat("sent"))).toBe(true);
    expect(f.predicate(stat("delivered"))).toBe(false);
    expect(f.predicate(stat("read"))).toBe(false);
    expect(f.predicate(stat("failed"))).toBe(false);
  });

  test("status.delivered matches only delivered", () => {
    const f = status.delivered();
    expect(f.predicate(stat("delivered"))).toBe(true);
    expect(f.predicate(stat("sent"))).toBe(false);
  });

  test("status.read matches only read", () => {
    const f = status.read();
    expect(f.predicate(stat("read"))).toBe(true);
    expect(f.predicate(stat("delivered"))).toBe(false);
  });

  test("status.failed matches only failed", () => {
    const f = status.failed();
    expect(f.predicate(stat("failed"))).toBe(true);
    expect(f.predicate(stat("sent"))).toBe(false);
  });

  test("sibling-kind: message update on status.sent → false, no throw", () => {
    const f = status.sent();
    expect(f.predicate(msg("hi"))).toBe(false);
  });
});

// ---------------- F-9 remediation (RegExp statefulness) ----------

describe("F-9 remediation: message.textMatches RegExp statefulness", () => {
  test("/g flag: predicate is stateless across successive calls on identical body", () => {
    const f = message.textMatches(/hello/g);
    const update = msg("hello");
    // Before remediation: second call returns false because /g/ carried
    // lastIndex across invocations. After remediation: clone strips /g.
    expect(f.predicate(update)).toBe(true);
    expect(f.predicate(update)).toBe(true);
    expect(f.predicate(update)).toBe(true);
  });

  test("/y (sticky) flag: predicate is stateless across successive calls", () => {
    const f = message.textMatches(/hello/y);
    const update = msg("hello");
    expect(f.predicate(update)).toBe(true);
    expect(f.predicate(update)).toBe(true);
    expect(f.predicate(update)).toBe(true);
  });

  test("non-global, non-sticky RegExp: regression — behaviour unchanged", () => {
    const f = message.textMatches(/hello/);
    const update = msg("hello");
    expect(f.predicate(update)).toBe(true);
    expect(f.predicate(update)).toBe(true);
    expect(f.predicate(msg("goodbye"))).toBe(false);
  });

  test("new RegExp('x', 'g'): five successive predicate calls all true", () => {
    const f = message.textMatches(new RegExp("x", "g"));
    const update = msg("axb");
    for (let i = 0; i < 5; i++) {
      expect(f.predicate(update)).toBe(true);
    }
  });

  test("caller-owned regex is NOT mutated: lastIndex stays at 0", () => {
    const caller = /hello/g;
    expect(caller.lastIndex).toBe(0);
    const f = message.textMatches(caller);
    f.predicate(msg("hello"));
    // Under the bug, regex.test() on /hello/g against "hello" would
    // advance caller.lastIndex to 5. After remediation the closure
    // uses a clone, so the caller's regex is untouched.
    expect(caller.lastIndex).toBe(0);
    f.predicate(msg("hello"));
    expect(caller.lastIndex).toBe(0);
  });

  test("case-insensitive flag (/i) preserved across clone", () => {
    const f = message.textMatches(/hello/gi);
    expect(f.predicate(msg("HELLO"))).toBe(true);
    expect(f.predicate(msg("HELLO"))).toBe(true);
  });
});

// ---------------- composition smoke -------------------------------

describe("F-9 composition smoke", () => {
  test("and(message, message.textMatches(/hello/i)) works end-to-end", () => {
    const filter = and(message, message.textMatches(/hello/i));
    expect(filter.predicate(msg("Hello there"))).toBe(true);
    expect(filter.predicate(msg("goodbye"))).toBe(false);
    expect(filter.predicate(stat("sent"))).toBe(false);
  });
});
