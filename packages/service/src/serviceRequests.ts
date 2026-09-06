// WATS-205 private service-request orchestration helper.
//
// Implements the atomic durable keyed-send state machine:
//   1. claimServiceRequest({idempotencyKey, requestHash, createdAt}) =>
//      'claimed' | 'pending' | 'conflict' | {responseJson}
//   2. Only the 'claimed' winner sends to Graph.
//   3. completeServiceRequest({idempotencyKey, requestHash, responseJson, createdAt}) => void
//
// Key namespace: profile.phoneNumberId/WABA + operation via SHA256(JSON tuple).
// Hash: canonical (deep-sorted) JSON of the OUTGOING payload, SHA-256.
//
// Legacy store without claim/complete capability => 503 for keyed sends.
// No automatic release of ambiguous claim (network/5xx after claim => pending persists).
// Completion failure after Graph success => 200 genuine result + x-wats-persistence:degraded.
// Completion on a non-atomic store is treated as degraded (false) so the caller
// knows the response was not durably recorded via the atomic protocol.
//
// This module is private to @wats/service and not exported from the package barrel.

import type { PersistenceStore, ServiceRequestClaimResult } from "@wats/persistence";

/** Maximum nesting depth for canonical JSON sorting (defensive bound). */
const MAX_CANONICAL_DEPTH = 128;

/** Outcome of a keyed send attempt before the Graph call. */
export type KeyedClaimOutcome =
  | { readonly kind: "claimed" }
  | { readonly kind: "pending" }
  | { readonly kind: "conflict" }
  | { readonly kind: "replay"; readonly responseJson: string }
  | { readonly kind: "not_atomic" };

/**
 * Type predicate: narrow a PersistenceStore to one that definitely has the
 * atomic claim/complete methods. Replaces the prior `as unknown as` cast.
 */
interface AtomicClaimStore extends PersistenceStore {
  claimServiceRequest(input: { readonly idempotencyKey: string; readonly requestHash: string; readonly createdAt: string }): Promise<ServiceRequestClaimResult>;
  completeServiceRequest(input: { readonly idempotencyKey: string; readonly requestHash: string; readonly responseJson: string; readonly createdAt: string }): Promise<void>;
}

/**
 * Type predicate: returns true when the store implements the atomic
 * claim/complete protocol. Used to narrow PersistenceStore safely.
 */
export function isAtomicClaimStore(store: PersistenceStore): store is AtomicClaimStore {
  return typeof store.claimServiceRequest === "function"
    && typeof store.completeServiceRequest === "function";
}

/**
 * Canonical JSON string of a value: deep-sorted keys, stable stringify.
 * Used for request hashing so the same logical payload always hashes the same.
 *
 * The recursion is depth-bounded (MAX_CANONICAL_DEPTH) to prevent RangeError
 * stack exhaustion on deeply-nested untrusted input. A value exceeding the
 * bound throws a controlled CanonicalDepthError so the caller can map it to a
 * 400 response instead of crashing the process.
 */
export class CanonicalDepthError extends Error {
  constructor() {
    super("Canonical JSON serialization exceeded depth limit.");
    this.name = "CanonicalDepthError";
  }
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(deepSortJson(value, 0));
}

function deepSortJson(value: unknown, depth: number): unknown {
  if (depth > MAX_CANONICAL_DEPTH) throw new CanonicalDepthError();
  if (Array.isArray(value)) return value.map((item) => deepSortJson(item, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = deepSortJson(value[key], depth + 1);
    return out;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * SHA-256 hex digest of an input string, prefixed with "sha256:".
 * Uses WebCrypto (runtime-neutral).
 */
export async function sha256HexPrefixed(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Build a namespaced idempotency key for the store: the raw caller key is
 * scoped by phoneNumberId + WABA id + operation so the same raw key cannot
 * collide across profiles or operations.
 *
 * The namespace tuple is [phoneNumberId, wabaId, operation, rawKey] -> SHA256.
 */
export async function namespacedIdempotencyKey(
  phoneNumberId: string,
  wabaId: string,
  operation: string,
  rawKey: string
): Promise<string> {
  const tuple = JSON.stringify([phoneNumberId, wabaId, operation, rawKey]);
  return await sha256HexPrefixed(tuple);
}

/**
 * Attempt to claim a keyed send. Returns the outcome that the caller uses to
 * decide whether to send to Graph, replay, or return an error.
 *
 * Returns 'not_atomic' if the store lacks claim/complete capability -- the
 * caller must return 503 for keyed sends in that case.
 *
 * Throws are propagated to the caller (the handler wraps the call in a
 * try/catch that maps store exceptions to 503 persistence_unavailable with a
 * metrics error tick). A null or malformed claim result is treated as a
 * store error: the caller maps it to 503 rather than blindly sending or
 * crashing on a TypeError.
 */
export async function claimKeyedSend(
  store: PersistenceStore | undefined,
  namespacedKey: string,
  requestHash: string,
  createdAt: string
): Promise<KeyedClaimOutcome> {
  if (store === undefined) return { kind: "claimed" };
  if (!isAtomicClaimStore(store)) return { kind: "not_atomic" };

  const result = await store.claimServiceRequest({
    idempotencyKey: namespacedKey,
    requestHash,
    createdAt
  });

  if (result === "claimed") return { kind: "claimed" };
  if (result === "pending") return { kind: "pending" };
  if (result === "conflict") return { kind: "conflict" };
  // result must be { responseJson: string }. Guard against a null/malformed
  // store result: if the responseJson is not a non-empty string, treat this
  // as a store error (not a replay) so the caller returns 503 rather than
  // returning 200 with an empty/garbage body or crashing on property access.
  if (result !== null && typeof result === "object" && typeof (result as { responseJson?: unknown }).responseJson === "string" && (result as { responseJson: string }).responseJson.length > 0) {
    return { kind: "replay", responseJson: (result as { responseJson: string }).responseJson };
  }
  // Malformed claim result — the store returned something unexpected.
  throw new Error("claim_service_request_malformed");
}

/**
 * Complete a keyed send after a successful Graph call. Returns true if the
 * completion succeeded, false if it failed (caller should set
 * x-wats-persistence:degraded).
 *
 * A non-atomic store (missing claim/complete) is treated as a completion
 * failure (returns false) so the caller emits the degraded header — the
 * response was not durably recorded via the atomic protocol. This matches
 * the contract: keyed sends require atomic capability; a store that lacks it
 * cannot durably complete.
 *
 * Completion exceptions are swallowed here -- the caller already has the
 * genuine Graph result. The caller decides whether to emit the degraded
 * header based on the return value.
 */
export async function completeKeyedSend(
  store: PersistenceStore | undefined,
  namespacedKey: string,
  requestHash: string,
  responseJson: string,
  createdAt: string
): Promise<boolean> {
  if (store === undefined) return true;
  if (!isAtomicClaimStore(store)) return false;
  try {
    await store.completeServiceRequest({
      idempotencyKey: namespacedKey,
      requestHash,
      responseJson,
      createdAt
    });
    return true;
  } catch {
    // Completion failed (disk error, stale lease, etc.). The genuine Graph
    // result is still returned to the caller; the claim remains 'claimed'
    // (not 'completed') so a retry will see 'pending' and not blindly resend.
    return false;
  }
}
