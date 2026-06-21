import { createCipheriv, createHash, createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { createNodeCryptoProvider } from "@wats/crypto";
import type { CryptoProvider } from "@wats/crypto";
import {
  FlowMediaCryptoUnavailableError,
  FlowMediaDecryptionError,
  decryptFlowMedia,
  decryptFlowMediaFile,
  type FlowMediaEncryptedFile,
  type FlowMediaEncryptionMetadata
} from "../src/endpoints/flows";

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function encryptFixture(plaintext: Uint8Array): {
  readonly cdnFile: Uint8Array;
  readonly metadata: FlowMediaEncryptionMetadata;
} {
  const iv = new Uint8Array(16).fill(0x10);
  const encryptionKey = new Uint8Array(32).fill(0x22);
  const hmacKey = new Uint8Array(32).fill(0x33);
  const cipher = createCipheriv("aes-256-cbc", encryptionKey, iv);
  const ciphertext = concat(cipher.update(plaintext), cipher.final());
  const macFull = new Uint8Array(createHmac("sha256", hmacKey).update(concat(iv, ciphertext)).digest());
  const tag = macFull.subarray(0, 10);
  const cdnFile = concat(ciphertext, tag);
  return {
    cdnFile,
    metadata: {
      iv: b64(iv),
      encryption_key: b64(encryptionKey),
      hmac_key: b64(hmacKey),
      encrypted_hash: b64(sha256(cdnFile)),
      plaintext_hash: b64(sha256(plaintext))
    }
  };
}

describe("WATS-151 Flow media-upload decryption", () => {
  test("decryptFlowMedia verifies full-file hash, HMAC, CBC padding, and plaintext hash", async () => {
    const crypto = await createNodeCryptoProvider();
    const plaintext = new TextEncoder().encode("flow media plaintext");
    const { cdnFile, metadata } = encryptFixture(plaintext);

    const recovered = await decryptFlowMedia(crypto, cdnFile, metadata);

    expect(Buffer.from(recovered).toString("utf8")).toBe("flow media plaintext");
  });

  test("decryptFlowMediaFile returns media id, filename, and plaintext bytes", async () => {
    const crypto = await createNodeCryptoProvider();
    const plaintext = new TextEncoder().encode("document bytes");
    const { cdnFile, metadata } = encryptFixture(plaintext);
    const encrypted: FlowMediaEncryptedFile = {
      media_id: "media-1",
      cdn_url: "https://cdn.example/file",
      file_name: "doc.pdf",
      encryption_metadata: metadata
    };

    const result = await decryptFlowMediaFile(crypto, encrypted, cdnFile);

    expect(result.mediaId).toBe("media-1");
    expect(result.filename).toBe("doc.pdf");
    expect(Buffer.from(result.data).toString("utf8")).toBe("document bytes");
  });

  test("tampered encrypted hash, HMAC, and plaintext hash all fail closed", async () => {
    const crypto = await createNodeCryptoProvider();
    const plaintext = new TextEncoder().encode("flow media plaintext");
    const { cdnFile, metadata } = encryptFixture(plaintext);

    await expect(decryptFlowMedia(crypto, cdnFile, { ...metadata, encrypted_hash: b64(new Uint8Array(32).fill(1)) })).rejects.toBeInstanceOf(FlowMediaDecryptionError);

    const tamperedMac = new Uint8Array(cdnFile);
    tamperedMac[tamperedMac.byteLength - 1] ^= 0xff;
    await expect(decryptFlowMedia(crypto, tamperedMac, metadata)).rejects.toBeInstanceOf(FlowMediaDecryptionError);

    await expect(decryptFlowMedia(crypto, cdnFile, { ...metadata, plaintext_hash: b64(new Uint8Array(32).fill(2)) })).rejects.toBeInstanceOf(FlowMediaDecryptionError);
  });

  test("wrong key/iv lengths, missing metadata, and short CDN files fail closed", async () => {
    const crypto = await createNodeCryptoProvider();
    const { cdnFile, metadata } = encryptFixture(new TextEncoder().encode("x"));

    await expect(decryptFlowMedia(crypto, cdnFile, { ...metadata, iv: b64(new Uint8Array(15)) })).rejects.toBeInstanceOf(FlowMediaDecryptionError);
    await expect(decryptFlowMedia(crypto, cdnFile, { ...metadata, encryption_key: b64(new Uint8Array(16)) })).rejects.toBeInstanceOf(FlowMediaDecryptionError);
    await expect(decryptFlowMedia(crypto, new Uint8Array(25), metadata)).rejects.toBeInstanceOf(FlowMediaDecryptionError);
    await expect(decryptFlowMediaFile(crypto, { media_id: "m", cdn_url: "", file_name: "f", encryption_metadata: metadata }, cdnFile)).rejects.toBeInstanceOf(FlowMediaDecryptionError);
  });

  test("missing crypto capabilities are reported as configuration errors", async () => {
    const { cdnFile, metadata } = encryptFixture(new TextEncoder().encode("x"));
    const missing = {
      name: "missing",
      hmacSha256: async () => new Uint8Array(32),
      timingSafeEqual: () => true,
      randomBytes: async () => new Uint8Array(1),
      sha256: async () => new Uint8Array(32)
    } satisfies CryptoProvider;

    await expect(decryptFlowMedia(missing, cdnFile, metadata)).rejects.toBeInstanceOf(FlowMediaCryptoUnavailableError);
  });
});
