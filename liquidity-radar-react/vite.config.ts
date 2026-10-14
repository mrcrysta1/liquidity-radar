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

/**
 * Preloads the two latin font files (see the @font-face rules in index.css).
 * Without it the browser only discovers them once the stylesheet is parsed and
 * text is laid out, then lays every line out again when each font lands.
 */
function preloadFonts(): Plugin {
  return {
    name: 'preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const tags = Object.keys(ctx.bundle)
          .filter((f) => /(inter-latin|jetbrains-mono-latin)-[\w-]{8}\.woff2$/.test(f))
          .map((f) => `    <link rel="preload" as="font" type="font/woff2" crossorigin href="/${f}">`)
          .join('\n')
        return tags ? html.replace('</head>', tags + '\n  </head>') : html
      },
    },
  }
}

/**
 * Vendor code in its own long-lived chunks. Library bytes rarely change, so a
 * deploy that only touches app code no longer invalidates React or the chart
 * library in the browser cache. TensorFlow.js (loaded on demand by the ML
 * features, never on the first screen) is split per package so no single
 * chunk crosses the 500 KB warning. Order matters: the first matching group
 * wins, so tfjs-core is claimed before the packages that depend on it.
 */
const nm = (pkgs: string) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${pkgs})[\\\\/]`)
const vendorGroups = [
  { name: 'vendor-react', test: nm('react|react-dom|scheduler'), priority: 30 },
  { name: 'vendor-charts', test: nm('lightweight-charts|fancy-canvas'), priority: 30 },
  { name: 'vendor-supabase', test: nm('@supabase|iceberg-js'), priority: 30 },
  { name: 'tfjs-core', test: nm('@tensorflow[\\\\/]tfjs-core'), priority: 25 },
  { name: 'tfjs-backend-webgl', test: nm('@tensorflow[\\\\/]tfjs-backend-webgl'), priority: 20 },
  { name: 'tfjs-backend-cpu', test: nm('@tensorflow[\\\\/]tfjs-backend-cpu'), priority: 20 },
  { name: 'tfjs-layers', test: nm('@tensorflow[\\\\/]tfjs-layers'), priority: 20 },
  { name: 'tfjs', test: nm('@tensorflow|long|seedrandom'), priority: 10 },
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), preloadEngine(), preloadFonts()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: vendorGroups },
      },
    },
  },
})
