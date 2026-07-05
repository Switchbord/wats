// playground-build/index.ts
//
// Entry surface for the wats.sh playground bundle (T18). This module is
// bundled (esbuild, browser ESM) into site/public/playground/wats-bundle.js.
//
// It re-exports the public surfaces the playground scenarios need from the
// PUBLISHED @wats/* packages (pinned 0.3.29). Named re-exports are used so a
// later import-map rewrite (`@wats/...` -> `/playground/wats-bundle.js`) stays
// trivial: scenario code can `import { GraphClient } from "@wats/graph"` and
// the rewrite resolves to this single bundle.

// ----------------------------------------------------------------------------
// Namespaces (whole-package access for advanced scenarios / completeness)
// ----------------------------------------------------------------------------
export * as core from "@wats/core";
export * as graph from "@wats/graph";
export * as types from "@wats/types";
// crypto: routed through the browser-safe subpath barrel (see crypto-browser.ts).
// The @wats/crypto MAIN entry pulls node:crypto; we expose only WebCrypto here.
export * as crypto from "./crypto-browser";
// NOTE: @wats/http is intentionally NOT re-exported. It is a server-side
// webhook-handling surface (Bun/Node/fetch adapters) and transitively depends
// on @wats/crypto's main (node:crypto) entry. None of the five playground
// scenarios (§4 of 06-playground-spec) use it; the browser bundle stays
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
  createUpdateRouter,
} from "@wats/core";

// Filters namespace (text/command/etc.) for the route-with-filters scenario.
export * as filters from "@wats/core/filters";
export * as filtersTyped from "@wats/core/filtersTyped";
