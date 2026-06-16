// WATS-76 slice C — AES-GCM + RSA-OAEP crypto provider tests.
//
// Covers:
//   - aesGcmEncrypt → aesGcmDecrypt round-trip in BOTH adapters (128 & 256).
//   - cross-adapter equivalence (node-encrypted decrypts under webcrypto and
//     vice versa) — proves the two public contracts are byte-identical.
//   - the last-16-bytes-are-tag contract (concatenating ciphertext+authTag is
//     exactly what aesGcmDecrypt accepts).
//   - RSA-OAEP recover-the-AES-key using an IN-TEST generated keypair (no
//     checked-in secrets), exercised against PEM and JWK private-key forms.
//   - failure-mode mapping to InvalidKeyError / InvalidBodyError /
//     InvalidLengthError (no raw host errors escape).

import { describe, expect, test } from "bun:test";
import type { CryptoProvider } from "../src/provider";
import { createNodeCryptoProvider } from "../src/adapters/node/index";
import { createWebCryptoProvider } from "../src/adapters/webcrypto/index";
import {
  CryptoProviderError,
  InvalidBodyError,
  InvalidKeyError,
  InvalidLengthError
} from "../src/errors";

const ADAPTERS: ReadonlyArray<{
  label: string;
  factory: () => Promise<CryptoProvider>;
}> = [
  { label: "node", factory: createNodeCryptoProvider },
  { label: "webcrypto", factory: createWebCryptoProvider }
];

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

const TEXT = new TextEncoder();

// --- AES-GCM round-trip + contract --------------------------------------

