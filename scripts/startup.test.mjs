import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  resolveRoot,
  loadIdentities,
  findBin,
  BIN_CANDIDATES,
  resolveAgentBins,
  buildOpenCodeCmd,
  buildAiderCmd,
  buildClineCmd,
  getGitInfo,
  preflight,
  acquireLock,
  releaseLock,
} from '../startup/agent-env.mjs'

let passed = 0
let failed = 0
const failedNames = []

function t(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (err) {
    failed++
    failedNames.push(name)
    console.error(`  FAIL ${name}`)
    console.error(`       ${err.message}`)
  }
}

const root = resolveRoot()
assert.ok(root, 'repo root must be resolvable from repo cwd')
assert.ok(existsSync(join(root, 'AGENTS.md')), 'AGENTS.md marker exists at root')

console.log('startup.test.mjs — launcher core')
console.log(`root: ${root}`)
console.log('')

t('resolveRoot locates repo root (marker = AGENTS.md + agents/identities.json)', () => {
  assert.ok(root.includes('liquidity-radar'))
})

t('loadIdentities returns the three Phase 0 identities', () => {
  const identities = loadIdentities(root)
  const ids = identities.identities.map((i) => i.id).sort()
  assert.deepEqual(ids, ['AI-REF', 'CL-UI', 'OC-LEAD'])
  assert.ok(identities.branchPolicy.includes('never work directly on master'.toLowerCase()) || identities.branchPolicy.length > 0)
})

t('getGitInfo reports a git work tree with a branch', () => {
  const info = getGitInfo(root)
  assert.equal(info.isInsideWorkTree, true)
  assert.notEqual(info.branch, '')
})

t('preflight on this repo has no hard errors', () => {
  const { errors } = preflight(root)
  assert.deepEqual(errors, [])
})

t('resolveAgentBins resolves all three agent binaries', () => {
  const bins = resolveAgentBins()
  for (const id of ['OC-LEAD', 'CL-UI', 'AI-REF']) {
    assert.ok(bins[id], `${id} bin entry exists`)
    assert.ok(bins[id].path, `${id} bin path resolved`)
  }
})

t('findBin resolves the verified absolute paths on this machine', () => {
  const opencode = findBin(BIN_CANDIDATES.opencode)
  assert.ok(opencode, 'opencode resolves')
  const aider = findBin(BIN_CANDIDATES.aider)
  assert.ok(aider, 'aider resolves')
  const cline = findBin(BIN_CANDIDATES.cline)
  assert.ok(cline, 'cline resolves')
})

t('buildAiderCmd preserves the authorized invocation', () => {
  const cmd = buildAiderCmd('aider.exe', root)
  assert.equal(cmd[0], 'aider.exe')
  assert.ok(cmd.includes('--model'))
  assert.ok(cmd.includes('openrouter/openrouter/free'))
  assert.ok(cmd.includes('--yes-always'))
})

t('buildOpenCodeCmd opens the repo project (opencode [project])', () => {
  const cmd = buildOpenCodeCmd('opencode-cli.exe', root)
  assert.deepEqual(cmd, ['opencode-cli.exe', root])
})

t('buildClineCmd uses the non-interactive CLI TUI with cwd', () => {
  const cmd = buildClineCmd('cline.cmd', root)
  assert.deepEqual(cmd, ['cline.cmd', '-c', root, '-i'])
})

t('agent builders never mutate git (no push/merge/checkout/commit)', () => {
  const all = [
    buildOpenCodeCmd('p', root),
    buildAiderCmd('p', root),
    buildClineCmd('p', root),
  ]
    .flat()
    .map((s) => s.toLowerCase())
    .join(' ')
  for (const forbidden of ['push', 'merge', 'checkout', 'commit', 'reset']) {
    assert.ok(!all.includes(forbidden), `no '${forbidden}' in agent launch commands`)
  }
})

t('acquire/release lock round-trips', () => {
  const name = 'test-agent'
  assert.equal(acquireLock(name).ok, true, 'first acquire succeeds')
  assert.equal(acquireLock(name).ok, false, 'second acquire blocked while pid alive')
  releaseLock(name)
  assert.equal(acquireLock(name).ok, true, 'acquire succeeds after release')
  releaseLock(name)
})

console.log('')
console.log(`startup.test.mjs: ${passed} passed, ${failed} failed`)
if (failedNames.length) {
  console.error(`failed: ${failedNames.join(', ')}`)
}
process.exit(failed === 0 ? 0 : 1)