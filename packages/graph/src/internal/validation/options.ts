import { graphValidationError, wrapGraphValidation } from "./errors.js";
import { assertPlainDataRecord } from "./records.js";

export function copyOptionalParamsObject(params: unknown, helperName: string): Record<string, unknown> {
  if (params === undefined) return {};
  const record = assertPlainDataRecord(params, {
    helperName,
    path: "params"
  });
  const out: Record<string, unknown> = {};
  const descriptors = wrapGraphValidation(`Invalid ${helperName} params: descriptors could not be inspected.`, () =>
    Object.getOwnPropertyDescriptors(record)
  );
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor.value !== undefined) out[key] = descriptor.value;
  }
  return out;
}

export function splitRequiredStringDataProp(
  params: unknown,
  propName: string,
  helperName: string
): { readonly value: string; readonly rest: Record<string, unknown> } {
  const record = assertPlainDataRecord(params, {
    helperName,
    path: "params"
  });
  const descriptors = wrapGraphValidation(`Invalid ${helperName} params: descriptors could not be inspected.`, () =>
    Object.getOwnPropertyDescriptors(record)
  );
  const prop = descriptors[propName];
  if (prop === undefined || typeof prop.value !== "string") {
    throw graphValidationError(`Invalid ${helperName} params: ${propName} must be a string data property.`);
  }
  const rest: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === propName) continue;
    if (descriptor.value !== undefined) rest[key] = descriptor.value;
  }
  return { value: prop.value, rest };
}
