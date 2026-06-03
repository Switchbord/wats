// @wats/core — WATS-79 webhook-family typed filters.

import type {
  TypedChatOpenedUpdate,
  TypedSystemUpdate,
  TypedUpdate,
  TypedUserPreferencesUpdate
} from "../webhookNormalizer.js";
import {
  FILTER_BRAND,
  FilterValidationError,
  type TypedFilter
} from "./typedFilter.js";

function buildFilter<T extends TypedUpdate>(
  predicate: (u: TypedUpdate) => u is T,
  describe: string
): TypedFilter<T> {
  return Object.freeze({
    [FILTER_BRAND]: true as const,
    predicate,
    describe: () => describe
  });
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new FilterValidationError("invalid_predicate", `${label}: value must be a string.`);
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new FilterValidationError("empty_substring", `${label}: value must be non-empty.`);
  }
  return value;
}

export interface UserPreferencesFilterNamespace extends TypedFilter<TypedUserPreferencesUpdate> {
  preference(value: "opt_in" | "opt_out"): TypedFilter<TypedUserPreferencesUpdate>;
  category(value: string): TypedFilter<TypedUserPreferencesUpdate>;
}

export interface SystemFilterNamespace extends TypedFilter<TypedSystemUpdate> {
  phoneNumberChange(): TypedFilter<TypedSystemUpdate>;
  identityChange(): TypedFilter<TypedSystemUpdate>;
}

export interface ChatOpenedFilterNamespace extends TypedFilter<TypedChatOpenedUpdate> {
  requestWelcome(): TypedFilter<TypedChatOpenedUpdate>;
}

export const userPreferences: UserPreferencesFilterNamespace = Object.freeze({
  [FILTER_BRAND]: true as const,
  predicate: (u: TypedUpdate): u is TypedUserPreferencesUpdate => u.kind === "userPreferences",
  describe: () => "userPreferences",
  preference: (value: "opt_in" | "opt_out"): TypedFilter<TypedUserPreferencesUpdate> => {
    const expected = assertNonEmptyString(value, "userPreferences.preference");
    if (expected !== "opt_in" && expected !== "opt_out") {
      throw new FilterValidationError("invalid_predicate", "userPreferences.preference: value must be opt_in or opt_out.");
    }
    return buildFilter(
      (u): u is TypedUserPreferencesUpdate => u.kind === "userPreferences" && u.preference.preference === expected,
      `userPreferences.preference(${JSON.stringify(expected)})`
    );
  },
  category: (value: string): TypedFilter<TypedUserPreferencesUpdate> => {
    const expected = assertNonEmptyString(value, "userPreferences.category");
    return buildFilter(
      (u): u is TypedUserPreferencesUpdate => u.kind === "userPreferences" && u.preference.category === expected,
      `userPreferences.category(${JSON.stringify(expected)})`
    );
  }
});

export const system: SystemFilterNamespace = Object.freeze({
  [FILTER_BRAND]: true as const,
  predicate: (u: TypedUpdate): u is TypedSystemUpdate => u.kind === "system",
  describe: () => "system",
  phoneNumberChange: (): TypedFilter<TypedSystemUpdate> => buildFilter(
    (u): u is TypedSystemUpdate => u.kind === "system" && u.system.type === "phoneNumberChange",
    "system.phoneNumberChange()"
  ),
  identityChange: (): TypedFilter<TypedSystemUpdate> => buildFilter(
    (u): u is TypedSystemUpdate => u.kind === "system" && u.system.type === "identityChange",
    "system.identityChange()"
  )
});

export const chatOpened: ChatOpenedFilterNamespace = Object.freeze({
  [FILTER_BRAND]: true as const,
  predicate: (u: TypedUpdate): u is TypedChatOpenedUpdate => u.kind === "chatOpened",
  describe: () => "chatOpened",
  requestWelcome: (): TypedFilter<TypedChatOpenedUpdate> => buildFilter(
    (u): u is TypedChatOpenedUpdate => u.kind === "chatOpened" && u.chatOpened.type === "REQUEST_WELCOME",
    "chatOpened.requestWelcome()"
  )
});
