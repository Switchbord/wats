import { graphValidationError, wrapGraphValidation } from "./errors.js";
import { assertQueryString } from "./strings.js";

export interface DenseDataArrayOptions {
  readonly helperName: string;
  readonly path: string;
  readonly maxLength?: number;
  readonly rejectOwnToJSON?: boolean;
  readonly minLength?: number;
  readonly invalidTypeMessage?: string;
  readonly invalidLengthMessage?: string;
  readonly unsafePrototypeKeyMessage?: string;
  readonly sparseArrayMessage?: string;
  readonly unsupportedPropertyMessage?: string;
}

export interface JoinedStringQueryArrayOptions extends DenseDataArrayOptions {
  readonly maxItemLength?: number;
  readonly rejectCommas?: boolean;
  readonly commaMessage?: string;
}

function isUnsafePrototypeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

export function assertDenseDataArray(value: unknown, opts: DenseDataArrayOptions): unknown[] {
  if (!Array.isArray(value)) {
    throw graphValidationError(opts.invalidTypeMessage ?? `Invalid ${opts.helperName} input: ${opts.path} must be an array.`);
  }
  const reportedLength = wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} length could not be inspected.`, () => value.length);
  const proto = wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} could not be inspected.`, () =>
    Object.getPrototypeOf(value)
  );
  if (proto !== Array.prototype) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must use Array.prototype.`);
  }
  const descriptors = wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} descriptors could not be inspected.`, () =>
    Object.getOwnPropertyDescriptors(value)
  );
  const lengthDescriptor = wrapGraphValidation(`Invalid ${opts.helperName} input: ${opts.path} length descriptor could not be inspected.`, () =>
    Object.getOwnPropertyDescriptor(value, "length")
  );
  if (
    lengthDescriptor === undefined ||
    typeof lengthDescriptor.get === "function" ||
    typeof lengthDescriptor.set === "function" ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} length could not be inspected.`);
  }
  const length = lengthDescriptor.value;
  if (reportedLength !== length) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} has inconsistent array length.`);
  }
  const numericDescriptorKeys = Object.keys(descriptors).filter((key) => /^(0|[1-9]\d*)$/u.test(key));
  const numericDescriptorKeySet = new Set(numericDescriptorKeys);
  for (const key of numericDescriptorKeys) {
    const index = Number(key);
    if (Number.isSafeInteger(index) && index >= length) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} has indexes beyond its array length.`);
    }
  }
  if (numericDescriptorKeys.length !== length) {
    throw graphValidationError(
      opts.sparseArrayMessage ?? `Invalid ${opts.helperName} input: ${opts.path} has inconsistent array indexes.`
    );
  }
  if (length > 0 && !numericDescriptorKeySet.has(String(length - 1))) {
    throw graphValidationError(
      opts.sparseArrayMessage ?? `Invalid ${opts.helperName} input: ${opts.path} has inconsistent array indexes.`
    );
  }
  if ((opts.minLength !== undefined && length < opts.minLength) || (opts.maxLength !== undefined && length > opts.maxLength)) {
    throw graphValidationError(
      opts.invalidLengthMessage ?? `Invalid ${opts.helperName} input: ${opts.path} exceeds ${opts.maxLength}-item limit.`
    );
  }
  const symbolDescriptorKeys = Object.getOwnPropertySymbols(descriptors);
  for (const symbolKey of symbolDescriptorKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, symbolKey)?.value as PropertyDescriptor | undefined;
    if (descriptor === undefined) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} symbol descriptor could not be inspected.`);
    }
    if (symbolKey === Symbol.iterator) {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not override Array.prototype methods.`);
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not use symbol-keyed accessors.`);
    }
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not contain symbol keys.`);
  }
  for (const key of Object.keys(descriptors)) {
    if (key === "length" || /^(0|[1-9]\d*)$/u.test(key)) continue;
    if (isUnsafePrototypeKey(key)) {
      throw graphValidationError(
        opts.unsafePrototypeKeyMessage ?? `Invalid ${opts.helperName} input: ${opts.path} contains an unsafe prototype key.`
      );
    }
    if (key !== "map" && key !== "toJSON") {
      throw graphValidationError(
        opts.unsupportedPropertyMessage ?? `Invalid ${opts.helperName} input: ${opts.path} contains unsupported properties.`
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(descriptors, "map")) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not override Array.prototype methods.`);
  }
  if (opts.rejectOwnToJSON !== false && Object.prototype.hasOwnProperty.call(descriptors, "toJSON")) {
    throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not define toJSON.`);
  }
  const out: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) {
      throw graphValidationError(
        opts.sparseArrayMessage ?? `Invalid ${opts.helperName} input: ${opts.path} must not contain sparse array holes.`
      );
    }
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol" || typeof descriptor.value === "bigint") {
      throw graphValidationError(`Invalid ${opts.helperName} input: ${opts.path} must contain JSON-like data.`);
    }
    out.push(descriptor.value);
  }
  return out;
}

export function assertJoinedStringQueryArray(value: unknown, opts: JoinedStringQueryArrayOptions): string {
  const items = assertDenseDataArray(value, opts);
  const out: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = assertQueryString(items[index], {
      helperName: opts.helperName,
      fieldName: `${opts.path}[${index}]`,
      maxLength: opts.maxItemLength
    });
    if (opts.rejectCommas === true && item.includes(",")) {
      throw graphValidationError(
        opts.commaMessage ?? `Invalid ${opts.helperName} input: ${opts.path} array entries must not contain commas.`
      );
    }
    out.push(item);
  }
  return out.join(",");
}
