// @wats/crypto — capability-detected factory.
//
// Selection algorithm (per ADR-003):
//   1. If `options.prefer` is set, try that adapter first; on failure,
//      fall back to the other.
//   2. Otherwise prefer 'node' when running on Node or Bun
//      (process.versions.node is defined OR globalThis.Bun exists),
//      else prefer 'webcrypto'.
//   3. If the selected adapter raises UnsupportedCapabilityError, try
//      the other.
//   4. If both adapters fail capability detection, re-throw the last
//      UnsupportedCapabilityError.

import type { CryptoProvider } from "./provider";
import { UnsupportedCapabilityError } from "./errors";
import { createNodeCryptoProvider } from "./adapters/node/index";
import { createWebCryptoProvider } from "./adapters/webcrypto/index";

export interface CreateCryptoProviderOptions {
  readonly prefer?: "node" | "webcrypto";
}

interface ProcessShape {
  readonly versions?: { readonly node?: string };
  readonly release?: { readonly name?: string };
}

function detectDefaultAdapter(): "node" | "webcrypto" {
  const globalAny = globalThis as {
    readonly process?: ProcessShape;
    readonly Bun?: unknown;
  };
  const process = globalAny.process;
  const hasNodeVersion =
    typeof process?.versions?.node === "string" &&
    process.versions.node.length > 0;
  const hasBun = globalAny.Bun !== undefined;
  if (hasNodeVersion || hasBun) {
    return "node";
  }
  return "webcrypto";
}

async function tryAdapter(
  adapter: "node" | "webcrypto"
): Promise<CryptoProvider> {
  if (adapter === "node") {
    return createNodeCryptoProvider();
  }
  return createWebCryptoProvider();
}

export async function createCryptoProvider(
  options?: CreateCryptoProviderOptions
): Promise<CryptoProvider> {
  const prefer = options?.prefer;
  if (prefer !== undefined && prefer !== "node" && prefer !== "webcrypto") {
    throw new UnsupportedCapabilityError(
      `unknown crypto provider preference: ${String(prefer)}`
    );
  }

  const primary: "node" | "webcrypto" = prefer ?? detectDefaultAdapter();
  const secondary: "node" | "webcrypto" =
    primary === "node" ? "webcrypto" : "node";

  let firstError: unknown;
  try {
    return await tryAdapter(primary);
  } catch (err) {
    if (!(err instanceof UnsupportedCapabilityError)) {
      throw err;
    }
    firstError = err;
  }

  try {
    return await tryAdapter(secondary);
  } catch (err) {
    if (err instanceof UnsupportedCapabilityError) {
      throw new UnsupportedCapabilityError(
        `no usable CryptoProvider adapter found (primary=${primary}, secondary=${secondary})`,
        { cause: { primary: firstError, secondary: err } }
      );
    }
    throw err;
  }
}
