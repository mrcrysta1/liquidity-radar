// Bundle-size budget check. Run after `vite build` (see "check:bundle" in
// package.json): it scans dist/assets and fails the build when a file crosses
// its budget, so a heavy import sneaking into the first load is caught in CI
// instead of on a user's phone.
//
// The app deliberately splits: vendor chunks (React, charts, Supabase) load on
// the first screen, while TensorFlow.js and other ML packages are dynamic
// imports that never touch the initial load. Budgets below reflect that:
// entry-critical chunks are held tight, lazy chunks get room.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved from this file, not the cwd, so it works from any directory.
// `npm run build` emits two apps: the main app (dist/assets) and the Pro
// Terminal (scripts/build-pro.mjs copies it to dist/pro/assets). Both ship
// from the same deployment, so both are held to the same budgets.
const ASSET_DIRS = ['../dist/assets', '../dist/pro/assets'].map((p) => fileURLToPath(new URL(p, import.meta.url)))
for (const dir of ASSET_DIRS) {
  if (!existsSync(dir)) {
    console.error(`No build output at ${dir} — run \`npm run build\` first.`)
    process.exit(1)
  }
}

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
  // Everything else, including the entry chunk (CSS has its own budget below).
  { match: /.*/, kb: 150 },
]

// css is never lazy in this app: one budget for the whole stylesheet.
const CSS_KB = 80

const gzKb = (buf) => Math.ceil(gzipSync(buf).length / 1024)
let failed = false

for (const dir of ASSET_DIRS) {
  let checked = 0
  console.log(`\n${dir}`)
  for (const f of readdirSync(dir)) {
    if (!/\.(js|css)$/.test(f)) continue
    checked++
    const size = gzKb(readFileSync(join(dir, f))) // gzip, what goes over the wire
    const isCss = f.endsWith('.css')
    const budget = isCss ? CSS_KB : (BUDGETS.find((b) => b.match.test(f)) || BUDGETS.at(-1)).kb
    const ok = size <= budget
    if (!ok) failed = true
    console.log(`${ok ? '✓' : '✗'} ${f} ${size}KB / ${budget}KB gz`)
  }
  if (checked === 0) {
    console.error(`No .js/.css files found in ${dir} — nothing was checked.`)
    process.exit(1)
  }
}

if (failed) {
  console.error('\nBundle budget exceeded — trim the import or raise the budget consciously (with a comment saying why).')
  process.exit(1)
}
console.log('\nAll bundle budgets respected.')
