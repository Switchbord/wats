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

// ── sha256 + aesCbcDecrypt shared contract (WATS-151) ────────────────────────
//
// Both adapters must agree on the SHA-256 empty-string KAT and the AES-CBC
// round-trip / rejection matrix. The AES-CBC round-trip uses node:crypto to
// ENCRYPT (tests may use node:crypto directly) and the provider under test to
// DECRYPT — proving the provider reproduces the exact scheme.

import { createCipheriv } from "node:crypto";

function pkcs7Pad(plaintext: Uint8Array, blockSize = 16): Uint8Array {
  const padLen = blockSize - (plaintext.byteLength % blockSize);
  const out = new Uint8Array(plaintext.byteLength + padLen);
  out.set(plaintext, 0);
  out.fill(padLen, plaintext.byteLength);
  return out;
}

function aesCbcEncryptWithNode(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array
): Uint8Array {
  const algo = key.byteLength === 16 ? "aes-128-cbc" : "aes-256-cbc";
  const cipher = createCipheriv(algo, key, iv);
  // Node's Cipheriv has PKCS#7 auto-padding enabled by default. Do not pad
  // manually here, or decryptors will correctly remove only one padding layer.
  const head = cipher.update(plaintext);
  const tail = cipher.final();
  const out = new Uint8Array(head.byteLength + tail.byteLength);
  out.set(head, 0);
  out.set(tail, head.byteLength);
  return out;
}

