import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mdx from 'fumadocs-mdx/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      'collections/server': fileURLToPath(
        new URL('./.source/server.ts', import.meta.url),
      ),
      'collections/browser': fileURLToPath(
        new URL('./.source/browser.ts', import.meta.url),
      ),
    },
  },
  plugins: [
    mdx(),
    tailwindcss(),
    tanstackStart({
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
})
