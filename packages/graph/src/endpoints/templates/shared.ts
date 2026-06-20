// WATS-65 private message-template validation/building helpers.

import { GraphRequestValidationError } from "../../errors.js";
import type {
  TemplateComponent,
  TemplateParameterFormat
} from "./types.js";

export const TEMPLATE_NAME_MAX_LENGTH = 512;
export const TEMPLATE_TEXT_MAX_LENGTH = 4096;
export const TEMPLATE_SHORT_TEXT_MAX_LENGTH = 1024;
export const TEMPLATE_MAX_COMPONENTS = 20;
export const TEMPLATE_MAX_BUTTONS = 10;
export const TEMPLATE_MAX_ARRAY = 100;
export const TEMPLATE_MAX_DEPTH = 8;

export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validationError(message: string): GraphRequestValidationError {
  return new GraphRequestValidationError(message);
}


export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertPlainRecord(value: unknown, helperName: string, path = "input"): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw validationError(`Invalid ${helperName} input: ${path} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw validationError(`Invalid ${helperName} input: ${path} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw validationError(`Invalid ${helperName} input: ${path} must not define toJSON.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw validationError(`Invalid ${helperName} input: ${path}.${key} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol") {
      throw validationError(`Invalid ${helperName} input: ${path}.${key} must be JSON-serializable.`);
    }
  }
  return value;
}

export function assertString(value: unknown, fieldName: string, helperName: string, maxLength = TEMPLATE_NAME_MAX_LENGTH): string {
  if (typeof value !== "string") {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be non-empty.`);
  }
  if (hasControlChar(value)) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must not contain control characters (CR/LF/NUL/etc.).`);
  }
  if (value.length > maxLength) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} exceeds ${maxLength}-character limit.`);
  }
  return value;
}

export function maybeString(value: unknown, fieldName: string, helperName: string, maxLength = TEMPLATE_NAME_MAX_LENGTH): string | undefined {
  if (value === undefined) return undefined;
  return assertString(value, fieldName, helperName, maxLength);
}

export function assertArray(value: unknown, fieldName: string, min: number, max: number, helperName: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must be an array.`);
  }
  if (value.length < min || value.length > max) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} length must be between ${min} and ${max}.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must use Array.prototype.`);
  }
  if (Object.prototype.hasOwnProperty.call(value, Symbol.iterator) || Object.prototype.hasOwnProperty.call(value, "map")) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must not override Array.prototype methods.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw validationError(`Invalid ${helperName} input: ${fieldName} must not define toJSON.`);
  }
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) {
      throw validationError(`Invalid ${helperName} input: ${fieldName} must not contain sparse array holes.`);
    }
    const descriptor = descriptors[String(i)];
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw validationError(`Invalid ${helperName} input: ${fieldName} must not use accessors.`);
    }
    copy.push(descriptor.value);
  }
  return copy;
}

export function safeJsonClone(value: unknown, helperName: string, path = "input", seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > TEMPLATE_MAX_DEPTH) {
    throw validationError(`Invalid ${helperName} input: ${path} exceeds maximum nesting depth.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (hasControlChar(value)) throw validationError(`Invalid ${helperName} input: ${path} contains control characters.`);
    if (value.length > TEMPLATE_TEXT_MAX_LENGTH) throw validationError(`Invalid ${helperName} input: ${path} string exceeds limit.`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw validationError(`Invalid ${helperName} input: ${path} contains a non-finite number.`);
    return value;
  }
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw validationError(`Invalid ${helperName} input: ${path} must not contain cycles.`);
    seen.add(value);
    const arr = assertArray(value, path, 0, TEMPLATE_MAX_ARRAY, helperName);
    const out: unknown[] = [];
    for (let index = 0; index < arr.length; index += 1) {
      out.push(safeJsonClone(arr[index], helperName, `${path}[${index}]`, seen, depth + 1));
    }
    seen.delete(value);
    return out;
  }
  const record = assertPlainRecord(value, helperName, path);
  if (seen.has(record)) throw validationError(`Invalid ${helperName} input: ${path} must not contain cycles.`);
  seen.add(record);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key.length === 0 || hasControlChar(key) || key.length > TEMPLATE_SHORT_TEXT_MAX_LENGTH) {
      throw validationError(`Invalid ${helperName} input: ${path} contains an invalid key.`);
    }
    const cloned = safeJsonClone(nested, helperName, `${path}.${key}`, seen, depth + 1);
    if (cloned !== undefined) out[key] = cloned;
  }
  seen.delete(record);
  return out;
}

export function maybeExample(value: unknown, helperName: string): unknown {
  if (value === undefined) return undefined;
  const cloned = safeJsonClone(value, helperName, "example");
  if (isPlainObject(cloned)) {
    const rec = cloned as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(rec)) {
      if (key === "headerHandle") out.header_handle = nested;
      else if (key === "bodyText") out.body_text = nested;
      else out[key] = nested;
    }
    return out;
  }
  return cloned;
}

export function normalizeComponent(value: unknown, helperName: string): TemplateComponent {
  const cloned = safeJsonClone(value, helperName, "component");
  const record = assertPlainRecord(cloned, helperName, "component");
  const type = assertString(record.type, "component.type", helperName, TEMPLATE_SHORT_TEXT_MAX_LENGTH).toUpperCase();
  const out: Record<string, unknown> = { ...record, type };
  return out as TemplateComponent;
}

export function normalizeComponents(value: unknown, helperName: string, required: boolean): TemplateComponent[] | undefined {
  if (value === undefined) {
    if (required) throw validationError(`Invalid ${helperName} input: components must be provided.`);
    return undefined;
  }
  const arr = assertArray(value, "components", required ? 1 : 0, TEMPLATE_MAX_COMPONENTS, helperName);
  const out: TemplateComponent[] = [];
  for (const entry of arr) {
    out.push(normalizeComponent(entry, helperName));
  }
  return out;
}

export function mapCommonBodyFields(record: Record<string, unknown>, helperName: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (key === "parameterFormat") out.parameter_format = assertString(value, "parameterFormat", helperName, 32);
    else if (key === "libraryTemplateName") out.library_template_name = assertString(value, "libraryTemplateName", helperName);
    else if (key === "libraryTemplateBodyInputs") out.library_template_body_inputs = safeJsonClone(value, helperName, "libraryTemplateBodyInputs");
    else if (key === "libraryTemplateButtonInputs") out.library_template_button_inputs = safeJsonClone(value, helperName, "libraryTemplateButtonInputs");
    else if (key === "messageSendTtlSeconds") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw validationError(`Invalid ${helperName} input: messageSendTtlSeconds must be a non-negative integer.`);
      }
      out.message_send_ttl_seconds = value;
    } else if (key === "components") {
      const components = normalizeComponents(value, helperName, false);
      if (components !== undefined) out.components = components;
    } else {
      out[key] = safeJsonClone(value, helperName, key);
    }
  }
  return out;
}
