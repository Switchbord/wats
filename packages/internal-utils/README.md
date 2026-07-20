# @wats/internal-utils

> Published internal support package for WATS workspace packages. It is published only so `npm install` / `bun install` resolves runtime dependencies for the public `@wats/*` packages. Do not import it directly from application code. There is no stability guarantee; exports, names, and shapes change without notice. See [api-stability](https://wats.sh/docs/meta/api-stability).

This package is not a stable application API. Anything useful is re-exported through a public package's `exports` map instead.

## Install

```bash
bun add @wats/internal-utils
npm i @wats/internal-utils
```

Application code should prefer public packages such as `@wats/config`, `@wats/graph`, `@wats/http`, and `@wats/service`. This package has no stable application API guarantee.

Exports:

- `isRecord(value: unknown): value is Record<string, unknown>` — rigorous plain-object guard (rejects arrays, class instances, Date, etc.).
- `containsUnsafePathSegment(value: unknown): boolean` — path-segment safety guard (rejects traversal, encoded variants, control chars, colon, etc.).

Docs: https://wats.sh/docs/reference/internal-utils
License: MIT
