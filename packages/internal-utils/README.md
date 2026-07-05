# @wats/internal-utils

> Internal support for the `@wats/*` dependency closure. It is published only so `npm install` resolves runtime dependencies. Do not import it directly from application code. There is no stability guarantee; exports, names, and shapes change without notice. See [api-stability](https://wats.sh/docs/meta/api-stability).

Published internal support package for shared runtime helpers used by public WATS packages. It is published only so runtime dependencies resolve for npm installs.

## Install

```bash
bun add @wats/internal-utils
npm i @wats/internal-utils
```

## Usage

```ts
import { isRecord } from "@wats/internal-utils";

const value: unknown = { ok: true };
if (isRecord(value)) {
  console.log(Object.keys(value));
}
```

Application code should prefer public packages such as `@wats/config`, `@wats/graph`, `@wats/http`, and `@wats/service`. This package has no stable application API guarantee.

Docs: https://wats.sh/docs/reference/internal-utils
License: MIT
