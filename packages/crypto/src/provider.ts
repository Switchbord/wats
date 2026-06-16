// @wats/crypto — CryptoProvider interface (F-2 stub; implementation in GREEN).

export type CryptoProviderCapability =
  | "hmacSha256"
  | "timingSafeEqual"
  | "randomBytes"
  | "rsaOaepDecrypt"
  | "aesGcmDecrypt"
  | "aesGcmEncrypt";

export interface CryptoValidationErrorShape {
  readonly code:
    | "invalid_key"
    | "invalid_body"
    | "invalid_length"
    | "unsupported_capability";
  readonly message: string;
}

export interface CryptoProvider {
  readonly name: string;
  hmacSha256(
    key: Uint8Array | string,
    body: Uint8Array | string
  ): Promise<Uint8Array>;
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
  randomBytes(byteLength: number): Promise<Uint8Array>;
  // Forward-declared optional methods — implementation arrives with Flows / Media.
  //
  // rsaOaepDecrypt: RSA-OAEP decryption with MGF1 + OAEP hash both SHA-256
  // and an empty label (matches the WhatsApp Flow encrypted-data-channel
  // scheme). `privateKey` accepts a PEM-encoded PKCS#8 key (as a string or
  // its UTF-8 bytes in a Uint8Array) or a JSON Web Key. Rejects with
  // InvalidKeyError for a malformed/unsupported key and InvalidBodyError
  // for a ciphertext that does not decrypt under the key.
  rsaOaepDecrypt?(
    privateKey: JsonWebKey | Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;
  // aesGcmDecrypt: AES-GCM decryption. CONTRACT — the auth tag is the LAST
  // 16 bytes of `ciphertext` (tag = ciphertext[-16:], body = ciphertext[:-16]),
  // matching the Flow scheme where the 16-byte GCM tag is appended after the
  // ciphertext. No AAD is used by the Flow scheme, but `aad` is accepted for
  // generality. AES-128-GCM vs AES-256-GCM is selected by key length
  // (16 → 128, 32 → 256). Rejects with InvalidKeyError (bad key length),
  // InvalidLengthError (bad IV length or ciphertext shorter than the 16-byte
  // tag), and InvalidBodyError (authentication failure / malformed body).
  aesGcmDecrypt?(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    aad?: Uint8Array
  ): Promise<Uint8Array>;
  // aesGcmEncrypt: AES-GCM encryption. RETURN SHAPE — the ciphertext and the
  // 16-byte auth tag are returned SEPARATELY as `{ ciphertext, authTag }`;
  // callers concatenate them (`ciphertext` followed by `authTag`) per the
  // Flow response scheme. AES-128/256-GCM is selected by key length
  // (16 → 128, 32 → 256). No AAD is used by the Flow scheme, but `aad` is
  // accepted for generality. Rejects with InvalidKeyError (bad key length),
  // InvalidLengthError (bad IV length), and InvalidBodyError (other failures).
  aesGcmEncrypt?(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
    aad?: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; authTag: Uint8Array }>;
}

// Sentinel runtime export so consumer fixtures / importability tests can
// confirm the module is wired through the package specifier. Runtime
// behavior lives in the adapters / factory — this is a type-only module.
export const WATS_CRYPTO_PROVIDER_EXPORTS = [
  "CryptoProvider",
  "CryptoProviderCapability",
  "CryptoValidationErrorShape"
] as const;
