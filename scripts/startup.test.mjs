import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
  resolveAgentKey,
  resolveLaunch,
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
console.log('regression: exact launcher arguments resolve to registered identities')

const expectedMapping = { opencode: 'OC-LEAD', aider: 'AI-REF', cline: 'CL-UI' }
const ids = loadIdentities(root)
const registeredIds = ids.identities.map((i) => i.id)

for (const [key, expectedId] of Object.entries(expectedMapping)) {
  t(`resolveAgentKey('${key}') maps to registered identity ${expectedId}`, () => {
    const resolved = resolveAgentKey(key)
    assert.ok(resolved, `'${key}' must resolve`)
    assert.equal(resolved.id, expectedId)
    assert.equal(resolved.agent, key)
    assert.ok(registeredIds.includes(resolved.id), `${resolved.id} must exist in agents/identities.json`)
  })

  t(`resolveLaunch('${key}') builds a runnable command from the git root`, () => {
    const launch = resolveLaunch(key, root)
    assert.ok(launch, `'${key}' must resolve`)
    assert.equal(launch.id, expectedId)
    assert.ok(launch.bin && launch.bin.path, `${key} binary resolves`)
    assert.ok(Array.isArray(launch.cmd) && launch.cmd.length > 0, 'command array built')
    assert.equal(launch.cwd, root, 'agents spawn from the git root')
    const expectedCmds = {
      opencode: [launch.bin.path, root],
      cline: [launch.bin.path, '-c', root, '-i'],
      aider: [launch.bin.path, '--model', 'openrouter/openrouter/free', '--yes-always'],
    }
    assert.equal(
      launch.cmd.map((p) => p.replaceAll('\\', '/')).join(' '),
      expectedCmds[key].map((p) => p.replaceAll('\\', '/')).join(' '),
      `exact command expected for '${key}'`,
    )
  })
}

t('resolveAgentKey is case-insensitive for registered IDs (OC-LEAD/oc-lead)', () => {
  for (const key of ['OC-LEAD', 'oc-lead', 'OC-lead']) {
    const resolved = resolveAgentKey(key)
    assert.ok(resolved, `'${key}' must resolve`)
    assert.equal(resolved.id, 'OC-LEAD')
    assert.equal(resolved.agent, 'opencode')
  }
})

t('resolution agrees with agents/identities.json (every agent maps to a registered id)', () => {
  for (const [agent, id] of Object.entries(expectedMapping)) {
    assert.ok(registeredIds.includes(id), `${agent} -> ${id} is registered`)
  }
})

t('unknown-agent rejection still works for genuinely invalid names', () => {
  for (const bad of ['notreal', 'vscode', 'chatgpt', '']) {
    assert.equal(resolveAgentKey(bad), null, `'${bad}' must not resolve`)
  }
  assert.equal(resolveLaunch('notreal', root), null, "resolveLaunch('notreal') must be null")
})

t('CLI dispatch: invalid agent exits 1 with unknown agent (real dispatch path)', () => {
  const entry = fileURLToPath(new URL('../startup/agent-env.mjs', import.meta.url))
  const res = spawnSync(process.execPath, [entry, 'start', 'notreal'], { encoding: 'utf8' })
  assert.notEqual(res.status, 0, 'exit must be non-zero')
  const output = `${res.stdout || ''}${res.stderr || ''}`
  assert.ok(output.includes('unknown agent'), `output must say "unknown agent" (got: ${output.trim()})`)
})

console.log('')
console.log(`startup.test.mjs: ${passed} passed, ${failed} failed`)
if (failedNames.length) {
  console.error(`failed: ${failedNames.join(', ')}`)
}
process.exit(failed === 0 ? 0 : 1)