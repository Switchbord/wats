// Capability-detected factory selection tests (F-2).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCryptoProvider } from "../src/createCryptoProvider";
import { UnsupportedCapabilityError } from "../src/errors";

// Brand names embedded in adapter.name let us assert which adapter was
// installed without poking at internal identity.
const NODE_NAME = "node" as const;
const WEBCRYPTO_NAME = "webcrypto" as const;

describe("createCryptoProvider — default (no preference) on Bun", () => {
  test("returns a working provider", async () => {
    const provider = await createCryptoProvider();
    const mac = await provider.hmacSha256("key", "body");
    expect(mac).toBeInstanceOf(Uint8Array);
    expect(mac.byteLength).toBe(32);
  });

  test("default on Bun selects the node adapter (process.versions.node present OR globalThis.Bun present)", async () => {
    const provider = await createCryptoProvider();
    // On Bun, process.versions.node is defined AND globalThis.Bun is defined,
    // so the factory prefers the node adapter per the selection algorithm.
    expect(provider.name).toBe(NODE_NAME);
  });
});

describe("createCryptoProvider — explicit preference", () => {
  test("prefer:'webcrypto' returns the webcrypto adapter", async () => {
    const provider = await createCryptoProvider({ prefer: "webcrypto" });
    expect(provider.name).toBe(WEBCRYPTO_NAME);
  });

  test("prefer:'node' returns the node adapter on Bun", async () => {
    const provider = await createCryptoProvider({ prefer: "node" });
    expect(provider.name).toBe(NODE_NAME);
  });

  test("both adapters produce byte-for-byte identical HMAC output for the same input", async () => {
    const nodeProvider = await createCryptoProvider({ prefer: "node" });
    const webProvider = await createCryptoProvider({ prefer: "webcrypto" });
    const a = await nodeProvider.hmacSha256("Jefe", "what do ya want for nothing?");
    const b = await webProvider.hmacSha256("Jefe", "what do ya want for nothing?");
    expect(a.byteLength).toBe(b.byteLength);
    for (let i = 0; i < a.byteLength; i += 1) {
      expect(a[i]).toBe(b[i]!);
    }
  });
});

describe("createCryptoProvider — capability-detection fallback", () => {
  let savedCrypto: Crypto | undefined;
  let cryptoDeleted = false;

  beforeEach(() => {
    savedCrypto = (globalThis as { crypto?: Crypto }).crypto;
    cryptoDeleted = false;
  });

  afterEach(() => {
    if (cryptoDeleted && savedCrypto !== undefined) {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: savedCrypto
      });
    }
  });

  test("when webcrypto is unavailable and prefer='webcrypto', falls back to node", async () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: undefined
    });
    cryptoDeleted = true;

    const provider = await createCryptoProvider({ prefer: "webcrypto" });
    expect(provider.name).toBe(NODE_NAME);
  });

  test("unknown prefer value is rejected with UnsupportedCapabilityError", async () => {
    await expect(
      createCryptoProvider({ prefer: "bogus" as unknown as "node" })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });
});
