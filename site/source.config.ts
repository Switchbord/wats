import { defineConfig, defineDocs } from 'fumadocs-mdx/config'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // async: true makes fumadocs-mdx codegen emit `create.docsLazy(...)` in
    // .source/server.ts — the compiled-MDX *body* glob becomes lazy (per-page
    // dynamic import) and only the tiny frontmatter glob stays eager. Without
    // this, the eager body glob inlines all 38 docs pages (220 highlighted code
    // blocks) into anything that imports `source`, which the /docs/$ route does
    // statically, so the whole docs corpus landed in the shared client entry
    // chunk (572KB gz). The server `source` only needs paths + frontmatter
    // (getPage().path + serializePageTree titles); the page BODY is rendered
    // client-side via the separate browser collection lazy loader
    // (-docs-page.tsx), so dropping the eager bodies from `source` costs us
    // nothing functionally and keeps docs content out of the landing entry.
    async: true,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export default defineConfig()
