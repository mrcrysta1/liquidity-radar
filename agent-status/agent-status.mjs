#!/usr/bin/env node
// Agent Status Monitor — CR-P0-008 (CL-UI)
// Reads a structured status source (agent-status/status.json) and renders a human-readable
// table of which AI agents are BUSY / REST / BLOCKED / UNKNOWN.
//
// The BUSY/REST/BLOCKED state of an agent is NOT auto-detectable in this environment, so the
// monitor does NOT guess it. The live status is maintained in agent-status/status.json by the
// agent launch/task systems (or a human). The monitor also surfaces real, detected signals that
// DO exist and enrich the view without inventing activity:
//   1. Canonical agent identities from agents/identities.json.
//   2. A cross-reference to tasks/index.json (registered task lifecycle status) when a taskId
//      is present in status.json.
//   3. Session detection from the launcher's own lock files (startup/agent-env.mjs) which show
//      whether an agent launch window is currently open — labelled "session", NEVER conflated
//      with the agent's BUSY/REST state.
//
// Usage (run from the repo root):
//   node agent-status/agent-status.mjs status              human-readable table (default)
//   node agent-status/agent-status.mjs json                normalized, validated JSON
//   node agent-status/agent-status.mjs validate            exit 0 = valid, 1 = invalid, 2 = missing
//   node agent-status/agent-status.mjs set <ID> <STATUS> [options]   update status.json
//   node agent-status/agent-status.mjs snapshot            print a fresh status.json scaffold
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const _here = fileURLToPath(import.meta.url)

export const HIGH_LEVEL = ['REST', 'BUSY', 'BLOCKED', 'UNKNOWN']
export const INTERNAL_PHASES = ['TESTING', 'VERIFYING', 'PR', 'PRODUCTION']
// Full accepted token set. Internal phases map to the BUSY family publicly so the
// lifecycle REST -> BUSY -> TESTING -> VERIFYING -> PR -> PRODUCTION -> REST stays
// compatible with the high-level BUSY/REST/BLOCKED/UNKNOWN surface.
export const STATUS_TOKENS = [...HIGH_LEVEL, ...INTERNAL_PHASES]

export function parseStatusToken(token) {
  const raw = String(token || '').trim().toUpperCase()
  if (!raw) return { valid: false, public: 'UNKNOWN', raw }
  if (!STATUS_TOKENS.includes(raw)) return { valid: false, public: 'UNKNOWN', raw }
  if (raw === 'REST') return { valid: true, public: 'REST', raw }
  if (raw === 'BLOCKED') return { valid: true, public: 'BLOCKED', raw }
  if (raw === 'UNKNOWN') return { valid: true, public: 'UNKNOWN', raw }
  // BUSY, TESTING, VERIFYING, PR, PRODUCTION all surface as BUSY
  return { valid: true, public: 'BUSY', raw }
}

function resolveRoot(start = process.cwd()) {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'agents', 'identities.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadIdentities(root) {
  const file = join(root, 'agents', 'identities.json')
  if (!existsSync(file)) throw new Error('agents/identities.json not found')
  return JSON.parse(readFileSync(file, 'utf8')).identities || []
}

