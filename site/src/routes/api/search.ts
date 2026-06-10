import { createFileRoute } from '@tanstack/react-router'
import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '../../lib/source'

const server = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
})

// Static search: this route is prerendered at build time (see vite.config.ts
// pages config) so the exported Orama index ships as a static asset and the
// search dialog (type: 'static') computes queries in the browser. No server
// runs in production.
export const Route = createFileRoute('/api/search')({
  server: {
    handlers: {
      GET: async () => server.staticGET(),
    },
  },
})
