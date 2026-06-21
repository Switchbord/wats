// WebCrypto adapter tests (F-2).
//
// Uses globalThis.crypto.subtle only. Bun exposes subtle natively, so
// this suite runs under `bun test` unchanged.

import { createWebCryptoProvider } from "../src/adapters/webcrypto/index";
import {
  registerAdapterContractSuite,
  registerAdapterShaCbcSuite
} from "./adapter-contract";

registerAdapterContractSuite("webcrypto-adapter", createWebCryptoProvider);
registerAdapterShaCbcSuite("webcrypto-adapter", createWebCryptoProvider);
