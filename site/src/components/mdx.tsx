import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'
import { DocMeta } from './DocMeta'

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    // Available in every MDX page without an explicit import.
    DocMeta,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
