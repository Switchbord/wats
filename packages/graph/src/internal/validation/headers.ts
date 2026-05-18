import { graphValidationError, wrapGraphValidation } from "./errors.js";
import { hasAsciiControlChar } from "./strings.js";
import { isUnsafePrototypeKey } from "./records.js";

type HeaderDescriptorMap = { [key: string]: PropertyDescriptor; [key: symbol]: PropertyDescriptor };

export interface HeaderInitValidationOptions {
  readonly helperName: string;
  readonly path: string;
  readonly invalidTypeMessage?: string;
  readonly inspectMessage?: string;
  readonly descriptorInspectMessage?: string;
  readonly accessorMessage?: string;
  readonly nonStringValueMessage?: string;
  readonly unsafePrototypeKeyMessage?: string;
  readonly invalidKeyMessage?: string;
  readonly symbolAccessorMessage?: string;
  readonly symbolKeyMessage?: string;
  readonly ownToJSONMessage?: string;
}

function invalidTypeMessage(opts: HeaderInitValidationOptions): string {
  return opts.invalidTypeMessage ?? `Invalid ${opts.helperName} input: ${opts.path} must be a plain object.`;
}

function inspectMessage(opts: HeaderInitValidationOptions): string {
  return opts.inspectMessage ?? `Invalid ${opts.helperName} input: ${opts.path} could not be inspected.`;
}

function descriptorInspectMessage(opts: HeaderInitValidationOptions): string {
  return opts.descriptorInspectMessage ?? `Invalid ${opts.helperName} input: ${opts.path} descriptors could not be inspected.`;
}

function accessorMessage(opts: HeaderInitValidationOptions): string {
  return opts.accessorMessage ?? `Invalid ${opts.helperName} input: ${opts.path} must not use accessors.`;
}

function nonStringValueMessage(opts: HeaderInitValidationOptions): string {
  return opts.nonStringValueMessage ?? `Invalid ${opts.helperName} input: ${opts.path} values must be strings.`;
}

function unsafePrototypeKeyMessage(opts: HeaderInitValidationOptions): string {
  return opts.unsafePrototypeKeyMessage ?? `Invalid ${opts.helperName} input: ${opts.path} contains an unsafe prototype key.`;
}

function invalidKeyMessage(opts: HeaderInitValidationOptions): string {
  return opts.invalidKeyMessage ?? `Invalid ${opts.helperName} input: ${opts.path} contains an invalid key.`;
}

function symbolAccessorMessage(opts: HeaderInitValidationOptions): string {
  return opts.symbolAccessorMessage ?? `Invalid ${opts.helperName} input: ${opts.path} must not use symbol-keyed accessors.`;
}

function symbolKeyMessage(opts: HeaderInitValidationOptions): string {
  return opts.symbolKeyMessage ?? `Invalid ${opts.helperName} input: ${opts.path} must not contain symbol keys.`;
}

function ownToJSONMessage(opts: HeaderInitValidationOptions): string {
  return opts.ownToJSONMessage ?? `Invalid ${opts.helperName} input: ${opts.path} must not define toJSON.`;
}

export function sanitizeHeaderInit(headers: unknown, opts: HeaderInitValidationOptions): Headers | Record<string, string> {
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw graphValidationError(invalidTypeMessage(opts));
  }

  const proto = wrapGraphValidation(inspectMessage(opts), () => Object.getPrototypeOf(headers));
  if (proto === Headers.prototype) {
    wrapGraphValidation(inspectMessage(opts), () => Headers.prototype.has.call(headers, "x-wats-brand-check"));
    return wrapGraphValidation(inspectMessage(opts), () => new Headers(headers as Headers));
  }
  if (proto !== Object.prototype && proto !== null) {
    throw graphValidationError(invalidTypeMessage(opts));
  }

  const descriptors = wrapGraphValidation(
    descriptorInspectMessage(opts),
    () => Object.getOwnPropertyDescriptors(headers) as HeaderDescriptorMap
  );
  const out: Record<string, string> = {};

  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (descriptor === undefined) {
      throw graphValidationError(descriptorInspectMessage(opts));
    }
    if (typeof key === "symbol") {
      if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
        throw graphValidationError(symbolAccessorMessage(opts));
      }
      throw graphValidationError(symbolKeyMessage(opts));
    }
    if (key === "toJSON") {
      throw graphValidationError(ownToJSONMessage(opts));
    }
    if (isUnsafePrototypeKey(key)) {
      throw graphValidationError(unsafePrototypeKeyMessage(opts));
    }
    if (key.length === 0 || hasAsciiControlChar(key)) {
      throw graphValidationError(invalidKeyMessage(opts));
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw graphValidationError(accessorMessage(opts));
    }
    if (typeof descriptor.value !== "string") {
      throw graphValidationError(nonStringValueMessage(opts));
    }
    out[key] = descriptor.value;
  }

  return out;
}
