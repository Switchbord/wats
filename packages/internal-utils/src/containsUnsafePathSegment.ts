/**
 * Path-segment safety guard.
 *
 * Returns true when the input string contains a substring or encoded
 * variant that could be used for path traversal, query/header injection,
 * or other unsafe path construction. Returns true (unsafe) for non-string
 * and empty inputs so callers that skip pre-validation still reject
 * garbage defensively.
 *
 * The guard checks for:
 *   - literal backslash, question mark, hash, colon
 *   - ".." and "." path segments
 *   - percent-encoded ".." (%2e%2e) and double-encoded (%252e%252e)
 *   - percent-encoded slash (%2f) and double-encoded (%252f)
 *   - percent-encoded backslash (%5c) and double-encoded (%255c)
 *   - CR, LF, NUL, and other control chars (< 0x20 and 0x7F)
 *
 * This is the canonical copy (WATS-196). The three previously-divergent
 * inline copies in @wats/config, @wats/service, and @wats/persistence
 * have been replaced by imports from this module.
 *
 * No node:* or runtime-specific APIs are used; this helper is
 * edge-runtime portable by construction.
 */
export function containsUnsafePathSegment(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return true;
  }

  const lower = value.toLowerCase();
  return (
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes(":") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value.split("/").some((segment) => segment === ".." || segment === ".") ||
    lower.includes("%2e%2e") ||
    lower.includes("%252e%252e") ||
    lower.includes("%2f") ||
    lower.includes("%252f") ||
    lower.includes("%5c") ||
    lower.includes("%255c")
  );
}