export function loadTaskRegistry(root) {
  const file = join(root, 'tasks', 'index.json')
  if (!existsSync(file)) return { present: false, tasks: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { present: true, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
  } catch {
    return { present: false, tasks: [], parseError: 'tasks/index.json is invalid JSON' }
  }
}

export function loadStatus(root) {
  const file = join(root, 'agent-status', 'status.json')
  if (!existsSync(file)) {
    return { present: false, file, data: null, error: 'agent-status/status.json not found' }
  }
  try {
    return { present: true, file, data: JSON.parse(readFileSync(file, 'utf8')), error: null }
  } catch (err) {
    return { present: true, file, data: null, error: 'agent-status/status.json is invalid JSON: ' + err.message }
  }
}

// Same lock files written by startup/agent-env.mjs (acquireLock / lockPath).
function lockPath(agentId) {
  return join(tmpdir(), `liquidity-radar-${agentId}.lock`)
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function detectSession(agentId) {
  const file = lockPath(agentId)
  try {
    const { pid, started } = JSON.parse(readFileSync(file, 'utf8'))
    if (!isPidAlive(pid)) return { open: false, pid: null, started: null, note: 'lock stale (pid not running)' }
    return { open: true, pid, started, note: 'agent launch window open (lock pid ' + pid + ')' }
  } catch {
    return { open: false, pid: null, started: null, note: 'no live session detected' }
  }
}

function taskInRegistry(registry, taskId) {
  if (!taskId || !registry || !registry.tasks) return null
  for (const t of registry.tasks) {
    if (t.id === taskId) return t
  }
  return null
}

// Analyze returns normalized per-agent records plus overall validation info.
export function analyze(root) {
  const status = loadStatus(root)
  const identities = loadIdentities(root)
  const registry = loadTaskRegistry(root)
  const errors = []
  const warnings = []

  if (status.error) errors.push(status.error)

  let agentMap = {}
  if (status.data && typeof status.data === 'object' && status.data.agents) {
    if (typeof status.data.agents === 'object' && status.data.agents !== null) {
      agentMap = status.data.agents
    } else {
      errors.push('status.json "agents" must be an object')
    }
  }

  const records = identities.map((identity) => {
    const entry = agentMap[identity.id]
    const rec = {
      id: identity.id,
      name: identity.name,
      role: identity.role,
      present: Boolean(entry),
      statusPublic: 'UNKNOWN',
      statusRaw: null,
      taskId: null,
      taskName: null,
      startedAt: null,
      lastActivity: null,
      note: null,
      session: detectSession(identity.id),
      sourceErrors: [],
      sourceWarnings: [],
      registry: null,
    }
    if (!entry) {
      rec.sourceErrors.push('missing from status.json — treated as UNKNOWN')
      return rec
    }
    const parsed = parseStatusToken(entry.status)
    rec.statusRaw = parsed.raw
    rec.statusPublic = parsed.public
    if (!parsed.valid) {
      rec.sourceErrors.push(`invalid status "${String(entry.status || '').trim()}" — treated as UNKNOWN`)
      errors.push(`${identity.id}: invalid status token "${String(entry.status || '').trim()}"`)
    }
    if (entry.name && String(entry.name).trim() && String(entry.name).trim() !== identity.name) {
      rec.sourceWarnings.push(`name "${entry.name}" does not match identity "${identity.name}"`)
      warnings.push(`${identity.id}: name in status.json does not match agents/identities.json`)
    }
    if (entry.taskId) {
      rec.taskId = String(entry.taskId)
      const t = taskInRegistry(registry, rec.taskId)
      if (t) {
        rec.registry = { id: t.id, title: t.title, status: t.status, branch: t.branch, pr: t.pr, commit: t.commit }
        if (!entry.taskName && t.title) rec.taskName = t.title
      }
    }
    if (entry.taskName) rec.taskName = String(entry.taskName)
    if (entry.startedAt) rec.startedAt = String(entry.startedAt)
    if (entry.lastActivity) rec.lastActivity = String(entry.lastActivity)
    if (entry.note) rec.note = String(entry.note)
    return rec
  })

  // Flag any agent in status.json that is not a recognized identity.
  for (const key of Object.keys(agentMap)) {
    if (!identities.some((i) => i.id === key)) {
      errors.push(`status.json contains unknown agent key "${key}" (expected OC-LEAD, CL-UI, AI-REF)`)
    }
  }

  return { status, identities, registry, records, errors, warnings }
}

function fmt(v, fallback = '—') {
  return v !== null && String(v).trim() !== '' ? String(v) : fallback
}

function pad(s, width) {
  const t = String(s)
  return t.length >= width ? t : t + ' '.repeat(width - t.length)
}

export function renderTable(result) {
  const heads = ['AGENT', 'ID', 'STATUS', 'TASK ID', 'TASK NAME', 'STARTED', 'LAST ACT', 'SESSION(detected)', 'NOTE']
  const rows = result.records.map((r) => {
    const session = r.session.open ? 'open' : 'closed'
    let status = r.statusPublic
    if (r.statusRaw && r.statusRaw !== r.statusPublic) status = `${r.statusRaw} (as ${r.statusPublic})`
    const noteBits = [r.note].filter(Boolean)
    if (r.sourceErrors.length) noteBits.push('!! ' + r.sourceErrors.join('; '))
    if (r.sourceWarnings.length) noteBits.push('!! ' + r.sourceWarnings.join('; '))
    if (r.taskId && r.registry) {
      noteBits.push(`registry:${r.registry.status}`)
    } else if (r.taskId && !r.registry) {
      noteBits.push('task not registered in tasks/index.json')
    }
    return [
      r.name,
      r.id,
      status,
      fmt(r.taskId),
      fmt(r.taskName),
      fmt(r.startedAt),
      fmt(r.lastActivity),
      session,
      noteBits.join(' | '),
    ]
  })
  const widths = heads.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)))
  const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join('  |  ')
  const sep = '  '.repeat(2) + widths.map((w) => '-'.repeat(w)).join('--+--')
  let out = 'AGENT STATUS MONITOR (CR-P0-008)' + '\n'
  out += 'source: ' + result.status.file + (result.status.present ? '' : '  [MISSING]') + '\n'
  out += line(heads) + '\n'
  out += sep + '\n'
  for (const row of rows) out += line(row) + '\n'
  out += '\n'
  out += 'Status guide: BUSY | REST | BLOCKED | UNKNOWN. Internal phases TESTING/VERIFYING/PR/PRODUCTION\n'
  out += 'surface as BUSY. BLOCKED is always distinct. SESSION(detected) reflects the real launcher lock\n'
  out += '(startup/agent-env.mjs) and is NOT the agent BUSY/REST state.\n'
  return out
}

