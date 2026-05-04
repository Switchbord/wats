// @wats/core — filtersTyped/template.ts (WATS-39)
//
// Template account-event filters. These are sibling-safe: non-account updates
// and account updates without normalized template helper fields return false.

import type { TypedAccountUpdate, TypedUpdate } from "../webhookNormalizer";
import {
  FILTER_BRAND,
  FilterValidationError,
  type TypedFilter
} from "./typedFilter";

function buildFilter(
  predicate: (u: TypedUpdate) => u is TypedAccountUpdate,
  describe: string
): TypedFilter<TypedAccountUpdate> {
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => describe
  });
}

function isTemplateAccountUpdate(u: TypedUpdate): u is TypedAccountUpdate {
  return u.kind === "account" && u.template !== undefined;
}

function assertOptionalNonEmptyString(
  value: unknown,
  label: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new FilterValidationError(
      "invalid_predicate",
      `${label}: value must be a string when provided.`
    );
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new FilterValidationError(
      "empty_substring",
      `${label}: value must be non-empty.`
    );
  }
  return value;
}

function status(event?: string): TypedFilter<TypedAccountUpdate> {
  const expected = assertOptionalNonEmptyString(event, "template.status");
  return buildFilter((u: TypedUpdate): u is TypedAccountUpdate => {
    if (!isTemplateAccountUpdate(u)) return false;
    if (u.eventName !== "message_template_status_update") return false;
    if (expected === undefined) return true;
    return u.template?.event === expected;
  }, expected === undefined ? "template.status()" : `template.status(${JSON.stringify(expected)})`);
}

function byTemplateField(
  field: "name" | "id" | "language",
  value: string
): TypedFilter<TypedAccountUpdate> {
  const expected = assertOptionalNonEmptyString(value, `template.${field}`) as string;
  return buildFilter((u: TypedUpdate): u is TypedAccountUpdate => {
    if (!isTemplateAccountUpdate(u)) return false;
    return u.template?.[field] === expected;
  }, `template.${field}(${JSON.stringify(expected)})`);
}

export interface TemplateFilterNamespace extends TypedFilter<TypedAccountUpdate> {
  status(event?: string): TypedFilter<TypedAccountUpdate>;
  name(value: string): TypedFilter<TypedAccountUpdate>;
  id(value: string): TypedFilter<TypedAccountUpdate>;
  language(value: string): TypedFilter<TypedAccountUpdate>;
}

const templatePredicate = (u: TypedUpdate): u is TypedAccountUpdate =>
  isTemplateAccountUpdate(u);

export const template: TemplateFilterNamespace = Object.freeze({
  [FILTER_BRAND]: true as const,
  predicate: templatePredicate,
  describe: () => "template",
  status,
  name: (value: string) => byTemplateField("name", value),
  id: (value: string) => byTemplateField("id", value),
  language: (value: string) => byTemplateField("language", value)
});
