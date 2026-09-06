// WATS-205 private service-request orchestration helper.
//
// Implements the atomic durable keyed-send state machine:
//   1. claimServiceRequest({idempotencyKey, requestHash, createdAt}) =>
//      'claimed' | 'pending' | 'conflict' | {responseJson}
//   2. Only the 'claimed' winner sends to Graph.
//   3. completeServiceRequest({idempotencyKey, requestHash, responseJson, createdAt}) => void
//
// Key namespace: profile.phoneNumberId/WABA + operation via SHA256(JSON tuple).
// Hash: canonical (deep-sorted) JSON of the outgoing payload, SHA-256.
//
// Legacy store without claim/complete capability => 503 for keyed sends.
// No automatic release of ambiguous claim (network/5xx after claim => pending persists).
// Completion failure after Graph success => 200 genuine result + x-wats-persistence:degraded.
//
// This module is private to @wats/service and not exported from the package barrel.

import type { PersistenceStore, ServiceRequestClaimResult } from "@wats/persistence";

/** Outcome of a keyed send attempt before the Graph call. */
export type KeyedClaimOutcome =
  | { readonly kind: "claimed" }
  | { readonly kind: "pending" }
  | { readonly kind: "conflict" }
  | { readonly kind: "replay"; readonly responseJson: string }
  | { readonly kind: "not_atomic" };

/**
 * Narrowed view of a PersistenceStore that definitely has the atomic
 * claim/complete methods. After storeSupportsAtomicClaims returns true,
 * callers cast to this type to avoid TS's "possibly undefined" complaint
 * on the optional interface methods.
 */
interface AtomicClaimStore extends PersistenceStore {
  claimServiceRequest(input: { readonly idempotencyKey: string; readonly requestHash: string; readonly createdAt: string }): Promise<ServiceRequestClaimResult>;
  completeServiceRequest(input: { readonly idempotencyKey: string; readonly requestHash: string; readonly responseJson: string; readonly createdAt: string }): Promise<void>;
}

/** Whether a store supports the atomic claim/complete protocol. */
export function storeSupportsAtomicClaims(store: PersistenceStore): boolean {
  return typeof (store as unknown as Record<string, unknown>).claimServiceRequest === "function"
    && typeof (store as unknown as Record<string, unknown>).completeServiceRequest === "function";
}

/**
 * Canonical JSON string of a value: deep-sorted keys, stable stringify.
 * Used for request hashing so the same logical payload always hashes the same.
 */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(deepSortJson(value));
}

function deepSortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => deepSortJson(item));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = deepSortJson(value[key]);
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
 */
export async function claimKeyedSend(
  store: PersistenceStore | undefined,
  namespacedKey: string,
  requestHash: string,
  createdAt: string
): Promise<KeyedClaimOutcome> {
  if (store === undefined) return { kind: "claimed" };
  if (!storeSupportsAtomicClaims(store)) return { kind: "not_atomic" };

  const atomic = store as unknown as AtomicClaimStore;
  const result = await atomic.claimServiceRequest({
    idempotencyKey: namespacedKey,
    requestHash,
    createdAt
  });

  if (result === "claimed") return { kind: "claimed" };
  if (result === "pending") return { kind: "pending" };
  if (result === "conflict") return { kind: "conflict" };
  // result is { responseJson } -- a completed claim, replay it.
  return { kind: "replay", responseJson: (result as { responseJson: string }).responseJson };
}

/**
 * Complete a keyed send after a successful Graph call. Returns true if the
 * completion succeeded, false if it failed (caller should set
 * x-wats-persistence:degraded).
 *
 * Completion failures are swallowed here -- the caller already has the
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
  if (!storeSupportsAtomicClaims(store)) return true;
  const atomic = store as unknown as AtomicClaimStore;
  try {
    await atomic.completeServiceRequest({
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
