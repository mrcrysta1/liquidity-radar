// Bundle-size budget check. Run after `vite build` (see "check:bundle" in
// package.json): it scans dist/assets and fails the build when a file crosses
// its budget, so a heavy import sneaking into the first load is caught in CI
// instead of on a user's phone.
//
// The app deliberately splits: vendor chunks (React, charts, Supabase) load on
// the first screen, while TensorFlow.js and other ML packages are dynamic
// imports that never touch the initial load. Budgets below reflect that:
// entry-critical chunks are held tight, lazy chunks get room.
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const ASSETS = 'dist/assets'

// name-fragment -> max gzip size in KB. The first matching fragment wins.
const BUDGETS = [
  // First load: entry + shell + engine + vendor-react + charts. Tight.
  { match: /vendor-react|vendor-charts/, kb: 160 },
  // Supabase is a dynamic import (only when auth is used) but keep it bounded.
  { match: /vendor-supabase/, kb: 60 },
  // Lazy ML chunks: loaded on demand, given room but still bounded.
  { match: /tfjs-backend-webgl/, kb: 900 },
  { match: /tfjs-core|tfjs-layers|tfjs/, kb: 500 },
  { match: /engine|pro-terminal|feature|components/, kb: 200 },
  // Everything else, including the entry chunk and the single stylesheet.
  { match: /.*/, kb: 150 },
]

// css is never lazy in this app: one budget for the whole stylesheet.
const CSS_KB = 80

const gzKb = (buf) => Math.ceil(gzipSync(buf).length / 1024)
let failed = false

for (const f of readdirSync(ASSETS)) {
  if (!/\.(js|css)$/.test(f)) continue
  const size = gzKb(readFileSync(join(ASSETS, f))) // gzip, what goes over the wire
  const isCss = f.endsWith('.css')
  const budget = isCss ? CSS_KB : (BUDGETS.find((b) => b.match.test(f)) || BUDGETS.at(-1)).kb
  const ok = size <= budget
  if (!ok) failed = true
  console.log(`${ok ? '✓' : '✗'} ${f} ${size}KB / ${budget}KB gz`)
}

if (failed) {
  console.error('\nBundle budget exceeded — trim the import or raise the budget consciously (with a comment saying why).')
  process.exit(1)
}
console.log('\nAll bundle budgets respected.')
