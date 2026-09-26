import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

/**
 * The engine (src/engine/app.ts) is a dynamic import: it wires the DOM when it
 * runs, so it may only *run* after React has mounted the shell (see App.tsx).
 * But nothing stops it being *downloaded* early. Without this the browser only
 * asks for it once the whole shell has rendered, so on a slow link the live
 * data started seconds late. A modulepreload hint fetches and parses the
 * engine and its imports in parallel with the entry bundle, without executing
 * them.
 */
function preloadEngine(): Plugin {
  return {
    name: 'preload-engine',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        const engine = Object.values(bundle).find(
          (c) => c.type === 'chunk' && /[\\/]src[\\/]engine[\\/]app\.ts$/.test(c.facadeModuleId || ''),
        )
        if (!engine || engine.type !== 'chunk') return html
        const files = new Set<string>([engine.fileName, ...engine.imports])
        const already = (f: string) => html.includes('/' + f)
        const tags = [...files]
          .filter((f) => !already(f))
          .map((f) => `    <link rel="modulepreload" crossorigin href="/${f}">`)
          .join('\n')
        return tags ? html.replace('</head>', tags + '\n  </head>') : html
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadEngine()],
})
