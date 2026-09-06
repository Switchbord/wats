// WATS-201 private webhook ingress helpers.
//
// Per-update scoped dedup keys, event-time projection, finite depth gate, and
// fallback canonical hashing. Imported by index.ts; NOT part of the public
// service export surface.

export const MAX_NESTED_DEPTH = 128;
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000; // 1h clock-skew tolerance

/**
 * Convert a Meta webhook timestamp (seconds-since-epoch string/number) to
 * ISO 8601 ms-precision. Returns null when malformed (non-numeric, empty,
 * non-positive, non-integer). Future timestamps within FUTURE_TOLERANCE_MS
 * clamp to receipt (never extend the window); beyond the tolerance are
 * rejected (null). Caller skips projection on null.
 */
export function metaTimestampToIso(
  timestamp: unknown,
  receiptNowMs: number
): string | null {
  let seconds: number;
  if (typeof timestamp === "string" && timestamp.length > 0) {
    if (!/^\d+$/u.test(timestamp)) return null;
    seconds = Number(timestamp);
  } else if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    if (!Number.isInteger(timestamp)) return null;
    seconds = timestamp;
  } else {
    return null;
  }
  if (seconds <= 0) return null;
  const ms = Math.trunc(seconds * 1000);
  if (ms <= 0) return null;
  // Clamp future timestamps within tolerance to receipt; reject beyond it.
  if (ms > receiptNowMs + FUTURE_TOLERANCE_MS) return null;
  const clamped = Math.min(ms, receiptNowMs);
  try {
    const iso = new Date(clamped).toISOString();
    if (new Date(iso).getTime() !== clamped) return null;
    return iso;
  } catch {
    return null;
  }
}

export function receiptNowMs(): number {
  return Date.now();
}

/**
 * Measure the maximum object/array nesting depth of a parsed value.
 * Primitives are depth 0; each nested object/array adds 1. Used to enforce
 * the finite depth gate (MAX_NESTED_DEPTH) on the authenticated parsed
 * envelope for ALL families before dedup/dispatch.
 */
export function measureDepth(value: unknown, depth: number = 0): number {
  if (depth > MAX_NESTED_DEPTH) return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (let i = 0; i < value.length; i++) {
      const d = measureDepth(value[i], depth + 1);
      if (d > max) max = d;
    }
    return max;
  }
  if (typeof value === "object" && value !== null) {
    let max = depth;
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const d = measureDepth(record[key], depth + 1);
      if (d > max) max = d;
    }
    return max;
  }
  return depth;
}

/** True when the parsed value's nesting depth is within the finite limit. */
export function isWithinDepthLimit(value: unknown): boolean {
  return measureDepth(value, 0) <= MAX_NESTED_DEPTH;
}

/**
 * Per-update dedup key for a message update, scoped by the receiving profile
 * (phoneNumberId + wabaId) + messageId. Async SHA-256 of a JSON tuple.
 */
export async function messageDedupKey(
  sha256Hex: (input: string) => Promise<string>,
  phoneNumberId: string,
  wabaId: string,
  messageId: string
): Promise<string> {
  const tuple = JSON.stringify(["msg", phoneNumberId, wabaId, messageId]);
  return `msg:${await sha256Hex(tuple)}`;
}

/**
 * Per-update dedup key for a status update, scoped by the receiving profile
 * + statusId + status + timestamp.
 */
export async function statusDedupKey(
  sha256Hex: (input: string) => Promise<string>,
  phoneNumberId: string,
  wabaId: string,
  statusId: string,
  status: string,
  timestamp: string
): Promise<string> {
  const tuple = JSON.stringify(["status", phoneNumberId, wabaId, statusId, status, timestamp]);
  return `status:${await sha256Hex(tuple)}`;
}

/**
 * Bounded stable fallback dedup key for update families without a natural
 * identity (account, call, group, system, unknown). Hashes a bounded canonical
 * JSON of the STABLE fields (excludes receive-clock fields receivedAt and
 * rawChange so retries dedup) with explicit depth rejection (MAX_NESTED_DEPTH).
 * The entire scope tuple ["other", phoneNumberId, wabaId, canonical] is hashed
 * together so the key is not a raw phone/waba prefix.
 */
export async function fallbackDedupKey(
  sha256Hex: (input: string) => Promise<string>,
  phoneNumberId: string,
  wabaId: string,
  update: unknown
): Promise<string | null> {
  const stable = extractStableFields(update);
  if (stable === null) return null;
  const canonical = boundedCanonicalJson(stable, 0);
  if (canonical === null) return null;
  const tuple = JSON.stringify(["other", phoneNumberId, wabaId, canonical]);
  return `other:${await sha256Hex(tuple)}`;
}

/**
 * Extract the stable (non-volatile) fields from a normalized update for
 * fallback dedup. Excludes receivedAt (receipt-time clock) and rawChange
 * (may contain volatile entry.time). Returns null if not a record.
 */
function extractStableFields(update: unknown): Record<string, unknown> | null {
  if (typeof update !== "object" || update === null || Array.isArray(update)) return null;
  const record = update as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key === "receivedAt" || key === "rawChange") continue;
    out[key] = record[key];
  }
  return out;
}

/**
 * Bounded canonical JSON serialization with explicit depth rejection.
 * Returns null when nesting exceeds MAX_NESTED_DEPTH.
 */
function boundedCanonicalJson(value: unknown, depth: number): string | null {
  if (depth > MAX_NESTED_DEPTH) return null;
  if (Array.isArray(value)) {
    const parts: string[] = ["["];
    for (let i = 0; i < value.length; i++) {
      if (i > 0) parts.push(",");
      const child = boundedCanonicalJson(value[i], depth + 1);
      if (child === null) return null;
      parts.push(child);
    }
    parts.push("]");
    return parts.join("");
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts: string[] = ["{"];
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) parts.push(",");
      const k = keys[i]!;
      const child = boundedCanonicalJson((value as Record<string, unknown>)[k], depth + 1);
      if (child === null) return null;
      parts.push(JSON.stringify(k), ":", child);
    }
    parts.push("}");
    return parts.join("");
  }
  return JSON.stringify(value);
}
