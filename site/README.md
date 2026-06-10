# @wats/site — wats.sh

Public site: landing + docs (TanStack Start + Fumadocs, Tailwind v4, Bun).

Run:        bun install && bun run dev
Build:      bun run build          (static prerender to dist/client)
Full gate:  bun run check          (typecheck + build + canaries + page lock + copy QA)

Checks live in scripts/. Public routes are locked by public-pages-manifest.json.
Deploys to Vercel (root directory: site/, output: dist/client, build: bun run check).
The site is fully static: search uses a prerendered Orama index (/api/search),
no server functions run in production.
