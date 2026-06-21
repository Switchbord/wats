// Node/Bun adapter tests (F-2).
//
// Runs the shared adapter contract against createNodeCryptoProvider(),
// which internally uses `await import("node:crypto")`. Bun supports the
// `node:crypto` specifier natively so this suite runs under `bun test`.

import { createNodeCryptoProvider } from "../src/adapters/node/index";
import {
  registerAdapterContractSuite,
  registerAdapterShaCbcSuite
} from "./adapter-contract";

registerAdapterContractSuite("node-adapter", createNodeCryptoProvider);
registerAdapterShaCbcSuite("node-adapter", createNodeCryptoProvider);
