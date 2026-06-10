import { createFileRoute, notFound } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { source } from '../../lib/source'

// All fumadocs-ui code lives in the lazily-loaded -docs-page module so the
// landing entry chunk never includes it (T12 M1 — landing JS ≤100KB gz).
const DocsRoutePage = lazy(() =>
  import('./-docs-page').then((m) => ({ default: m.DocsRoutePage })),
)

// Isomorphic loader — NO createServerFn. This is a fully static deploy with no
// server runtime, so a server function would 404 on client-side navigation
// (it only "worked" on direct loads because the data was baked in at
// prerender). `source` is built from the eagerly-bundled collection, so
// getPage / serializePageTree run identically at build time and in the browser.
export const Route = createFileRoute('/docs/$')({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/') ?? []
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    const data = {
      path: page.path,
      pageTree: await source.serializePageTree(source.getPageTree()),
    }

    const mod = await import('./-docs-page')
    await mod.clientLoader.preload(data.path)
    return data
  },
})

function Page() {
  const data = Route.useLoaderData()

  return (
    <Suspense>
      <DocsRoutePage data={data} />
    </Suspense>
  )
}
