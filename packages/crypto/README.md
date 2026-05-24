# @wats/crypto

Portable crypto-provider seam for WATS signature verification and cryptographic operations across Bun, Node, WebCrypto, and test doubles.

## Install

```bash
bun add @wats/crypto
npm i @wats/crypto
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

Docs: https://github.com/Switchbord/wats
License: MIT
