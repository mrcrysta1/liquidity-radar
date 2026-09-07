#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, basename, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

const IDENTITIES_FILE = 'agents/identities.json'
const APP_MODULES_DIR = 'liquidity-radar-react/node_modules'

export function resolveRoot(start = process.cwd()) {
  let dir = resolve(start)
  for (;;) {
    const marker = join(dir, 'AGENTS.md')
    if (existsSync(marker) && existsSync(join(dir, 'agents', 'identities.json'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadIdentities(root) {
  const file = join(root, IDENTITIES_FILE)
  if (!existsSync(file)) {
    throw new Error(`${IDENTITIES_FILE} is missing`)
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed.identities) || parsed.identities.length === 0) {
    throw new Error(`${IDENTITIES_FILE} contains no identities`)
  }
  return parsed
}

export function findBin(candidates) {
  for (const candidate of candidates) {
    if (candidate.includes(sep) || candidate.includes('/')) {
      if (existsSync(candidate)) {
        return { path: candidate, via: 'fs' }
      }
      continue
    }
    const where = spawnSync('where.exe', [candidate], { encoding: 'utf8', shell: false })
    if (where.status === 0) {
      const line = (where.stdout || '').trim().split(/\r?\n/)[0]
      if (line) return { path: line, via: 'PATH' }
    }
  }
  return null
}

function userProfile() {
  return process.env.USERPROFILE || process.env.HOME || ''
}

export const BIN_CANDIDATES = {
  opencode: [
    join(process.env.LOCALAPPDATA || '', 'OpenCode', 'opencode-cli.exe'),
    join(process.env.LOCALAPPDATA || '', 'OpenCode', 'OpenCode.exe'),
    'opencode',
  ],
  aider: [
    join(userProfile(), '.local', 'bin', 'aider.exe'),
    'aider',
  ],
  cline: [
    join(process.env.APPDATA || '', 'npm', 'cline.cmd'),
    'cline.cmd',
    'cline',
  ],
}

export const IDENTITY_AGENT_MAP = {
  'OC-LEAD': 'opencode',
  'CL-UI': 'cline',
  'AI-REF': 'aider',
}

export const AGENT_IDENTITY_MAP = Object.fromEntries(
  Object.entries(IDENTITY_AGENT_MAP).map(([id, agent]) => [agent, id]),
)

export function resolveAgentKey(key = '') {
  const normalized = String(key).trim()
  if (!normalized) return null
  const upper = normalized.toUpperCase()
  if (Object.prototype.hasOwnProperty.call(IDENTITY_AGENT_MAP, upper)) {
    return { id: upper, agent: IDENTITY_AGENT_MAP[upper] }
  }
  const lower = normalized.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(AGENT_IDENTITY_MAP, lower)) {
    return { id: AGENT_IDENTITY_MAP[lower], agent: lower }
  }
  return null
}

export function resolveAgentBins() {
  const result = {}
  for (const [id, agent] of Object.entries(IDENTITY_AGENT_MAP)) {
    result[id] = findBin(BIN_CANDIDATES[agent])
  }
  return result
}

export function buildOpenCodeCmd(bin, root) {
  return [bin, root]
}

export function buildAiderCmd(bin, root, extra = []) {
  return [bin, '--model', 'openrouter/openrouter/free', '--yes-always', ...extra]
}

export function buildClineCmd(bin, root) {
  return [bin, '-c', root, '-i']
}

export function getGitInfo(root) {
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  const inTree = run(['rev-parse', '--is-inside-work-tree'])
  if (inTree.status !== 0) {
    return { isInsideWorkTree: false, branch: '', commit: '' }
  }
  const branch = run(['branch', '--show-current']).stdout.trim()
  const commit = run(['rev-parse', '--short', 'HEAD']).stdout.trim()
  return { isInsideWorkTree: true, branch, commit }
}

function toolAvailable(tool) {
  const check = spawnSync(tool, ['--version'], { encoding: 'utf8' })
  return check.status === 0
}

export function preflight(root) {
  const report = []
  const errors = []
  const warnings = []

  if (!root) {
    errors.push('repository root not found (run from inside the repo)')
    return { errors, warnings, report }
  }
  report.push(`repository : ${root}`)

  if (!toolAvailable('git')) {
    errors.push('git is not available on PATH')
  }
  if (!toolAvailable('node')) {
    errors.push('node is not available on PATH')
  }

  const git = getGitInfo(root)
  if (!git.isInsideWorkTree) {
    errors.push('not inside a git work tree')
  } else {
    report.push(`branch     : ${git.branch || '(detached)'}`)
    report.push(`commit     : ${git.commit || 'n/a'}`)
    if (git.branch === 'master') {
      warnings.push('on master: implementation work must happen on a task branch')
    }
  }

  try {
    const identities = loadIdentities(root)
    report.push(`identities : OK (${identities.identities.map((i) => i.id).join(', ')})`)
  } catch (err) {
    errors.push(err.message)
  }

  if (!existsSync(join(root, APP_MODULES_DIR))) {
    warnings.push(`${APP_MODULES_DIR} not found (run npm install before app work)`)
  }

  const bins = resolveAgentBins()
  for (const id of Object.keys(IDENTITY_AGENT_MAP)) {
    const bin = bins[id]
    if (bin && bin.path) {
      report.push(`agent ${id} : ${bin.path} (${bin.via})`)
    } else {
      warnings.push(`agent ${id} : binary not found (${(BIN_CANDIDATES[IDENTITY_AGENT_MAP[id]] || []).join(' / ')})`)
    }
  }

  return { errors, warnings, report }
}

function lockPath(agentId) {
  return join(tmpdir(), `liquidity-radar-${agentId}.lock`)
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function acquireLock(agentId) {
  const file = lockPath(agentId)
  try {
    const stale = readFileSync(file, 'utf8')
    const { pid, started } = JSON.parse(stale)
    if (isProcessAlive(pid)) {
      return { ok: false, existing: { pid, started } }
    }
    rmSync(file, { force: true })
  } catch {
    // no lock or unreadable -> treat as free
  }
  const payload = JSON.stringify({ pid: process.pid, started: new Date().toISOString() })
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, payload, { encoding: 'utf8' })
    return { ok: true }
  } catch {
    return { ok: false, existing: null }
  }
}

export function releaseLock(agentId) {
  rmSync(lockPath(agentId), { force: true })
}

const AGENT_CMD_BUILDERS = {
  opencode: buildOpenCodeCmd,
  aider: buildAiderCmd,
  cline: buildClineCmd,
}

export function resolveLaunch(key, root) {
  const resolved = resolveAgentKey(key)
  if (!resolved) return null
  const { id, agent } = resolved
  const bin = findBin(BIN_CANDIDATES[agent])
  if (!bin) {
    return { id, agent, bin: null, error: 'binary not found' }
  }
  const cmd = AGENT_CMD_BUILDERS[agent](bin.path, root)
  const needsShell = cmd[0].toLowerCase().endsWith('.cmd') || cmd[0].toLowerCase().endsWith('.bat')
  return { id, agent, bin, cmd, needsShell, cwd: root }
}

function runAgent(key, root) {
  const launch = resolveLaunch(key, root)
  if (!launch) {
    console.error(`[AGENT-OS] unknown agent '${key}' (expected opencode|aider|cline or OC-LEAD|CL-UI|AI-REF)`)
    process.exitCode = 1
    return
  }
  if (!launch.bin) {
    console.error(`[AGENT-OS] ${launch.id} binary not found`)
    process.exitCode = 1
    return
  }
  const { id, agent } = launch

  const lock = acquireLock(id)
  if (lock.ok === false) {
    console.error(`[AGENT-OS] ${id} already running (pid ${lock.existing ? lock.existing.pid : '?'} since ${lock.existing ? lock.existing.started : '?'}) — launcher already started it`)
    process.exitCode = 2
    return
  }

  console.log(`[AGENT-OS] launching ${id} (${agent}) in ${root}`)
  console.log(`[AGENT-OS] command: ${launch.cmd.join(' ')}`)
  console.log(`[AGENT-OS] close this window to stop the agent.`)

  let child
  try {
    child = spawn(launch.cmd[0], launch.cmd.slice(1), {
      cwd: root,
      stdio: 'inherit',
      shell: launch.needsShell,
      windowsHide: false,
    })
  } catch (err) {
    console.error(`[AGENT-OS] failed to spawn ${id}: ${err.message}`)
    releaseLock(id)
    process.exitCode = 1
    return
  }

  child.on('error', (err) => {
    console.error(`[AGENT-OS] failed to start ${id}: ${err.message}`)
    releaseLock(id)
    process.exitCode = 1
  })

  child.on('exit', (code, signal) => {
    releaseLock(id)
    console.log(`[AGENT-OS] ${id} exited (code=${code}, signal=${signal || 'none'})`)
    process.exitCode = code && typeof code === 'number' ? code : 0
  })
}

function printHelp() {
  console.log('usage:')
  console.log('  node startup/agent-env.mjs preflight      validate repo + toolchain')
  console.log('  node startup/agent-env.mjs info           print repo/toolchain summary')
  console.log('  node startup/agent-env.mjs start <agent>  launch one agent (opencode|aider|cline or OC-LEAD|CL-UI|AI-REF)')
  console.log('  node startup/agent-env.mjs help           show this help')
}

function main(argv) {
  const [command, arg] = argv
  let root = resolveRoot()
  if (!root) {
    console.error('[AGENT-OS] ERROR: repository root not found — run from inside the repo (AGENTS.md + agents/identities.json marker)')
    process.exitCode = 1
    return
  }

  switch (command) {
    case 'preflight': {
      const { errors, warnings, report } = preflight(root)
      console.log(`[AGENT-OS] preflight ${root}`)
      for (const line of report) console.log(`[AGENT-OS] ${line}`)
      for (const line of warnings) console.log(`[AGENT-OS] WARNING  : ${line}`)
      for (const line of errors) console.log(`[AGENT-OS] ERROR    : ${line}`)
      process.exitCode = errors.length ? 1 : 0
      break
    }
    case 'info': {
      const { errors, warnings, report } = preflight(root)
      for (const line of report) console.log(`[AGENT-OS] ${line}`)
      for (const line of warnings) console.log(`[AGENT-OS] WARNING  : ${line}`)
      for (const line of errors) console.log(`[AGENT-OS] ERROR    : ${line}`)
      process.exitCode = errors.length ? 1 : 0
      break
    }
    case 'start': {
      if (!arg) {
        console.error('[AGENT-OS] usage: node startup/agent-env.mjs start <agent>')
        process.exitCode = 1
        return
      }
      runAgent(arg, root)
      break
    }
    default:
      printHelp()
      process.exitCode = 1
  }
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (IS_MAIN) {
  main(process.argv.slice(2))
}