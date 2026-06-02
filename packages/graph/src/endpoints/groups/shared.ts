// WATS-132 private WhatsApp Groups API validation/building helpers.
//
// Groups hang off the business phone number id, are small (max 8
// participants excluding the business), invite-only, and business-owned.
// These helpers enforce the documented field limits and map camelCase
// public input to the snake_case Graph wire at the transport boundary.

import { GraphRequestValidationError } from "../../errors.js";
import type { GroupJoinApprovalMode } from "./types.js";

/** Subject max length (wire: `subject`). */
export const GROUP_SUBJECT_MAX_LENGTH = 128;
/** Description max length (wire: `description`). */
export const GROUP_DESCRIPTION_MAX_LENGTH = 2048;
/** Max participants excluding the business creator. */
export const GROUP_MAX_PARTICIPANTS = 8;
/** Max join requests addressable in a single approve/reject call. */
export const GROUP_MAX_JOIN_REQUESTS = 64;

const JOIN_APPROVAL_MODES: ReadonlySet<string> = new Set([
  "auto_approve",
  "approval_required"
]);

export function groupError(message: string): GraphRequestValidationError {
  return new GraphRequestValidationError(message);
}

export function groupHasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function groupIsUnsafeObjectKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function groupAssertPlainRecord(
  value: unknown,
  helperName: string,
  path = "input"
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw groupError(`Invalid ${helperName} input: ${path} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw groupError(`Invalid ${helperName} input: ${path} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw groupError(`Invalid ${helperName} input: ${path} must not define toJSON.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (groupIsUnsafeObjectKey(key)) {
      throw groupError(`Invalid ${helperName} input: ${path} contains an unsafe prototype key.`);
    }
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw groupError(`Invalid ${helperName} input: ${path}.${key} must not use accessors.`);
    }
    if (typeof descriptor.value === "function" || typeof descriptor.value === "symbol") {
      throw groupError(`Invalid ${helperName} input: ${path}.${key} must be JSON-serializable.`);
    }
  }
  return value;
}

export function groupString(
  value: unknown,
  fieldName: string,
  helperName: string,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw groupError(`Invalid ${helperName} input: ${fieldName} must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} must be non-empty.`);
  }
  if (groupHasControlChar(value)) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} must not contain control characters.`);
  }
  if (value.length > maxLength) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} exceeds ${maxLength}-character limit.`);
  }
  return value;
}

export function groupMaybeString(
  value: unknown,
  fieldName: string,
  helperName: string,
  maxLength: number
): string | undefined {
  if (value === undefined) return undefined;
  return groupString(value, fieldName, helperName, maxLength);
}

export function groupJoinApprovalMode(
  value: unknown,
  helperName: string
): GroupJoinApprovalMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !JOIN_APPROVAL_MODES.has(value)) {
    throw groupError(
      `Invalid ${helperName} input: joinApprovalMode must be one of "auto_approve" | "approval_required".`
    );
  }
  return value as GroupJoinApprovalMode;
}

/**
 * Validate a bounded, non-empty array of opaque id strings (join-request
 * ids or wa_ids), enforcing min/max and rejecting prototype-poisoned or
 * accessor-bearing arrays.
 */
export function groupStringArray(
  value: unknown,
  fieldName: string,
  helperName: string,
  min: number,
  max: number,
  itemMaxLength = 256
): string[] {
  if (!Array.isArray(value)) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} must be an array.`);
  }
  if (value.length < min || value.length > max) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} length must be between ${min} and ${max}.`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} must use Array.prototype.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.prototype.hasOwnProperty.call(descriptors, "toJSON") || "toJSON" in value) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} must not define toJSON.`);
  }
  const out: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw groupError(`Invalid ${helperName} input: ${fieldName} must not contain sparse array holes.`);
    }
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw groupError(`Invalid ${helperName} input: ${fieldName} must not use accessors.`);
    }
    out.push(groupString(descriptor.value, `${fieldName}[${index}]`, helperName, itemMaxLength));
  }
  return out;
}

/**
 * Extract a required, string-valued path-param data property safely
 * (no accessors), then run it through the field-length/control-char gate.
 * The endpoint sanitizer applies path-segment safety on top.
 */
export function groupPathParam(
  input: unknown,
  helperName: string,
  fieldName: string
): string {
  const record = groupAssertPlainRecord(input, helperName, "params");
  const descriptor = Object.getOwnPropertyDescriptor(record, fieldName);
  if (
    descriptor === undefined ||
    typeof descriptor.get === "function" ||
    typeof descriptor.set === "function" ||
    typeof descriptor.value !== "string"
  ) {
    throw groupError(`Invalid ${helperName} input: ${fieldName} must be a string data property.`);
  }
  return groupString(descriptor.value, fieldName, helperName, 256);
}
