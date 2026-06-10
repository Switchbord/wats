import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { lazy, Suspense } from 'react'
import { source } from '../../lib/source'

// All fumadocs-ui code lives in the lazily-loaded -docs-page module so the
// landing entry chunk never includes it (T12 M1 — landing JS ≤100KB gz).
const DocsRoutePage = lazy(() =>
  import('./-docs-page').then((m) => ({ default: m.DocsRoutePage })),
)

export const Route = createFileRoute('/docs/$')({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/') ?? []
    const data = await serverLoader({ data: slugs })
    const mod = await import('./-docs-page')
    await mod.clientLoader.preload(data.path)
    return data
  },
})

const serverLoader = createServerFn({
  method: 'GET',
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) throw notFound()

    return {
      path: page.path,
      pageTree: await source.serializePageTree(source.getPageTree()),
    }
  })

function Page() {
  const data = Route.useLoaderData()

  return (
    <Suspense>
      <DocsRoutePage data={data} />
    </Suspense>
  )
}
