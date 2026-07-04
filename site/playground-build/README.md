# playground-build — wats.sh playground asset pipeline (T18)

Isolated mini-package that bundles the PUBLISHED `@wats/*` packages (pinned
`0.3.28`) into the two static assets the `/playground` route will load at
runtime (T19). It is **not** part of the `site` build graph and adds no deps to
`site/package.json`.

## Outputs (committed to site/public/playground/)

- `wats-bundle.js`  — single browser ESM file (esbuild, platform=browser,
  target=es2022, minified). Bare `@wats/...` imports in scenario code get
  rewritten to this file via an import map (T19, §3 of 06-playground-spec).
- `wats-types.d.ts` — self-contained ambient declarations (dts-bundle-generator
  with `--external-inlines` for all five `@wats/*`), for the CodeMirror TS
  integration.

## Commands

    bun install          # installs pinned published deps into THIS package
    bun run bundle.ts    # builds both assets; enforces gz < 150KB; prints sizes
    bun run smoke.ts     # imports the BUILT bundle, runs sendText, prints request

## Entry surface

`index.ts` re-exports (named + namespace) the surfaces the five v1 scenarios
need: `GraphClient`, `PhoneNumberClient`, the `Graph*Error` classes, group/waba
clients, `createMockTransport` (from `@wats/graph/testing`), and from
`@wats/core`: `WhatsApp`, `normalizeWebhookEnvelope`, `TypedRouter`,
`createUpdateRouter`, plus `filters` / `filtersTyped` namespaces.

## Pinned versions

@wats/core 0.3.28 · @wats/graph 0.3.28 · @wats/http 0.3.28 ·
@wats/types 0.3.28 · @wats/crypto 0.3.28

## node-builtin FINDING (must carry forward)

`@wats/crypto`'s MAIN entry (`.` -> `dist/index.js`) statically re-exports
`createNodeCryptoProvider`, which does `await import("node:crypto")`. The
package ships NO `browser` export condition, so importing `@wats/crypto` in a
browser-targeted bundle pulls in `node:crypto`. `@wats/http` transitively hits
the same path (it `import`s from `@wats/crypto`).

Resolution (no shimming):
- `crypto-browser.ts` re-exports ONLY the package's own browser-safe surfaces:
  `@wats/crypto/webcrypto` (`createWebCryptoProvider`, uses
  `globalThis.crypto.subtle`) and `@wats/crypto/errors`.
- `@wats/http` is intentionally NOT bundled — it is a server-side webhook
  surface that no playground scenario uses. It remains pinned in package.json
  per the task spec but is excluded from the entry.
- The bundle script has a hard gate: any `node:*` / node-builtin reaching the
  browser graph fails the build and is reported, not silently shimmed.
- Result: `@wats/graph` and `@wats/core` are node-builtin-free; the emitted
  bundle contains zero `node:` references and no `process`/`Buffer`/`require`.

Upstream follow-up suggestion (not in T18 scope): add a `browser` export
condition to `@wats/crypto` so `.` resolves to the WebCrypto adapter in browser
bundlers.

## Determinism

`wats-bundle.js` and `wats-types.d.ts` regenerate byte-identically (verified via
sha256 across two runs). The wiring of a no-diff regeneration check into
`site` `check` is deferred to T19/T20 per the task boundary.
