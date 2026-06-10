// Lazy half of the /docs/$ route. Everything fumadocs-ui lives here so the
// landing entry chunk never pays for it (T12 M1 — landing JS ≤100KB gz).
// The '-' filename prefix excludes this file from route generation.
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import browserCollections from 'collections/browser'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import { useFumadocsLoader } from 'fumadocs-core/source/client'
import { Suspense } from 'react'
import { baseOptions } from '../../lib/layout.shared'
import { useMDXComponents } from '../../components/mdx'

export const clientLoader = browserCollections.docs.createClientLoader({
  component({ toc, frontmatter, default: MDX }, _props: undefined) {
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <DocsBody>
          <MDX components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    )
  },
})

export function DocsRoutePage({
  data,
}: {
  data: { path: string; pageTree: unknown }
}) {
  // useFumadocsLoader deserializes the page tree shipped by the route loader.
  const resolved = useFumadocsLoader(
    data as Parameters<typeof useFumadocsLoader>[0],
  ) as unknown as { path: string; pageTree: never }

  return (
    <RootProvider
      theme={{ defaultTheme: 'dark' }}
      search={{ options: { type: 'static', api: '/api/search' } }}
    >
      <DocsLayout {...baseOptions()} tree={resolved.pageTree}>
        <Suspense>{clientLoader.useContent(resolved.path)}</Suspense>
      </DocsLayout>
    </RootProvider>
  )
}
