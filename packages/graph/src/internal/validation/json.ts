import { assertDenseDataArray } from "./arrays.js";
import { graphValidationError, wrapGraphValidation } from "./errors.js";
import { assertPlainDataRecord } from "./records.js";
import { hasAsciiControlChar } from "./strings.js";

export interface SafeJsonCloneOptions {
  readonly helperName: string;
  readonly path: string;
  readonly maxDepth: number;
  readonly maxArrayLength: number;
  readonly maxStringLength: number;
  readonly maxKeys?: number;
  readonly allowUndefined?: boolean;
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function clone(value: unknown, opts: SafeJsonCloneOptions, path: string, seen: WeakSet<object>, depth: number): unknown {
  if (depth > opts.maxDepth) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${path} exceeds maximum depth ${opts.maxDepth}.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > opts.maxStringLength || hasAsciiControlChar(value)) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${path} contains an invalid string.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${path} contains a non-finite number.`);
    }
    return value;
  }
  if (value === undefined) {
    if (opts.allowUndefined === true) return undefined;
    throw graphValidationError(`Invalid ${opts.helperName} input: ${path} must be JSON-like data.`);
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${path} must be JSON-like data.`);
  }
  if (typeof value !== "object") {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${path} must be JSON-like data.`);
  }
  if (seen.has(value)) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${path} must not contain cycles.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const arr = assertDenseDataArray(value, {
        helperName: opts.helperName,
        path,
        maxLength: opts.maxArrayLength
      });
      const out: unknown[] = [];
      for (let index = 0; index < arr.length; index += 1) {
        const cloned = clone(arr[index], opts, `${path}[${index}]`, seen, depth + 1);
        if (cloned !== undefined) out.push(cloned);
      }
      return out;
    }

    const record = assertPlainDataRecord(value, {
      helperName: opts.helperName,
      path,
      rejectFunctionsSymbolsBigInts: true
    });
    const descriptors = wrapGraphValidation(`Invalid ${opts.helperName} input: ${path} descriptors could not be inspected.`, () =>
      Object.getOwnPropertyDescriptors(record)
    );
    const entries = Object.entries(descriptors);
    if (opts.maxKeys !== undefined && entries.length > opts.maxKeys) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${path} exceeds ${opts.maxKeys}-key limit.`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, descriptor] of entries) {
      const cloned = clone(descriptor.value, opts, childPath(path, key), seen, depth + 1);
      if (cloned !== undefined) out[key] = cloned;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function safeJsonClone(value: unknown, opts: SafeJsonCloneOptions): unknown {
  return clone(value, opts, opts.path, new WeakSet<object>(), 0);
}
