import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWebhookUpdate, type ParsedUpdateEvent } from "../src/updateParser";
import {
  and,
  hasMessageStatus,
  hasMessageText,
  messageFromWaId,
  messageStatusIn,
  messageTextContains,
  not,
  or,
  type UpdateFilter
} from "../src/filters";

function readFixture(name: string): unknown {
  const fixturePath = join(import.meta.dir, "../../testing/fixtures/updates", name);
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

function parseFirstEvent(name: string): ParsedUpdateEvent {
  const parsed = parseWebhookUpdate(readFixture(name));
  if (!parsed.ok) {
    throw new Error(`Fixture parse failed: ${parsed.error.code}`);
  }

  const event = parsed.events[0];
  if (event === undefined) {
    throw new Error(`Fixture ${name} did not include an event`);
  }

  return event;
}

function buildEvent(value: Record<string, unknown>): ParsedUpdateEvent {
  return {
    object: "whatsapp_business_account",
    discriminator: {
      field: "messages",
      eventType: "messages"
    },
    entry: {
      index: 0
    },
    change: {
      index: 0,
      value
    },
    raw: {
      entry: {},
      change: {}
    }
  };
}

function buildEventWithUnknownValue(value: unknown): ParsedUpdateEvent {
  return buildEvent(value as Record<string, unknown>);
}

describe("D1 filters", () => {
  test("combinator truth tables: and/or/not", () => {
    const trueFilter: UpdateFilter = () => true;
    const falseFilter: UpdateFilter = () => false;
    const event = buildEvent({});

    expect(and(trueFilter, trueFilter)(event)).toBe(true);
    expect(and(trueFilter, falseFilter)(event)).toBe(false);
    expect(and(falseFilter, trueFilter)(event)).toBe(false);
    expect(and(falseFilter, falseFilter)(event)).toBe(false);

    expect(or(trueFilter, trueFilter)(event)).toBe(true);
    expect(or(trueFilter, falseFilter)(event)).toBe(true);
    expect(or(falseFilter, trueFilter)(event)).toBe(true);
    expect(or(falseFilter, falseFilter)(event)).toBe(false);

    expect(not(trueFilter)(event)).toBe(false);
    expect(not(falseFilter)(event)).toBe(true);

    expect(and()(event)).toBe(true);
    expect(or()(event)).toBe(false);
  });

  test("built-in message filters: positive and negative cases", () => {
    const incomingText = parseFirstEvent("incoming-text-message.json");
    const outgoingStatus = parseFirstEvent("outgoing-status-read.json");

    expect(hasMessageText(incomingText)).toBe(true);
    expect(hasMessageText(outgoingStatus)).toBe(false);

    expect(messageTextContains("help")(incomingText)).toBe(true);
    expect(messageTextContains("HELP")(incomingText)).toBe(true);
    expect(messageTextContains("HELP", { caseSensitive: true })(incomingText)).toBe(false);
    expect(messageTextContains("missing")(incomingText)).toBe(false);

    expect(messageFromWaId("15551234567")(incomingText)).toBe(true);
    expect(messageFromWaId("15550000000")(incomingText)).toBe(false);
  });

  test("built-in status filters: positive and negative cases", () => {
    const statusEvent = parseFirstEvent("outgoing-status-read.json");
    const textEvent = parseFirstEvent("incoming-text-message.json");

    expect(hasMessageStatus(statusEvent)).toBe(true);
    expect(hasMessageStatus(textEvent)).toBe(false);

    expect(messageStatusIn("read")(statusEvent)).toBe(true);
    expect(messageStatusIn("sent", "delivered", "read")(statusEvent)).toBe(true);
    expect(messageStatusIn("sent", "failed")(statusEvent)).toBe(false);
  });

  test("built-ins are safe against missing/partial payload values", () => {
    const empty = buildEvent({});
    const partial = buildEvent({
      messages: [{ text: {} }],
      contacts: [{}],
      statuses: [{ status: 10 }]
    });

    const filters = [
      hasMessageText,
      messageTextContains("hello"),
      messageFromWaId("15551234567"),
      hasMessageStatus,
      messageStatusIn("read")
    ];

    for (const filter of filters) {
      expect(() => filter(empty)).not.toThrow();
      expect(() => filter(partial)).not.toThrow();
      expect(filter(empty)).toBe(false);
      expect(filter(partial)).toBe(false);
    }
  });

  test("built-ins are safe when change.value is null/non-object/array", () => {
    const malformedEvents = [
      buildEventWithUnknownValue(null),
      buildEventWithUnknownValue("bad"),
      buildEventWithUnknownValue(42),
      buildEventWithUnknownValue(true),
      buildEventWithUnknownValue([])
    ];

    const filters = [
      hasMessageText,
      messageTextContains("hello"),
      messageFromWaId("15551234567"),
      hasMessageStatus,
      messageStatusIn("read")
    ];

    for (const event of malformedEvents) {
      for (const filter of filters) {
        expect(() => filter(event)).not.toThrow();
        expect(filter(event)).toBe(false);
      }
    }
  });

  test("messageTextContains uses deterministic lowercase semantics", () => {
    const event = buildEvent({
      messages: [{ text: { body: "HELLO" } }]
    });

    const original = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = function (): string {
      throw new Error("locale-dependent path should not be used");
    };

    try {
      expect(messageTextContains("hello")(event)).toBe(true);
    } finally {
      String.prototype.toLocaleLowerCase = original;
    }
  });

  test("messageTextContains is runtime-safe for malformed factory arguments", () => {
    const event = buildEvent({
      messages: [{ text: { body: "HELLO" } }]
    });

    const numericQueryFilter = messageTextContains(123 as unknown as string);
    expect(() => numericQueryFilter(event)).not.toThrow();
    expect(numericQueryFilter(event)).toBe(false);

    const nullOptionsFilter = messageTextContains(
      "hello",
      null as unknown as { caseSensitive?: boolean }
    );
    expect(() => nullOptionsFilter(event)).not.toThrow();
    expect(nullOptionsFilter(event)).toBe(true);

    const undefinedQueryFilter = messageTextContains(undefined as unknown as string);
    expect(() => undefinedQueryFilter(event)).not.toThrow();
    expect(undefinedQueryFilter(event)).toBe(false);
  });

  test("combinators require strict boolean true for pass-through", () => {
    const event = buildEvent({});
    const unsafeTruthyFilter = (() => "true") as unknown as UpdateFilter;

    expect(and(unsafeTruthyFilter)(event)).toBe(false);
    expect(or(unsafeTruthyFilter)(event)).toBe(false);
    expect(not(unsafeTruthyFilter)(event)).toBe(true);
  });

  test("supports composition with and/or/not", () => {
    const messageEvent = parseFirstEvent("incoming-text-message.json");
    const statusEvent = parseFirstEvent("outgoing-status-read.json");

    const composed = and(
      hasMessageText,
      or(messageTextContains("order"), messageTextContains("help")),
      not(messageFromWaId("00000000000"))
    );

    expect(composed(messageEvent)).toBe(true);
    expect(composed(statusEvent)).toBe(false);
  });
});
