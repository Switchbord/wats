# Filters Recipes

- status: active
- decisionStatus: locked
- labels: [camelCaseOnly, asyncOnly, aggressiveParity, monorepo]
- owner: TBD
- lastReviewed: 2026-04-21

## Goal

Show practical composition patterns for D1 filter primitives.

## Recipe 1: inbound text from specific customer

```ts
import { and, hasMessageText, messageFromWaId } from "@wats/core/filters";

const fromCustomer = and(
  hasMessageText,
  messageFromWaId("15551234567")
);
```

## Recipe 2: case-insensitive keyword routing

```ts
import { and, hasMessageText, messageTextContains } from "@wats/core/filters";

const containsOrderKeyword = and(
  hasMessageText,
  messageTextContains("order")
);
```

## Recipe 3: strict case-sensitive keyword routing

```ts
import { and, hasMessageText, messageTextContains } from "@wats/core/filters";

const containsExactToken = and(
  hasMessageText,
  messageTextContains("SKU-ABC", { caseSensitive: true })
);
```

## Recipe 4: status monitoring for selected states

```ts
import { and, hasMessageStatus, messageStatusIn } from "@wats/core/filters";

const terminalStatuses = and(
  hasMessageStatus,
  messageStatusIn("read", "failed")
);
```

## Recipe 5: combine message and status branches

```ts
import {
  and,
  hasMessageStatus,
  hasMessageText,
  messageStatusIn,
  messageTextContains,
  or
} from "@wats/core/filters";

const actionableEvent = or(
  and(hasMessageText, messageTextContains("help")),
  and(hasMessageStatus, messageStatusIn("failed"))
);
```

## Recipe 6: exclude internal sender ids

```ts
import { and, hasMessageText, messageFromWaId, not } from "@wats/core/filters";

const customerOnly = and(
  hasMessageText,
  not(messageFromWaId("15550000000"))
);
```

## Notes

- Built-ins are safe on malformed payloads and return `false` when required fields are absent.
- Built-ins defensively return `false` when `change.value` is null, a non-object primitive, or an array.
- `messageTextContains` case-insensitive matching uses deterministic `toLowerCase()` normalization.
- Defensive runtime behavior: malformed `messageTextContains` factory args do not throw; non-string `query` resolves to an always-false predicate and null/non-object `options` fall back to defaults.
- Combinators treat only `filter(event) === true` as pass for `and`/`or`; avoid non-boolean predicate returns.
- Compose small predicates to keep routing logic testable and deterministic.
