// @switchbord/crypto — CryptoProvider interface (F-2 stub; implementation in GREEN).

export type CryptoProviderCapability =
  | "hmacSha256"
  | "timingSafeEqual"
  | "randomBytes"
  | "rsaOaepDecrypt"
  | "aesGcmDecrypt";

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
  rsaOaepDecrypt?(
    privateKey: JsonWebKey | Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array>;
  aesGcmDecrypt?(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    aad?: Uint8Array
  ): Promise<Uint8Array>;
}

// Sentinel runtime export so consumer fixtures / importability tests can
// confirm the module is wired through the package specifier. Runtime
// behavior lives in the adapters / factory — this is a type-only module.
export const WATS_CRYPTO_PROVIDER_EXPORTS = [
  "CryptoProvider",
  "CryptoProviderCapability",
  "CryptoValidationErrorShape"
] as const;
