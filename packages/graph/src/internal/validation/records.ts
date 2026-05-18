import { graphValidationError, wrapGraphValidation } from "./errors.js";
import { hasAsciiControlChar } from "./strings.js";

export interface PlainDataRecordOptions {
  readonly helperName: string;
  readonly path: string;
  readonly objectNoun?: "object" | "plain object";
  readonly rejectInheritedToJSON?: boolean;
  readonly rejectOwnToJSON?: boolean;
  readonly rejectFunctionsSymbolsBigInts?: boolean;
}

export interface OwnDataValueOptions {
  readonly helperName: string;
  readonly path: string;
  readonly required?: boolean;
}

export function isUnsafePrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

export function rejectUnsafePrototypeKey(key: string, opts: { readonly helperName: string; readonly path: string }): void {
  if (isUnsafePrototypeKey(key)) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} contains an unsafe prototype key.`);
  }
}

export function assertPlainDataRecord(value: unknown, opts: PlainDataRecordOptions): Record<string, unknown> {
  const noun = opts.objectNoun ?? "plain object";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must be a ${noun}.`);
  }
  const proto = wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} could not be inspected.`, () =>
    Object.getPrototypeOf(value)
  );
  if (proto !== Object.prototype && proto !== null) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must be a ${noun}.`);
  }
  const descriptors = wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} descriptors could not be inspected.`, () =>
    Object.getOwnPropertyDescriptors(value)
  );
  if (opts.rejectOwnToJSON !== false && Object.prototype.hasOwnProperty.call(descriptors, "toJSON")) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not define toJSON.`);
  }
  if (opts.rejectInheritedToJSON !== false) {
    wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} could not be inspected.`, () => {
      if ("toJSON" in value) {
        throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not inherit toJSON.`);
      }
    });
  }

  const symbolDescriptors = Object.getOwnPropertySymbols(descriptors);
  for (const symbolKey of symbolDescriptors) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, symbolKey)?.value as PropertyDescriptor | undefined;
    if (descriptor === undefined) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} symbol descriptor could not be inspected.`);
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not use symbol-keyed accessors.`);
    }
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not contain symbol keys.`);
  }

  for (const [key, descriptor] of Object.entries(descriptors)) {
    rejectUnsafePrototypeKey(key, { helperName: opts.helperName, path: opts.path });
    if (key.length === 0 || hasAsciiControlChar(key)) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} contains an invalid key.`);
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path}.${key} must not use accessors.`);
    }
    if (
      opts.rejectFunctionsSymbolsBigInts === true &&
      (typeof descriptor.value === "function" || typeof descriptor.value === "symbol" || typeof descriptor.value === "bigint")
    ) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path}.${key} must be JSON-like data.`);
    }
  }
  return value as Record<string, unknown>;
}

export function ownDataValue(record: Record<string, unknown>, key: string, opts: OwnDataValueOptions): unknown {
  const descriptors = wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} descriptors could not be inspected.`, () =>
    Object.getOwnPropertyDescriptors(record)
  );
  const descriptor = descriptors[key];
  if (descriptor === undefined) {
    if (opts.required === true) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} is required.`);
    }
    return undefined;
  }
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must be a data property.`);
  }
  return descriptor.value;
}
