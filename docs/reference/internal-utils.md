# `@switchbord/internal-utils` (internal)

- status: internal-support
- published: yes in the 0.2.1 alpha package set (`private: false`)
- introduced: F-0 of the WATS foundations pivot (2026-04-21)
- consumers: every WATS workspace package that previously duplicated the
  `isRecord` helper (core, graph, types). Migrations are absorbed into
  the F-step that next touches each package (F-1, F-4, F-5, F-8).

## Purpose

`@switchbord/internal-utils` hosts shared, runtime-pure helpers that WATS
workspace packages need in more than one place. It is explicitly
**internal support**: it is published only so public runtime packages such as
`@switchbord/config` install correctly from the registry, not as a stable application API.

Downstream application code should not depend on `@switchbord/internal-utils` as a
stable API. If a utility proves broadly useful to consumers, it should be
re-exported through a public package's own `exports` map (typically
`@switchbord/types` or `@switchbord/core`) rather than promoted here.

## Contract

```ts
export function isRecord(value: unknown): value is Record<string, unknown>;
```

`isRecord` returns `true` **only** when the argument is a plain object,
which the implementation defines as:

- `typeof value === "object"`,
- `value !== null`,
- `Array.isArray(value) === false`, and
- `Object.getPrototypeOf(value)` is either `Object.prototype` **or**
  `null` (null-prototype bags, as produced by `Object.create(null)`).

It returns `false` for every other runtime shape:

- `null`, `undefined`;
- primitives (`boolean`, `number`, `bigint`, `string`, `symbol`);
- arrays and typed arrays (`Uint8Array`, `Int16Array`, `ArrayBuffer`,
  `DataView`);
- functions (arrow, classic, async, generator);
- `Date`, `RegExp`, `Map`, `Set`, `WeakMap`, `WeakSet`, `Promise`;
- `Error` instances (including subclasses such as `TypeError`);
- class instances (anything whose prototype is not `Object.prototype`);
- `Proxy` wrappers over non-object targets (e.g. `new Proxy(fn, {})`).

Two subtle properties are explicitly guaranteed by tests:

1. `Proxy` wrappers over a plain object **do** narrow as records. This
   matches the Proxy specification: the prototype chain is transparently
   reflected through the default trap.
2. Tampered `toString` / `Symbol.toPrimitive` handlers do not affect the
   guard. `isRecord` only inspects the prototype chain via
   `Object.getPrototypeOf` and never coerces the value.

## Edge-runtime portability

`@switchbord/internal-utils` contains no `node:*` imports. It relies only on
`Object.getPrototypeOf` and `Array.isArray`, which are WinterCG-uniform.
This invariant is locked by
`packages/testing/tests/workspace-policy.test.ts` (scans the src tree)
and by `packages/testing/edge/module-resolver.test.ts` (imports the
specifier under the Bun edge-guard harness).

## Usage (inside WATS packages)

```ts
import { isRecord } from "@switchbord/internal-utils";

export function parseEntry(raw: unknown): Entry {
  if (!isRecord(raw)) {
    throw new UpdateParserError("invalid_entry", "expected object");
  }
  // `raw` is now typed Record<string, unknown>.
  // ...
}
```

## Versioning

Tracks the coordinated WATS alpha version line. It is published as internal
support only; semver stability is inherited from the public package that
depends on it, and application code should avoid direct reliance on it.
