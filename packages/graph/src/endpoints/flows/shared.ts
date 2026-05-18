// WATS-66 private WhatsApp Flow validation helpers.

import { GraphRequestValidationError } from "../../errors.js";

export const FLOW_JSON_MAX_DEPTH = 16;
export const FLOW_JSON_MAX_ARRAY_LENGTH = 1_000;
export const FLOW_JSON_MAX_SCREENS = 50;
export const FLOW_JSON_MAX_COMPONENTS = 1_000;
export const FLOW_JSON_MAX_STRING_LENGTH = 16_384;
export const FLOW_JSON_MAX_BYTES = 131_072;
export const FLOW_MAX_CATEGORIES = 5;

export function flowError(message: string): GraphRequestValidationError {
  return new GraphRequestValidationError(message);
}

export function flowHasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function flowIsUnsafeObjectKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

export function flowIsPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flowAssertPlainRecord(value: unknown, helperName: string, path = "input"): Record<string, unknown> {
  if (!flowIsPlainObject(value)) {
    throw flowError(`Invalid ${helperName} input: ${path} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw flowError(`Invalid ${helperName} input: ${path} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw flowError(`Invalid ${helperName} input: ${path} must not define toJSON.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw flowError(`Invalid ${helperName} input: ${path}.${key} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol") {
      throw flowError(`Invalid ${helperName} input: ${path}.${key} must be JSON-serializable.`);
    }
  }
  return value;
}

export function flowString(value: unknown, fieldName: string, helperName: string, maxLength = 512): string {
  if (typeof value !== "string") {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be non-empty.`);
  }
  if (flowHasControlChar(value)) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not contain control characters.`);
  }
  if (value.length > maxLength) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} exceeds ${maxLength}-character limit.`);
  }
  return value;
}

export function flowMaybeString(value: unknown, fieldName: string, helperName: string, maxLength = 512): string | undefined {
  if (value === undefined) return undefined;
  return flowString(value, fieldName, helperName, maxLength);
}

export function flowUrl(value: unknown, fieldName: string, helperName: string): string {
  const urlValue = flowString(value, fieldName, helperName, 2_048);
  if (urlValue !== urlValue.trim()) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not contain leading/trailing whitespace.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be an absolute http(s) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw flowError(`Invalid ${helperName} input: ${fieldName} protocol must be http: or https:.`);
  }
  return urlValue;
}

export function flowArray(value: unknown, fieldName: string, min: number, max: number, helperName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must be an array.`);
  }
  if (value.length < min || value.length > max) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} length must be between ${min} and ${max}.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must use Array.prototype.`);
  }
  if (Object.prototype.hasOwnProperty.call(value, Symbol.iterator) || Object.prototype.hasOwnProperty.call(value, "map")) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not override Array.prototype methods.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw flowError(`Invalid ${helperName} input: ${fieldName} must not define toJSON.`);
  }
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw flowError(`Invalid ${helperName} input: ${fieldName} must not contain sparse array holes.`);
    }
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw flowError(`Invalid ${helperName} input: ${fieldName} must not use accessors.`);
    }
    out.push(descriptor.value);
  }
  return out;
}
