# @wats/crypto

Portable crypto-provider seam for WATS signature verification and cryptographic operations across Bun, Node, WebCrypto, and test doubles.

## Install

```bash
bun add @wats/crypto@0.5.0-beta
npm i @wats/crypto@0.5.0-beta
```

## Usage

```ts
import { createCryptoProvider } from "@wats/crypto";

const cryptoProvider = await createCryptoProvider();
const digest = await cryptoProvider.hmacSha256(
  "app-secret",
  new TextEncoder().encode("payload")
);

console.log(digest.byteLength);
```

The package is normally consumed indirectly through `@wats/http` or `@wats/service`, but direct use is available for applications that need the same portable crypto boundary.

Docs: https://wats.sh/docs/reference/crypto
License: MIT
