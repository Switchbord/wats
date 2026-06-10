// WATS-80 live-testing harness — redaction utilities.
//
// Every value that crosses into a ledger entry, a log line, or a printed
// summary passes through here first. The contract (docs/parity/
// live-testing-campaign.md "Redaction rules"):
//   - secrets (tokens, app secret, verify token, signatures) are dropped
//     entirely, never masked-but-present;
//   - correlatable ids (wabaId, phoneNumberId, wamid, media id, template/flow
//     id, recipient wa_id / E.164) are replaced with a stable salted hash so
//     two ledger entries about the same resource line up without exposing it;
//   - free-form PII (message text, contact names, profile fields) is dropped.
//
// The salt is per-run (WATS_TEST_RUN_ID) so hashes are not stable across runs
// and cannot be reversed by dictionary attack against a known id space.

import { createHash } from "node:crypto";

/** Keys whose values must NEVER appear in a ledger, masked or otherwise. */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /access[_-]?token/i,
  /app[_-]?secret/i,
  /verify[_-]?token/i,
  /service[_-]?token/i,
  /bearer/i,
  /authorization/i,
  /x-hub-signature/i,
  /sip[_-]?cred/i,
  /password/i,
  /\bpin\b/i
];

/** Keys whose values are correlatable ids — hash, don't expose. */
const ID_KEY_PATTERNS: readonly RegExp[] = [
  /waba[_-]?id/i,
  /phone[_-]?number[_-]?id/i,
  /\bwa[_-]?id\b/i,
  /\bwamid/i,
  /message[_-]?id/i,
  /media[_-]?id/i,
  /template[_-]?id/i,
  /flow[_-]?id/i,
  /catalog[_-]?id/i,
  /product[_-]?id/i,
  /group[_-]?id/i,
  /call[_-]?id/i,
  /\bfrom\b/i,
  /\bto\b/i,
  /recipient/i,
  /\bid\b/i
];

/** Keys whose values are free-form PII — drop entirely. */
const PII_KEY_PATTERNS: readonly RegExp[] = [
  /\bbody\b/i,
  /\btext\b/i,
  /\bcaption\b/i,
  /\bname\b/i,
  /\bemail\b/i,
  /\baddress\b/i,
  /\bwebsite/i,
  /profile/i
];

function matchesAny(key: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(key));
}

/**
 * Stable salted short hash for correlation. `sha256(value + runSalt)` first 12
 * hex chars, prefixed so a reader knows it is a hash and not a real id.
 */
export function hashId(value: string, runSalt: string): string {
  const h = createHash("sha256").update(`${value}${runSalt}`).digest("hex").slice(0, 12);
  return `h:${h}`;
}

/**
 * Recursively sanitize an arbitrary JSON-ish value for ledger storage.
 * Secrets are removed, ids hashed, PII dropped, everything else kept so the
 * shape (which is what the campaign validates) survives.
 */
export function sanitizeForLedger(value: unknown, runSalt: string, keyHint = ""): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (matchesAny(keyHint, SECRET_KEY_PATTERNS)) return "[redacted-secret]";
    if (matchesAny(keyHint, PII_KEY_PATTERNS)) return "[redacted-pii]";
    if (matchesAny(keyHint, ID_KEY_PATTERNS)) return hashId(value, runSalt);
    // Bare strings with no key hint: keep short non-sensitive tokens, hash
    // anything that looks like a long opaque id (>= 20 chars, mostly alnum).
    if (value.length >= 20 && /^[A-Za-z0-9_\-=.]+$/.test(value)) {
      return hashId(value, runSalt);
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForLedger(v, runSalt, keyHint));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (matchesAny(k, SECRET_KEY_PATTERNS)) {
        out[k] = "[redacted-secret]";
        continue;
      }
      if (matchesAny(k, PII_KEY_PATTERNS)) {
        out[k] = "[redacted-pii]";
        continue;
      }
      out[k] = sanitizeForLedger(v, runSalt, k);
    }
    return out;
  }

  return "[unserializable]";
}

/**
 * Reduce an object to its key/type skeleton — the structural signature the
 * campaign actually validates. Values are replaced by their JSON type (or, for
 * arrays, the skeleton of the first element). No values survive at all, so a
 * skeleton is always safe to print even before redaction review.
 */
export function shapeSkeleton(value: unknown, depth = 0): unknown {
  if (depth > 8) return "...";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeSkeleton(value[0], depth + 1)];
  }
  const t = typeof value;
  if (t === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shapeSkeleton(v, depth + 1);
    }
    return out;
  }
  return t;
}
