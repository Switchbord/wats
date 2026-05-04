import { graphValidationError } from "./errors";

export interface StringValidationOptions {
  readonly helperName: string;
  readonly fieldName: string;
  readonly maxLength?: number;
  readonly allowWhitespace?: boolean;
  readonly allowControlChars?: boolean;
}

export type QueryStringValidationOptions = Omit<StringValidationOptions, "allowWhitespace" | "allowControlChars">;

export function hasAsciiControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function assertNonEmptyString(value: unknown, opts: StringValidationOptions): string {
  if (typeof value !== "string") {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must be a string.`);
  }
  if (value.length === 0) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must be non-empty.`);
  }
  if (opts.allowWhitespace !== true && value.trim().length === 0) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must not be whitespace-only.`);
  }
  if (opts.allowControlChars !== true && hasAsciiControlChar(value)) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must not contain control characters.`);
  }
  return value;
}

export function assertBoundedString(value: unknown, opts: StringValidationOptions): string {
  const out = assertNonEmptyString(value, opts);
  if (opts.maxLength !== undefined && out.length > opts.maxLength) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} exceeds ${opts.maxLength}-character limit.`);
  }
  return out;
}

export function assertQueryString(value: unknown, opts: QueryStringValidationOptions): string {
  if (typeof value !== "string") {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must be non-empty.`);
  }
  if (opts.maxLength !== undefined && value.length > opts.maxLength) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} exceeds ${opts.maxLength}-character limit.`);
  }
  if (hasAsciiControlChar(value)) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.fieldName} must not contain control characters.`);
  }
  return value;
}