export function snapshotResult() {
  return {
    version: 1,
    schema: 'liquidity-radar/agent-status@1',
    updatedAt: new Date().toISOString(),
    note:
      'Manual structured status source. Update per-agent "status" (REST|BUSY|BLOCKED|UNKNOWN|TESTING|' +
      'VERIFYING|PR|PRODUCTION) and optional taskId/taskName/startedAt/lastActivity. Automation can also ' +
      'write this file directly or use: node agent-status/agent-status.mjs set <ID> <STATUS> ...',
    agents: {
      'OC-LEAD': { name: 'OpenCode', status: 'REST', note: 'no active task recorded' },
      'CL-UI': { name: 'Cline', status: 'REST', note: 'no active task recorded' },
      'AI-REF': { name: 'Aider', status: 'REST', note: 'no active task recorded' },
    },
  }
}

function usage(stream) {
  stream.write(
    'Agent Status Monitor (CR-P0-008)\n' +
      'Usage:\n' +
      '  node agent-status/agent-status.mjs status             render human-readable table (default)\n' +
      '  node agent-status/agent-status.mjs json               print normalized/validated JSON\n' +
      '  node agent-status/agent-status.mjs validate           exit 0=valid 1=invalid 2=missing source\n' +
      '  node agent-status/agent-status.mjs set <ID> <STATUS>  update status.json for one agent\n' +
      '                       [--task-id X] [--task-name Y] [--note Z]\n' +
      '                       [--started-at ISO] [--last-activity ISO]\n' +
      '  node agent-status/agent-status.mjs snapshot            print a fresh status.json scaffold\n' +
      'Status tokens: ' + STATUS_TOKENS.join(', ') + '\n',
  )
}

