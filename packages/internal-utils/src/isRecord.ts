/**
 * Type guard for plain JSON-shaped records.
 *
 * Returns true ONLY when the value is a plain object:
 *   - typeof value === "object"
 *   - value !== null
 *   - NOT an array
 *   - prototype is either Object.prototype OR null
 *
 * Returns false for every other runtime shape: primitives, functions,
 * arrays, typed arrays, class instances (including Error, Map, Set,
 * Date, RegExp, Promise), ArrayBuffer / DataView, and objects whose
 * prototype chain is neither Object.prototype nor null.
 *
 * The guard is safe against adversarial toString / Symbol.toPrimitive
 * overrides because it only inspects the prototype chain via
 * Object.getPrototypeOf.
 *
 * No node:* or runtime-specific APIs are used; this helper is
 * edge-runtime portable by construction.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype;
}
