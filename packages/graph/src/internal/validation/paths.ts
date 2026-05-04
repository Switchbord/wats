import { graphValidationError } from "./errors";
import { assertBoundedString, hasAsciiControlChar } from "./strings";

export interface SafePathOptions {
  readonly helperName: string;
  readonly fieldName: string;
  readonly maxLength?: number;
  readonly maxDecodeRounds?: number;
}

function assertSafePathSegmentString(value: string, opts: SafePathOptions): void {
  if (hasAsciiControlChar(value)) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must not contain control characters.`);
  }
  if (value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("?") || value.includes("#")) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} contains an unsafe path segment.`);
  }
}

export function assertSafePathSegment(value: unknown, opts: SafePathOptions): string {
  const out = assertBoundedString(value, {
    helperName: opts.helperName,
    fieldName: opts.fieldName,
    maxLength: opts.maxLength ?? 512
  });
  assertSafePathSegmentString(out, opts);
  return out;
}

export function assertRepeatedlyDecodedSafePathId(value: unknown, opts: SafePathOptions): string {
  const out = assertSafePathSegment(value, opts);
  let decoded = out;
  const maxDecodeRounds = opts.maxDecodeRounds ?? 8;
  for (let round = 0; round < maxDecodeRounds; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch (error) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} contains malformed percent encoding.`, error);
    }
    if (next === decoded) return out;
    decoded = next;
    assertSafePathSegmentString(decoded, opts);
  }
  throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} contains excessive percent encoding.`);
}
