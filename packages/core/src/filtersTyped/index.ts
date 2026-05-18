// @wats/core — filtersTyped/index.ts (F-9 barrel)
//
// Public surface of the typed-filter module. Consumers mount via:
//
//   import {
//     message, status, account, unknown,
//     and, or, not, custom,
//     createTypedFilter, isTypedFilter,
//     FilterValidationError, FILTER_BRAND,
//     type TypedFilter
//   } from "@wats/core/filtersTyped";
//
// `message` and `status` are callable namespaces — they ARE the
// kind filter (narrow to their TypedUpdate variant) AND carry the
// built-in factory methods for that kind.

export type {
  TypedFilter,
  FilterValidationErrorCode
} from "./typedFilter.js";
export {
  FILTER_BRAND,
  FilterValidationError,
  createTypedFilter,
  isTypedFilter
} from "./typedFilter.js";

export { account, unknown } from "./core.js";
export { and, or, not, custom } from "./combinators.js";
export { message, type MessageFilterNamespace } from "./message.js";
export { status, type StatusFilterNamespace } from "./status.js";
export { call, type CallFilterNamespace } from "./call.js";
export { template, type TemplateFilterNamespace } from "./template.js";
