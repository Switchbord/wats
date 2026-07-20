// playground-build/index.ts
//
// Entry surface for the wats.sh playground bundle. This module is
// bundled (esbuild, browser ESM) into site/public/playground/wats-bundle.js.
//
// It re-exports the public surfaces the playground scenarios need from the
// PUBLISHED @wats/* packages (pinned 0.4.0-beta.0). Named re-exports are used so a
// later import-map rewrite (`@wats/...` -> `/playground/wats-bundle.js`) stays
// trivial: scenario code can `import { GraphClient } from "@wats/graph"` and
// the rewrite resolves to this single bundle.

// ----------------------------------------------------------------------------
// Namespaces (whole-package access for advanced scenarios / completeness)
// ----------------------------------------------------------------------------
// NOTE: `@wats/core` is intentionally NOT re-exported as a namespace.
// Scenario code reaches `@wats/core` through the explicit named re-exports
// below plus the `filtersTyped` subpath namespace, which keeps the browser
// bundle minimal. (The pre-0.4 published barrel also carried the legacy
// router/parser surface; that surface was removed in 0.4.0-beta.0, but the
// named-export shape stays because the scenarios use it.)
export * as graph from "@wats/graph";
export * as types from "@wats/types";
// crypto: routed through the browser-safe subpath barrel (see crypto-browser.ts).
// The @wats/crypto MAIN entry pulls node:crypto; we expose only WebCrypto here.
export * as crypto from "./crypto-browser";
// NOTE: @wats/http is intentionally NOT re-exported. It is a server-side
// webhook-handling surface (Bun/Node/fetch adapters) and transitively depends
// on @wats/crypto's main (node:crypto) entry. None of the five playground
// scenarios (see the scenario list in README) use it; the browser bundle stays
// node-builtin-free by omitting it. See bundle report "node-builtin findings".

// ----------------------------------------------------------------------------
// @wats/graph — client surface used by scenarios
// ----------------------------------------------------------------------------
export {
  GraphClient,
  PhoneNumberClient,
  validatePhoneNumberClientConfig,
  GroupClient,
  validateGroupClientConfig,
  WABAClient,
  validateWABAClientConfig,
  createFetchTransport,
} from "@wats/graph";

// Typed-error classes used by the typed-errors scenario (instanceof checks).
export {
  GraphApiError,
  GraphAuthError,
  GraphNetworkError,
  GraphRateLimitError,
  GraphRequestValidationError,
  GraphSerializationError,
  GenericError,
  UnknownError,
} from "@wats/graph";

// MockTransport — the proof-of-no-network primitive. From the ./testing subpath.
export { createMockTransport } from "@wats/graph/testing";

// ----------------------------------------------------------------------------
// @wats/core — facade, normalizer, routing
// ----------------------------------------------------------------------------
export {
  WhatsApp,
  normalizeWebhookEnvelope,
  WebhookNormalizationError,
  TypedRouter,
} from "@wats/core";

// Typed filters namespace for the route-with-filters scenario.
export * as filtersTyped from "@wats/core/filtersTyped";