function runSet(root, idRaw, statusRaw, opt) {
  const id = String(idRaw || '').toUpperCase()
  const identities = loadIdentities(root)
  if (!identities.some((i) => i.id === id)) {
    process.stderr.write('ERROR: unknown agent "' + idRaw + '" (expected OC-LEAD | CL-UI | AI-REF)\n')
    process.exitCode = 1
    return
  }
  const parsed = parseStatusToken(statusRaw)
  if (!parsed.valid) {
    process.stderr.write('ERROR: invalid status "' + statusRaw + '" (allowed: ' + STATUS_TOKENS.join(', ') + ')\n')
    process.exitCode = 1
    return
  }
  const file = join(root, 'agent-status', 'status.json')
  let data
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      process.stderr.write('ERROR: status.json is invalid JSON — fix before running set\n')
      process.exitCode = 1
      return
    }
  } else {
    data = snapshotResult()
  }
  if (typeof data.agents !== 'object' || data.agents === null) data.agents = {}
  const agent = data.agents[id] || { name: identities.find((i) => i.id === id).name }
  agent.status = parsed.raw
  if (opt('task-id')) agent.taskId = opt('task-id')
  if (opt('task-name')) agent.taskName = opt('task-name')
  if (opt('note')) agent.note = opt('note')
  if (opt('started-at')) agent.startedAt = opt('started-at')
  if (opt('last-activity')) agent.lastActivity = opt('last-activity')
  data.agents[id] = agent
  data.updatedAt = new Date().toISOString()
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  process.stdout.write(`updated ${id} status -> ${parsed.raw} in ${file}\n`)
}

function main(argv) {
  const root = resolveRoot()
  if (!root) {
    process.stderr.write('[AGENT-STATUS] ERROR: repository root not found (AGENTS.md + agents/identities.json marker)\n')
    process.exitCode = 1
    return
  }
  const [command, a1, a2, ...rest] = argv
  const opt = (name) => {
    const i = rest.indexOf('--' + name)
    return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined
  }

  if (command === 'json' || command === 'status' || command === 'validate' || command === undefined) {
    const result = analyze(root)
    if (command === 'json') {
      const out = {
        generatedAt: new Date().toISOString(),
        source: result.status.present ? 'present' : result.status.error,
        statusSource: result.status.error,
        valid: result.errors.length === 0,
        errors: result.errors,
        warnings: result.warnings,
        agents: result.records.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.statusPublic,
          rawStatus: r.statusRaw,
          taskId: r.taskId,
          taskName: r.taskName,
          startedAt: r.startedAt,
          lastActivity: r.lastActivity,
          note: r.note,
          sessionOpen: r.session.open,
          registry: r.registry,
          sourceErrors: r.sourceErrors,
          sourceWarnings: r.sourceWarnings,
        })),
      }
      process.stdout.write(JSON.stringify(out, null, 2) + '\n')
      process.exitCode = result.status.present ? (result.errors.length ? 1 : 0) : 2
      return
    }
    if (command === 'validate') {
      for (const e of result.errors) process.stderr.write('ERROR: ' + e + '\n')
      for (const w of result.warnings) process.stderr.write('WARNING: ' + w + '\n')
      if (!result.status.present) {
        process.stderr.write('agent-status/status.json is MISSING — all agents UNKNOWN\n')
        process.exitCode = 2
        return
      }
      process.stdout.write('agent-status/status.json ' + (result.errors.length ? 'INVALID' : 'VALID') + '\n')
      process.exitCode = result.errors.length ? 1 : 0
      return
    }
    process.stdout.write(renderTable(result) + '\n')
    for (const w of result.warnings) process.stderr.write('[AGENT-STATUS] WARNING: ' + w + '\n')
    process.exitCode = result.status.present ? (result.errors.length ? 1 : 0) : 2
    return
  }

  if (command === 'snapshot') {
    process.stdout.write(JSON.stringify(snapshotResult(), null, 2) + '\n')
    return
  }

  if (command === 'set') {
    runSet(root, a1, a2, opt)
    return
  }

  usage(process.stderr)
  process.exitCode = 1
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === _here
if (IS_MAIN) {
  main(process.argv.slice(2))
}