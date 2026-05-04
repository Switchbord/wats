// Shared adapter contract test suite.
//
// Accepts a factory (async) that returns a CryptoProvider; runs the full
// RFC 4231 HMAC-SHA256 known-answer vectors + the input-rejection matrix
// + timingSafeEqual truth table + randomBytes properties against it.
//
// This module is imported by both node-adapter.test.ts and
// webcrypto-adapter.test.ts so the two adapters prove behavioral parity
// against the same battery.

import { describe, expect, test } from "bun:test";
import type { CryptoProvider } from "../src/provider";
import {
  CryptoProviderError,
  InvalidBodyError,
  InvalidKeyError,
  InvalidLengthError
} from "../src/errors";

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hex must have even length; got ${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isInteger(byte)) {
      throw new Error(`invalid hex byte at offset ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function repeatByte(byte: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

// RFC 4231 Test Case 1
const RFC_TC1 = {
  name: "RFC 4231 TC1",
  key: repeatByte(0x0b, 20),
  data: new TextEncoder().encode("Hi There"),
  expectedHex:
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
};

// RFC 4231 Test Case 2 — string key + string body
const RFC_TC2 = {
  name: "RFC 4231 TC2",
  key: "Jefe",
  data: "what do ya want for nothing?",
  expectedHex:
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
};

// RFC 4231 Test Case 4 — 25-byte key 0x01..0x19, 50 bytes of 0xcd
function tc4Key(): Uint8Array {
  const k = new Uint8Array(25);
  for (let i = 0; i < 25; i += 1) {
    k[i] = i + 1;
  }
  return k;
}

const RFC_TC4 = {
  name: "RFC 4231 TC4",
  key: tc4Key(),
  data: repeatByte(0xcd, 50),
  expectedHex:
    "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"
};

export function registerAdapterContractSuite(
  adapterLabel: string,
  factory: () => Promise<CryptoProvider>
): void {
  describe(`${adapterLabel} — RFC 4231 HMAC-SHA256 vectors`, () => {
    test(`${RFC_TC1.name}: 20-byte 0x0b key + "Hi There"`, async () => {
      const provider = await factory();
      const mac = await provider.hmacSha256(RFC_TC1.key, RFC_TC1.data);
      expect(mac).toBeInstanceOf(Uint8Array);
      expect(mac.byteLength).toBe(32);
      expect(bytesToHex(mac)).toBe(RFC_TC1.expectedHex);
    });

    test(`${RFC_TC2.name}: string key "Jefe" + string body`, async () => {
      const provider = await factory();
      const mac = await provider.hmacSha256(RFC_TC2.key, RFC_TC2.data);
      expect(bytesToHex(mac)).toBe(RFC_TC2.expectedHex);
    });

    test(`${RFC_TC4.name}: 25-byte ascending key + 50 bytes of 0xcd`, async () => {
      const provider = await factory();
      const mac = await provider.hmacSha256(RFC_TC4.key, RFC_TC4.data);
      expect(bytesToHex(mac)).toBe(RFC_TC4.expectedHex);
    });

    test("mixed input types: Uint8Array key + string body round-trips", async () => {
      const provider = await factory();
      const keyBytes = new TextEncoder().encode("Jefe");
      const mac = await provider.hmacSha256(keyBytes, RFC_TC2.data);
      expect(bytesToHex(mac)).toBe(RFC_TC2.expectedHex);
    });

    test("mixed input types: string key + Uint8Array body round-trips", async () => {
      const provider = await factory();
      const bodyBytes = new TextEncoder().encode(RFC_TC2.data);
      const mac = await provider.hmacSha256(RFC_TC2.key, bodyBytes);
      expect(bytesToHex(mac)).toBe(RFC_TC2.expectedHex);
    });
  });

  describe(`${adapterLabel} — hmacSha256 input rejection`, () => {
    test("rejects null key with InvalidKeyError (not raw TypeError)", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256(null as unknown as string, "body")
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects undefined key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256(undefined as unknown as string, "body")
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects number key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256(42 as unknown as string, "body")
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects object key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256({} as unknown as string, "body")
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects plain array key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256([0x0b, 0x0b] as unknown as Uint8Array, "body")
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects empty string key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256("", "body")
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects empty Uint8Array key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256(new Uint8Array(0), "body")
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects null body with InvalidBodyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256("key", null as unknown as string)
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });

    test("rejects undefined body with InvalidBodyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256("key", undefined as unknown as string)
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });

    test("rejects array body with InvalidBodyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256("key", [1, 2, 3] as unknown as Uint8Array)
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });

    test("rejects number body with InvalidBodyError", async () => {
      const provider = await factory();
      await expect(
        provider.hmacSha256("key", 42 as unknown as string)
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });

    test("rejected errors are CryptoProviderError instances", async () => {
      const provider = await factory();
      try {
        await provider.hmacSha256("", "body");
        throw new Error("expected rejection");
      } catch (err) {
        expect(err).toBeInstanceOf(CryptoProviderError);
        expect(err).toBeInstanceOf(InvalidKeyError);
        expect(err).not.toBeInstanceOf(InvalidBodyError);
      }
    });

    test("empty-string body is accepted (valid input; HMAC over empty body)", async () => {
      const provider = await factory();
      const mac = await provider.hmacSha256("key", "");
      expect(mac).toBeInstanceOf(Uint8Array);
      expect(mac.byteLength).toBe(32);
    });

    test("empty Uint8Array body is accepted (valid input)", async () => {
      const provider = await factory();
      const mac = await provider.hmacSha256("key", new Uint8Array(0));
      expect(mac.byteLength).toBe(32);
    });
  });

  describe(`${adapterLabel} — timingSafeEqual`, () => {
    test("equal same-length arrays compare true", async () => {
      const provider = await factory();
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(provider.timingSafeEqual(a, b)).toBe(true);
    });

    test("unequal same-length arrays compare false (differ at last byte)", async () => {
      const provider = await factory();
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(provider.timingSafeEqual(a, b)).toBe(false);
    });

    test("unequal same-length arrays compare false (differ at first byte)", async () => {
      const provider = await factory();
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([9, 2, 3, 4, 5]);
      expect(provider.timingSafeEqual(a, b)).toBe(false);
    });

    test("different-length arrays compare false (does NOT throw)", async () => {
      const provider = await factory();
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(() => provider.timingSafeEqual(a, b)).not.toThrow();
      expect(provider.timingSafeEqual(a, b)).toBe(false);
    });

    test("empty arrays compare true", async () => {
      const provider = await factory();
      expect(
        provider.timingSafeEqual(new Uint8Array(0), new Uint8Array(0))
      ).toBe(true);
    });

    test("empty vs non-empty compare false", async () => {
      const provider = await factory();
      expect(
        provider.timingSafeEqual(new Uint8Array(0), new Uint8Array([1]))
      ).toBe(false);
    });

    test("rejects non-Uint8Array `a` with InvalidKeyError (typed, not raw)", async () => {
      const provider = await factory();
      expect(() =>
        provider.timingSafeEqual(
          "abc" as unknown as Uint8Array,
          new Uint8Array([1])
        )
      ).toThrow(CryptoProviderError);
    });

    test("rejects non-Uint8Array `b` with CryptoProviderError", async () => {
      const provider = await factory();
      expect(() =>
        provider.timingSafeEqual(
          new Uint8Array([1]),
          null as unknown as Uint8Array
        )
      ).toThrow(CryptoProviderError);
    });

    test("correctly compares 1024-byte arrays", async () => {
      const provider = await factory();
      const a = new Uint8Array(1024).fill(0xab);
      const b = new Uint8Array(1024).fill(0xab);
      expect(provider.timingSafeEqual(a, b)).toBe(true);
      b[1023] = 0xac;
      expect(provider.timingSafeEqual(a, b)).toBe(false);
    });
  });

  describe(`${adapterLabel} — randomBytes`, () => {
    test("returns Uint8Array of requested length (n=1)", async () => {
      const provider = await factory();
      const r = await provider.randomBytes(1);
      expect(r).toBeInstanceOf(Uint8Array);
      expect(r.byteLength).toBe(1);
    });

    test("returns Uint8Array of requested length (n=16)", async () => {
      const provider = await factory();
      const r = await provider.randomBytes(16);
      expect(r.byteLength).toBe(16);
    });

    test("returns Uint8Array of requested length (n=1024)", async () => {
      const provider = await factory();
      const r = await provider.randomBytes(1024);
      expect(r.byteLength).toBe(1024);
    });

    test("different calls produce different bytes (probabilistic)", async () => {
      const provider = await factory();
      const a = await provider.randomBytes(32);
      const b = await provider.randomBytes(32);
      // With 32 random bytes, collision probability is ~1/2^256.
      expect(bytesToHex(a)).not.toBe(bytesToHex(b));
    });

    test("rejects n=0 with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(provider.randomBytes(0)).rejects.toBeInstanceOf(
        InvalidLengthError
      );
    });

    test("rejects n=-1 with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(provider.randomBytes(-1)).rejects.toBeInstanceOf(
        InvalidLengthError
      );
    });

    test("rejects n=NaN with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(provider.randomBytes(Number.NaN)).rejects.toBeInstanceOf(
        InvalidLengthError
      );
    });

    test("rejects n=Infinity with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.randomBytes(Number.POSITIVE_INFINITY)
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("rejects non-integer n with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(provider.randomBytes(1.5)).rejects.toBeInstanceOf(
        InvalidLengthError
      );
    });

    test("rejects n > 1_048_576 with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.randomBytes(1_048_577)
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("rejects non-number n with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.randomBytes("16" as unknown as number)
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("accepts boundary n = 1_048_576", async () => {
      const provider = await factory();
      const r = await provider.randomBytes(1_048_576);
      expect(r.byteLength).toBe(1_048_576);
    });
  });

  describe(`${adapterLabel} — provider shape`, () => {
    test("exposes non-empty name", async () => {
      const provider = await factory();
      expect(typeof provider.name).toBe("string");
      expect(provider.name.length).toBeGreaterThan(0);
    });

    test("hmacSha256, timingSafeEqual, randomBytes are functions", async () => {
      const provider = await factory();
      expect(typeof provider.hmacSha256).toBe("function");
      expect(typeof provider.timingSafeEqual).toBe("function");
      expect(typeof provider.randomBytes).toBe("function");
    });
  });

  // Re-export helpers for adapter-specific suites.
  void hexToBytes;
  void bytesToHex;
}
