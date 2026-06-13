import type { ReactNode } from 'react'
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import appCss from '../styles/app.css?url'

const TITLE = 'wats — WhatsApp Cloud API toolkit for TypeScript'
const DESCRIPTION =
  'Composable TypeScript packages for bots, webhooks, and the Graph API. Run the whole SDK in your browser — no credentials, no install, no network.'
const ORIGIN = 'https://wats.sh'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: ORIGIN },
      { property: 'og:image', content: `${ORIGIN}/og.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: `${ORIGIN}/og.png` },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      // SVG-only favicon: every current browser supports it; no .ico shipped.
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center text-text">
      <p className="mono text-6xl font-semibold text-accent">404</p>
      <h1 className="text-2xl font-semibold">No page at that path.</h1>
      <p className="max-w-md leading-relaxed text-text-muted">
        The link is wrong or the page moved. The docs index and the playground
        are both one click away.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          to="/"
          className="rounded bg-accent px-4 py-2 font-semibold text-bg transition-colors duration-150 hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-accent"
        >
          Home
        </Link>
        <a
          href="/docs"
          className="rounded border border-border px-4 py-2 text-text transition-colors duration-150 hover:border-accent-dim focus-visible:outline-2 focus-visible:outline-accent"
        >
          Docs
        </a>
        <a
          href="/playground"
          className="rounded border border-border px-4 py-2 text-text transition-colors duration-150 hover:border-accent-dim focus-visible:outline-2 focus-visible:outline-accent"
        >
          Playground
        </a>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* First-paint guard: the stylesheet is render-blocking in theory, but
            the prerendered body can flash the UA's white canvas before it
            arrives (slow link, cold cache). Inline the background + dark
            color-scheme so the very first frame is already the right color. */}
        <style>{`html{background-color:#0a0e12;color-scheme:dark}`}</style>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return <Outlet />
}
