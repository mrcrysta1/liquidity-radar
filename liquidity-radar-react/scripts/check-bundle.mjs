// Bundle-size budget check. Run after `vite build` (see "check:bundle" in
// package.json): it scans dist/assets and fails the build when a file crosses
// its budget, so a heavy import sneaking into the first load is caught in CI
// instead of on a user's phone.
//
// The app deliberately splits: vendor chunks (React, charts, Supabase) load on
// the first screen, while TensorFlow.js and other ML packages are dynamic
// imports that never touch the initial load. Budgets below reflect that:
// entry-critical chunks are held tight, lazy chunks get room.
import { readdirSync, statSync, gzipSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = 'dist/assets'

// name-fragment -> max gzip size in KB. The first matching fragment wins.
const BUDGETS = [
  // First load: entry + shell + vendor-react + charts + styles. Tight.
  { match: /^index-|main-|App-|Shell-/, kb: 120 },
  { match: /vendor-react|vendor-charts/, kb: 160 },
  // Supabase is a dynamic import (only when auth is used) but keep it bounded.
  { match: /vendor-supabase/, kb: 60 },
  // Lazy ML chunks: loaded on demand, given room but still bounded.
  { match: /tfjs-backend-webgl/, kb: 900 },
  { match: /tfjs-core|tfjs-layers|tfjs/, kb: 500 },
  { match: /engine|pro-terminal|feature|components/, kb: 200 },
  // Everything else (small shared chunks).
  { match: /.*/, kb: 150 },
]

// css is never lazy in this app: one budget for the whole stylesheet.
const CSS_KB = 80

const kb = (bytes) => Math.ceil(gzipSync(bytes).length / 1024)
let failed = false

for (const f of readdirSync(ASSETS)) {
  const bytes = statSync(join(ASSETS, f))
  if (!/\.(js|css)$/.test(f)) continue
  const size = kb(bytes) // gzip, what actually goes over the wire
  const isCss = f.endsWith('.css')
  const budget = isCss ? CSS_KB : (BUDGETS.find((b) => b.match.test(f)) || BUDGETS.at(-1)).kb
  const flag = size > budget ? 'OVER' : 'ok'
  if (size > budget) failed = true
  console.log(`${flag === 'OVER' ? '✗' : '✓'} ${f} ${size}KB / ${budget}KB gz`)
}

if (failed) {
  console.error('\nBundle budget exceeded — trim the import or raise the budget consciously (with a comment saying why).')
  process.exit(1)
}
console.log('\nAll bundle budgets respected.')
