// WATS-65 message-template send-time parameter-count validation.

import { TemplateParamCountMismatchError } from "../../errorSubclasses.js";
import type {
  SendTemplateComponentForValidation,
  TemplateComponent,
  TemplateDefinitionForValidation,
  TemplateParameterFormat
} from "./types.js";
import {
  TEMPLATE_MAX_ARRAY,
  TEMPLATE_MAX_COMPONENTS,
  assertArray,
  assertPlainRecord,
  assertString,
  hasControlChar,
  isPlainObject,
  safeJsonClone,
  validationError
} from "./shared.js";

function mismatchError(message: string): TemplateParamCountMismatchError {
  return new TemplateParamCountMismatchError({
    status: 400,
    payload: { message, type: "ValidationError", code: 132000 },
    headers: new Headers(),
    requestUrl: "wats://local/template-parameter-validation"
  });
}

function componentText(component: unknown): string | undefined {
  if (!isPlainObject(component)) return undefined;
  const safe = safeJsonClone(component, "validateTemplateParameterCounts", "definition.component");
  if (!isPlainObject(safe)) return undefined;
  const type = typeof safe.type === "string" ? safe.type.toUpperCase() : "";
  if (type !== "HEADER" && type !== "BODY") return undefined;
  return typeof safe.text === "string" ? safe.text : undefined;
}

function placeholders(text: string, format: TemplateParameterFormat): string[] {
  const found: string[] = [];
  const rx = /\{\{\s*([^{}\s]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(text)) !== null) {
    const token = match[1] ?? "";
    if (format === "POSITIONAL" && /^\d+$/.test(token)) found.push(token);
    else if (format === "NAMED" && !/^\d+$/.test(token)) found.push(token);
  }
  return Array.from(new Set(found));
}

function getComponentKind(component: unknown): string | undefined {
  if (!isPlainObject(component)) return undefined;
  const safe = safeJsonClone(component, "validateTemplateParameterCounts", "definition.component");
  if (!isPlainObject(safe) || typeof safe.type !== "string") return undefined;
  return safe.type.toUpperCase();
}

function getSendParameterNames(component: SendTemplateComponentForValidation, helperName: string): string[] {
  const safeComponent = safeJsonClone(component, helperName, "sendComponent");
  if (!isPlainObject(safeComponent)) {
    throw validationError(`Invalid ${helperName} input: sendComponent must be an object.`);
  }
  const params = safeComponent.parameters;
  if (params === undefined) return [];
  const arr = assertArray(params, "component.parameters", 0, TEMPLATE_MAX_ARRAY, helperName);
  const names: string[] = [];
  for (let index = 0; index < arr.length; index += 1) {
    const entry = arr[index];
    if (!isPlainObject(entry)) continue;
    const value = entry.parameter_name;
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || hasControlChar(value)) {
      throw validationError(`Invalid ${helperName} input: component.parameters[${index}].parameter_name must be a safe string.`);
    }
    names.push(value);
  }
  return names;
}

export function validateTemplateParameterCounts(
  definition: TemplateDefinitionForValidation,
  sendComponents: readonly SendTemplateComponentForValidation[]
): void {
  const helperName = "validateTemplateParameterCounts";
  const defRecord = assertPlainRecord(definition, helperName, "definition");
  const formatRaw = defRecord.parameterFormat ?? defRecord.parameter_format ?? "POSITIONAL";
  const format = assertString(formatRaw, "parameterFormat", helperName, 32).toUpperCase() as TemplateParameterFormat;
  if (format !== "POSITIONAL" && format !== "NAMED") throw validationError(`Invalid ${helperName} input: parameterFormat must be POSITIONAL or NAMED.`);
  const defComponents = assertArray(defRecord.components, "definition.components", 0, TEMPLATE_MAX_COMPONENTS, helperName);
  const sendArr = assertArray(sendComponents, "sendComponents", 0, TEMPLATE_MAX_COMPONENTS, helperName);
  const byType = new Map<string, SendTemplateComponentForValidation>();
  for (const entry of sendArr) {
    const safeEntry = safeJsonClone(entry, helperName, "sendComponent");
    const rec = assertPlainRecord(safeEntry, helperName, "sendComponent");
    const kind = assertString(rec.type, "sendComponent.type", helperName, 32).toUpperCase();
    if (kind === "HEADER" || kind === "BODY") byType.set(kind, rec as SendTemplateComponentForValidation);
  }
  for (const defComponent of defComponents) {
    const kind = getComponentKind(defComponent);
    const text = componentText(defComponent);
    if ((kind !== "HEADER" && kind !== "BODY") || text === undefined) continue;
    const expectedTokens = placeholders(text, format);
    const sendComponent = byType.get(kind);
    const actual = sendComponent?.parameters === undefined
      ? []
      : assertArray(sendComponent.parameters, "component.parameters", 0, TEMPLATE_MAX_ARRAY, helperName);
    if (format === "NAMED") {
      const names = getSendParameterNames(sendComponent ?? { type: kind, parameters: [] }, helperName);
      const missing = expectedTokens.filter((token) => !names.includes(token));
      const extra = names.filter((name) => !expectedTokens.includes(name));
      if (missing.length > 0 || extra.length > 0 || names.length !== expectedTokens.length) {
        throw mismatchError(`Template ${kind} named parameters mismatch: expected [${expectedTokens.join(",")}] got [${names.join(",")}].`);
      }
    } else if (actual.length !== expectedTokens.length) {
      throw mismatchError(`Template ${kind} parameter count mismatch: expected ${expectedTokens.length}, got ${actual.length}.`);
    }
  }
}
