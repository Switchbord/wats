# Handlers Overview

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-21

## Goal

Show end-to-end C2 usage for parsing webhook updates and routing events to handlers.

## Minimal parser + router flow

```ts
import { createUpdateRouter, parseWebhookUpdate } from "@switchbord/core";

const router = createUpdateRouter({
  maxHandlersPerEvent: 25,
  maxDispatches: 500
});

// If omitted, secure defaults apply:
// - maxHandlersPerEvent: 64
// - maxDispatches: 10_000

router.on({ field: "messages" }, async (event) => {
  // Handles all message-related changes
  console.log("message event", event.discriminator.eventType);
});

router.on({ field: "messages", subtype: "message_status" }, async (event) => {
  // Handles only status updates
  console.log("message status", event.change.value.statuses);
});

export async function processWebhookEnvelope(rawEnvelope: unknown) {
  const parsed = parseWebhookUpdate(rawEnvelope, {
    maxEntries: 100,
    maxChangesPerEntry: 250,
    maxTotalEvents: 5_000
  });

  if (!parsed.ok) {
    return {
      accepted: false,
      reason: parsed.error
    };
  }

  const dispatch = await router.dispatch(parsed.events);

  return {
    accepted: true,
    eventCount: parsed.events.length,
    skippedEntries: parsed.skippedEntries,
    skippedChanges: parsed.skippedChanges,
    dispatch
  };
}
```

## Routing behavior summary

- Registration is additive; multiple handlers can be attached to the same field/subtype.
- Dispatch order is deterministic by registration sequence.
- Field-only handlers match all subtypes under that field.
- Handler exceptions are recorded in dispatch summary and do not stop subsequent handlers.
- Router caps are finite by default (64 handlers/event, 10_000 total dispatches) and can be overridden with positive integers.

## Notes

- Keep parser/router in transport-independent layers; bind HTTP framework code separately.
- Use parser skip counters (`skippedEntries`, `skippedChanges`) to detect degraded best-effort parses.
- Use dispatch summary counters and safety flags (`capped`, `aborted`, `limitError`) for tests, telemetry, and alerting.