for (const { label, factory } of ADAPTERS) {
  describe(`${label} — aesGcmEncrypt/aesGcmDecrypt round-trip`, () => {
    for (const keyLen of [16, 32] as const) {
      test(`AES-${keyLen * 8}: encrypt then decrypt recovers plaintext`, async () => {
        const provider = await factory();
        const key = new Uint8Array(keyLen).fill(keyLen);
        const iv = new Uint8Array(12).fill(7);
        const plaintext = TEXT.encode(`hello flow ${keyLen}`);

        const { ciphertext, authTag } = await provider.aesGcmEncrypt!(
          key,
          iv,
          plaintext
        );
        expect(ciphertext).toBeInstanceOf(Uint8Array);
        expect(authTag).toBeInstanceOf(Uint8Array);
        // Return shape: ciphertext and 16-byte tag returned SEPARATELY.
        expect(authTag.byteLength).toBe(16);

        // Contract: caller concatenates ciphertext + authTag; decrypt treats
        // the LAST 16 bytes as the tag.
        const combined = concat(ciphertext, authTag);
        const recovered = await provider.aesGcmDecrypt!(key, iv, combined);
        expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
      });
    }

    test("round-trips an empty plaintext", async () => {
      const provider = await factory();
      const key = new Uint8Array(16).fill(1);
      const iv = new Uint8Array(12).fill(2);
      const { ciphertext, authTag } = await provider.aesGcmEncrypt!(
        key,
        iv,
        new Uint8Array(0)
      );
      const recovered = await provider.aesGcmDecrypt!(
        key,
        iv,
        concat(ciphertext, authTag)
      );
      expect(recovered.byteLength).toBe(0);
    });

    test("round-trips with AAD when both sides supply it", async () => {
      const provider = await factory();
      const key = new Uint8Array(32).fill(9);
      const iv = new Uint8Array(12).fill(3);
      const aad = TEXT.encode("associated");
      const plaintext = TEXT.encode("with aad");
      const { ciphertext, authTag } = await provider.aesGcmEncrypt!(
        key,
        iv,
        plaintext,
        aad
      );
      const recovered = await provider.aesGcmDecrypt!(
        key,
        iv,
        concat(ciphertext, authTag),
        aad
      );
      expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
    });
  });

  describe(`${label} — AES-GCM failure modes (typed errors, no raw host errors)`, () => {
    test("rejects 24-byte key with InvalidKeyError (192-bit not supported)", async () => {
      const provider = await factory();
      await expect(
        provider.aesGcmEncrypt!(
          new Uint8Array(24).fill(1),
          new Uint8Array(12),
          TEXT.encode("x")
        )
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects non-Uint8Array key with InvalidKeyError", async () => {
      const provider = await factory();
      await expect(
        provider.aesGcmEncrypt!(
          "not-a-key" as unknown as Uint8Array,
          new Uint8Array(12),
          TEXT.encode("x")
        )
      ).rejects.toBeInstanceOf(InvalidKeyError);
    });

    test("rejects empty IV with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.aesGcmEncrypt!(
          new Uint8Array(16).fill(1),
          new Uint8Array(0),
          TEXT.encode("x")
        )
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("rejects non-Uint8Array IV with InvalidLengthError", async () => {
      const provider = await factory();
      await expect(
        provider.aesGcmEncrypt!(
          new Uint8Array(16).fill(1),
          42 as unknown as Uint8Array,
          TEXT.encode("x")
        )
      ).rejects.toBeInstanceOf(InvalidLengthError);
    });

    test("decrypt rejects ciphertext shorter than the 16-byte tag with InvalidBodyError", async () => {
      const provider = await factory();
      await expect(
        provider.aesGcmDecrypt!(
          new Uint8Array(16).fill(1),
          new Uint8Array(12),
          new Uint8Array(8)
        )
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });

    test("decrypt rejects a tampered auth tag with InvalidBodyError", async () => {
      const provider = await factory();
      const key = new Uint8Array(16).fill(5);
      const iv = new Uint8Array(12).fill(6);
      const { ciphertext, authTag } = await provider.aesGcmEncrypt!(
        key,
        iv,
        TEXT.encode("tamper me")
      );
      const tampered = concat(ciphertext, authTag);
      tampered[tampered.byteLength - 1] ^= 0xff; // flip a tag byte
      await expect(
        provider.aesGcmDecrypt!(key, iv, tampered)
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });

    test("decrypt under the WRONG key fails with InvalidBodyError (not a raw error)", async () => {
      const provider = await factory();
      const iv = new Uint8Array(12).fill(6);
      const { ciphertext, authTag } = await provider.aesGcmEncrypt!(
        new Uint8Array(16).fill(1),
        iv,
        TEXT.encode("secret")
      );
      try {
        await provider.aesGcmDecrypt!(
          new Uint8Array(16).fill(2),
          iv,
          concat(ciphertext, authTag)
        );
        throw new Error("expected rejection");
      } catch (err) {
        expect(err).toBeInstanceOf(CryptoProviderError);
        expect(err).toBeInstanceOf(InvalidBodyError);
        expect(err).not.toBeInstanceOf(InvalidKeyError);
      }
    });

    test("rejects non-Uint8Array AAD with InvalidBodyError", async () => {
      const provider = await factory();
      await expect(
        provider.aesGcmEncrypt!(
          new Uint8Array(16).fill(1),
          new Uint8Array(12),
          TEXT.encode("x"),
          "aad" as unknown as Uint8Array
        )
      ).rejects.toBeInstanceOf(InvalidBodyError);
    });
  });
}

// --- cross-adapter equivalence ------------------------------------------

describe("cross-adapter AES-GCM equivalence", () => {
  test("node-encrypted ciphertext decrypts under webcrypto", async () => {
    const node = await createNodeCryptoProvider();
    const web = await createWebCryptoProvider();
    const key = new Uint8Array(16).fill(0x2a);
    const iv = new Uint8Array(12).fill(0x10);
    const plaintext = TEXT.encode("cross node->web");
    const { ciphertext, authTag } = await node.aesGcmEncrypt!(key, iv, plaintext);
    const recovered = await web.aesGcmDecrypt!(key, iv, concat(ciphertext, authTag));
    expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
  });

  test("webcrypto-encrypted ciphertext decrypts under node", async () => {
    const node = await createNodeCryptoProvider();
    const web = await createWebCryptoProvider();
    const key = new Uint8Array(32).fill(0x3b);
    const iv = new Uint8Array(12).fill(0x20);
    const plaintext = TEXT.encode("cross web->node");
    const { ciphertext, authTag } = await web.aesGcmEncrypt!(key, iv, plaintext);
    const recovered = await node.aesGcmDecrypt!(key, iv, concat(ciphertext, authTag));
    expect(bytesToHex(recovered)).toBe(bytesToHex(plaintext));
  });

  test("identical inputs produce byte-identical {ciphertext,authTag} across adapters", async () => {
    const node = await createNodeCryptoProvider();
    const web = await createWebCryptoProvider();
    const key = new Uint8Array(16).fill(0x44);
    const iv = new Uint8Array(12).fill(0x55);
    const plaintext = TEXT.encode("deterministic gcm");
    const a = await node.aesGcmEncrypt!(key, iv, plaintext);
    const b = await web.aesGcmEncrypt!(key, iv, plaintext);
    expect(bytesToHex(a.ciphertext)).toBe(bytesToHex(b.ciphertext));
    expect(bytesToHex(a.authTag)).toBe(bytesToHex(b.authTag));
  });
});

// --- RSA-OAEP recover-the-AES-key ---------------------------------------

// Build a PKCS#8 PEM from raw DER bytes (test helper only).
function derToPkcs8Pem(der: Uint8Array): string {
  let binary = "";
  for (const b of der) binary += String.fromCharCode(b);
  const b64 = btoa(binary).replace(/(.{64})/g, "$1\n");
  const dashes = "-".repeat(5);
  const label = "PRIVATE KEY";
  const begin = `${dashes}BEGIN ${label}${dashes}`;
  const end = `${dashes}END ${label}${dashes}`;
  return `${begin}\n${b64}\n${end}\n`;
}

describe("RSA-OAEP recover-the-AES-key (in-test keypair, no checked-in secrets)", () => {
  test("encrypt an AES key with the public key; both adapters recover it (PEM + JWK)", async () => {
    const subtle = globalThis.crypto.subtle;
    // Generate a throwaway RSA-OAEP SHA-256 keypair for THIS test only.
    const pair = (await subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["encrypt", "decrypt"]
    )) as CryptoKeyPair;

    // The "AES key" we want to transport (16 bytes = AES-128).
    const aesKey = new Uint8Array(16);
    globalThis.crypto.getRandomValues(aesKey);

    // Wrap it with the public key (RSA-OAEP SHA-256).
    const encryptedAesKey = new Uint8Array(
      await subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, aesKey)
    );

    // Export the private key as both PKCS#8 PEM and JWK.
    const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
    const pem = derToPkcs8Pem(pkcs8);
    const pemBytes = TEXT.encode(pem);
    const jwk = (await subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;

    const node = await createNodeCryptoProvider();
    const web = await createWebCryptoProvider();

    // PEM private key (as Uint8Array of UTF-8) under both adapters.
    const nodePem = await node.rsaOaepDecrypt!(pemBytes, encryptedAesKey);
    const webPem = await web.rsaOaepDecrypt!(pemBytes, encryptedAesKey);
    expect(bytesToHex(nodePem)).toBe(bytesToHex(aesKey));
    expect(bytesToHex(webPem)).toBe(bytesToHex(aesKey));

    // JWK private key under both adapters.
    const nodeJwk = await node.rsaOaepDecrypt!(jwk, encryptedAesKey);
    const webJwk = await web.rsaOaepDecrypt!(jwk, encryptedAesKey);
    expect(bytesToHex(nodeJwk)).toBe(bytesToHex(aesKey));
    expect(bytesToHex(webJwk)).toBe(bytesToHex(aesKey));

    // End-to-end: the recovered AES key actually decrypts an AES-GCM payload
    // produced under it — proving the Flow request-channel shape works.
    const iv = new Uint8Array(12).fill(0x66);
    const payload = TEXT.encode('{"action":"ping"}');
    const { ciphertext, authTag } = await web.aesGcmEncrypt!(aesKey, iv, payload);
    const decoded = await node.aesGcmDecrypt!(
      nodePem,
      iv,
      concat(ciphertext, authTag)
    );
    expect(new TextDecoder().decode(decoded)).toBe('{"action":"ping"}');
  });

  test("rejects malformed private key with InvalidKeyError (both adapters)", async () => {
    const node = await createNodeCryptoProvider();
    const web = await createWebCryptoProvider();
    const garbage = TEXT.encode("-----BEGIN PRIVATE KEY-----\nnotbase64!!\n-----END PRIVATE KEY-----\n");
    await expect(
      node.rsaOaepDecrypt!(garbage, new Uint8Array(256))
    ).rejects.toBeInstanceOf(InvalidKeyError);
    await expect(
      web.rsaOaepDecrypt!(garbage, new Uint8Array(256))
    ).rejects.toBeInstanceOf(InvalidKeyError);
  });

  test("rejects non-Uint8Array ciphertext with a typed error (both adapters)", async () => {
    const node = await createNodeCryptoProvider();
    const web = await createWebCryptoProvider();
    const jwkish: JsonWebKey = { kty: "RSA" };
    await expect(
      node.rsaOaepDecrypt!(jwkish, "nope" as unknown as Uint8Array)
    ).rejects.toBeInstanceOf(CryptoProviderError);
    await expect(
      web.rsaOaepDecrypt!(jwkish, "nope" as unknown as Uint8Array)
    ).rejects.toBeInstanceOf(CryptoProviderError);
  });
});

// --- capability advertisement -------------------------------------------

describe("new aesGcmEncrypt capability is wired", () => {
  test("both adapters expose all three new methods as functions", async () => {
    for (const { factory } of ADAPTERS) {
      const provider = await factory();
      expect(typeof provider.rsaOaepDecrypt).toBe("function");
      expect(typeof provider.aesGcmDecrypt).toBe("function");
      expect(typeof provider.aesGcmEncrypt).toBe("function");
    }
  });
});
