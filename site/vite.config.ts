import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mdx from 'fumadocs-mdx/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ isSsrBuild }) => ({
  resolve: {
    // Force a single @codemirror/view copy — bun's shared monorepo store keeps
    // both 6.41 and 6.43; without dedupe the editor's keymap Commands fail to
    // typecheck/interop across the two instances.
    dedupe: ['@codemirror/view', '@codemirror/state'],
    alias: {
      'collections/server': fileURLToPath(
        new URL('./.source/server.ts', import.meta.url),
      ),
      'collections/browser': fileURLToPath(
        new URL('./.source/browser.ts', import.meta.url),
      ),
      // CLIENT build only: fumadocs-core's loader does `import path from
      // "node:path"` and calls path.join/dirname while building the page tree
      // at module-eval. Vite externalizes node:path -> undefined for the
      // browser, so those calls throw `(void 0) is not a function` and reject
      // the entry module's top-level await — which silently breaks client
      // hydration (prerendered docs survive; the playground's lazy chunk hangs
      // forever). Point node:path at a small POSIX shim so the browser build
      // resolves cleanly. The SSR/prerender build keeps the real node:path.
      ...(isSsrBuild
        ? {}
        : {
            'node:path': fileURLToPath(
              new URL('./src/lib/path-browser-shim.ts', import.meta.url),
            ),
          }),
    },
  },
  plugins: [
    mdx(),
    tailwindcss(),
    tanstackStart({
      // Per-route code splitting: keeps fumadocs-ui (docs routes) out of the
      // landing entry chunk — landing JS budget is ≤100KB gz (T12 M1).
      // NOTE: autoCodeSplitting is in the runtime zod schema (validated) but
      // missing from the published input *type* in start-plugin-core 1.171.17.
      // @ts-expect-error -- type lag, see note above
      router: { autoCodeSplitting: true },
      prerender: {
        enabled: true,
        crawlLinks: true,
        autoSubfolderIndex: true,
        failOnError: true,
      },
      pages: [{ path: '/docs' }, { path: '/api/search' }],
    }),
    viteReact(),
  ],
}))
