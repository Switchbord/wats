# @wats/internal-utils

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

Docs: https://github.com/Switchbord/wats
License: MIT