export function registerAdapterShaCbcSuite(
  adapterLabel: string,
  factory: () => Promise<CryptoProvider>
): void {
  describe(`${adapterLabel} — sha256`, () => {
    test("empty-string KAT: e3b0c442...b855", async () => {
      const provider = await factory();
      const digest = await provider.sha256!(new Uint8Array(0));
      expect(digest).toBeInstanceOf(Uint8Array);
      expect(digest.byteLength).toBe(32);
      expect(bytesToHex(digest)).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
    });

    test("abc KAT: ba7816bf...f20015ad", async () => {
      const provider = await factory();
      const digest = await provider.sha256!(
        new TextEncoder().encode("abc")
      );
      expect(bytesToHex(digest)).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      );
    });

    test("rejects non-Uint8Array input with CryptoProviderError (not raw TypeError)", async () => {
      const provider = await factory();
      await expect(
        provider.sha256!("nope" as unknown as Uint8Array)
      ).rejects.toBeInstanceOf(CryptoProviderError);
    });

    test("rejects null input with CryptoProviderError", async () => {
      const provider = await factory();
      await expect(
        provider.sha256!(null as unknown as Uint8Array)
      ).rejects.toBeInstanceOf(CryptoProviderError);
    });
  });

  describe(`${adapterLabel} — aesCbcDecrypt round-trip`, () => {
    for (const keyLen of [16, 32] as const) {
      test(`AES-${keyLen * 8}: node-encrypted ciphertext decrypts to plaintext`, async () => {
        const provider = await factory();
        const key = new Uint8Array(keyLen).fill(keyLen);
        const iv = new Uint8Array(16).fill(7);
        const plaintext = new TextEncoder().encode(`hello cbc ${keyLen}`);
        const ciphertext = aesCbcEncryptWithNode(key, iv, plaintext);
        const recovered = await provider.aesCbcDecrypt!(key, iv, ciphertext);
        expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
      });
    }

    test("round-trips a 16-byte plaintext (one full block → 2 padded blocks)", async () => {
      const provider = await factory();
      const key = new Uint8Array(32).fill(1);
      const iv = new Uint8Array(16).fill(2);
      const plaintext = new Uint8Array(16).fill(0xab);
      const ciphertext = aesCbcEncryptWithNode(key, iv, plaintext);
      expect(ciphertext.byteLength).toBe(32); // 16 + 16 padding block
      const recovered = await provider.aesCbcDecrypt!(key, iv, ciphertext);
      expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
    });

    test("round-trips a 17-byte plaintext (needs 2 ciphertext blocks)", async () => {
      const provider = await factory();
      const key = new Uint8Array(32).fill(3);
      const iv = new Uint8Array(16).fill(4);
      const plaintext = new TextEncoder().encode("1234567890abcdefX"); // 17 bytes
      expect(plaintext.byteLength).toBe(17);
      const ciphertext = aesCbcEncryptWithNode(key, iv, plaintext);
      expect(ciphertext.byteLength).toBe(32);
      const recovered = await provider.aesCbcDecrypt!(key, iv, ciphertext);
      expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
    });

    test("round-trips an empty plaintext (one full padding block)", async () => {
      const provider = await factory();
      const key = new Uint8Array(32).fill(5);
      const iv = new Uint8Array(16).fill(6);
      const ciphertext = aesCbcEncryptWithNode(key, iv, new Uint8Array(0));
      expect(ciphertext.byteLength).toBe(16);
      const recovered = await provider.aesCbcDecrypt!(key, iv, ciphertext);
      expect(recovered.byteLength).toBe(0);
    });

    test("cross-adapter parity: node-encrypted decrypts under this adapter", async () => {
      const provider = await factory();
      const key = new Uint8Array(32).fill(0x2a);
      const iv = new Uint8Array(16).fill(0x10);
      const plaintext = new TextEncoder().encode("cross cbc parity");
      const ciphertext = aesCbcEncryptWithNode(key, iv, plaintext);
      const recovered = await provider.aesCbcDecrypt!(key, iv, ciphertext);
      expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
    });
  });

  describe(`${adapterLabel} — aesCbcDecrypt failure modes (typed errors, no raw host errors)`, () => {
    test("rejects 24-byte key with InvalidKeyError (192-bit not supported)", async () => {
      const provider = await factory();
      await expect(
        provider.aesCbcDecrypt!(
          new Uint8Array(24).fill(1),
          new Uint8Array(16),
          new Uint8Array(16)
        )
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects 15-byte IV with InvalidLengthError (CBC needs 16-byte IV)", async () => {
      const provider = await factory();
      await expect(
        provider.aesCbcDecrypt!(
          new Uint8Array(32).fill(1),
          new Uint8Array(15),
          new Uint8Array(16)
        )
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("rejects 17-byte IV with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.aesCbcDecrypt!(
          new Uint8Array(32).fill(1),
          new Uint8Array(17),
          new Uint8Array(16)
        )
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("rejects empty ciphertext with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.aesCbcDecrypt!(
          new Uint8Array(32).fill(1),
          new Uint8Array(16),
          new Uint8Array(0)
        )
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("rejects non-block-aligned ciphertext (17 bytes) with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.aesCbcDecrypt!(
          new Uint8Array(32).fill(1),
          new Uint8Array(16),
          new Uint8Array(17)
        )
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("rejects tampered PKCS#7 padding with InvalidBodyError", async () => {
      const provider = await factory();
      const key = new Uint8Array(32).fill(9);
      const iv = new Uint8Array(16).fill(8);
      const ciphertext = aesCbcEncryptWithNode(
        key,
        iv,
        new TextEncoder().encode("pad me")
      );
      // Corrupt the final block so PKCS#7 unpadding fails.
      ciphertext[ciphertext.byteLength - 1] ^= 0xff;
      await expect(
        provider.aesCbcDecrypt!(key, iv, ciphertext)
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });

    test("decrypt under the WRONG key yields InvalidBodyError (bad padding, not raw error)", async () => {
      const provider = await factory();
      const iv = new Uint8Array(16).fill(6);
      const ciphertext = aesCbcEncryptWithNode(
        new Uint8Array(32).fill(1),
        iv,
        new TextEncoder().encode("secret")
      );
      try {
        await provider.aesCbcDecrypt!(
          new Uint8Array(32).fill(2),
          iv,
          ciphertext
        );
        throw new Error("expected rejection");
      } catch (err) {
        expect(err).toBeInstanceOf(CryptoProviderError);
        expect(err).toBeInstanceOf(InvalidBodyError);
        expect(err).not.toBeInstanceOf(InvalidKeyError);
      }
    });

    test("rejects non-Uint8Array key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.aesCbcDecrypt!(
          "not-a-key" as unknown as Uint8Array,
          new Uint8Array(16),
          new Uint8Array(16)
        )
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });
  });

  describe(`${adapterLabel} — sha256/aesCbcDecrypt capability wiring`, () => {
    test("both new methods are functions", async () => {
      const provider = await factory();
      expect(typeof provider.sha256).toBe("function");
      expect(typeof provider.aesCbcDecrypt).toBe("function");
    });
  });
}
