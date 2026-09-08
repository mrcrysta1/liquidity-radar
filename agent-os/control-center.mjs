#!/usr/bin/env node
// Agent OS Control Center — CR-P0-009 (CL-UI)
//
// Serves the Agent OS desktop/browser dashboard and exposes a small JSON API.
//
// SOURCE OF TRUTH: the existing Agent Status Monitor (agent-status/agent-status.mjs).
// This module NEVER re-implements status parsing. It reuses the monitor's exported
// analyze() + loadTaskRegistry() and hands the normalized records straight to the UI.
// The dashboard only renders the BUSY/REST/BLOCKED/UNKNOWN tokens produced by the
// monitor — statuses are never guessed here.
//
// Local-only control/status data. No secrets, keys or credentials are read or exposed.
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { analyze, loadTaskRegistry } from '../agent-status/agent-status.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(HERE, 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

export function resolveRoot(start = process.cwd()) {
  let dir = resolve(start)
  for (;;) {
    if (existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'agents', 'identities.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
export function gitInfo(root) {
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  const inTree = run(['rev-parse', '--is-inside-work-tree'])
  if (inTree.status !== 0) {
    return { isInsideWorkTree: false, branch: '', commit: '', clean: false }
  }
  const branch = run(['branch', '--show-current']).stdout.trim()
  const commit = run(['rev-parse', '--short', 'HEAD']).stdout.trim()
  const clean = run(['status', '--porcelain']).stdout.trim() === ''
  return { isInsideWorkTree: true, branch, commit, clean }
}

// Derive the current project phase directly from AGENTS.md (truthful, no hard-coding).
export function projectPhases(root) {
  const file = join(root, 'AGENTS.md')
  if (!existsSync(file)) return { current: null, phases: { completed: 0, next: 0, upcoming: 0 }, all: [] }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { current: null, phases: { completed: 0, next: 0, upcoming: 0 }, all: [] }
  }
  const list = []
  // Name class allows plain hyphens (e.g. "Multi-Agent") but stops at en/em dashes,
  // which are the separators between the phase name and its state in AGENTS.md.
  const re = /Phase\s+(\d+)\s*[:\-–—]?\s*([^\n–—]*?)\s*[–—]\s*(NEXT|UPCOMING|COMPLETE)/gi
  let m
  while ((m = re.exec(text)) !== null) {
    list.push({ num: Number(m[1]), name: m[2].trim(), state: m[3].toUpperCase() })
  }
  list.sort((a, b) => b.num - a.num)
  // "NEXT" is the in-progress phase and takes priority over the later "UPCOMING" one.
  const cur =
    list.find((p) => p.state === 'NEXT') || list.find((p) => p.state === 'UPCOMING') || (list.length ? list[0] : null)
  return {
    current: cur,
    phases: {
      completed: list.filter((p) => p.state === 'COMPLETE' || p.state === 'COMPLETED').length,
      next: list.filter((p) => p.state === 'NEXT').length,
      upcoming: list.filter((p) => p.state === 'UPCOMING').length,
    },
    all: list,
  }
}

const ACTIVE_STATES = ['IN_PROGRESS', 'SELF_TESTING', 'SELF_VERIFICATION', 'REFACTORING', 'RETESTING', 'PASS', 'PR', 'PRODUCTION', 'PRODUCTION_TEST', 'FIXING']
const PENDING_STATES = ['PENDING', 'QUEUED', 'ASSIGNED', 'TODO', 'PLANNED']
const DONE_STATES = ['COMPLETED', 'DONE']
const PROBLEM_STATES = ['BLOCKED', 'FAIL', 'FAILED', 'REOPENED']
export function projectOverview(registry) {
  const tasks = Array.isArray(registry) ? registry : []
  const norm = (s) => String(s || '').trim().toUpperCase()
  const stats = { total: tasks.length, active: 0, pending: 0, completed: 0, reopened: 0, blocked: 0 }
  let latestPr = null
  const production = { deploying: 0, deployed: 0 }
  for (const t of tasks) {
    const s = norm(t.status)
    if (ACTIVE_STATES.includes(s)) stats.active++
    else if (PENDING_STATES.includes(s)) stats.pending++
    else if (DONE_STATES.includes(s)) stats.completed++
    if (PROBLEM_STATES.includes(s)) {
      if (s === 'BLOCKED') stats.blocked++
      else stats.reopened++
    }
    if (s === 'PRODUCTION' || s === 'PRODUCTION_TEST') production.deploying++
    if (s === 'COMPLETED' || s === 'PRODUCTION_TEST') production.deployed++
    const prNum = Number(t.pr)
    if (Number.isInteger(prNum) && prNum > 0 && (!latestPr || prNum > latestPr.pr)) {
      latestPr = { pr: prNum, id: t.id, title: t.title, status: s || 'UNKNOWN', branch: t.branch }
    }
  }
  return { stats, latestPr, production }
}

// Assemble the full dashboard state from the agent-status monitor (source of truth).
export function buildState(root) {
  const mon = analyze(root)
  const registry = loadTaskRegistry(root)

  const agents = mon.records.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    status: r.statusPublic, // BUSY | REST | BLOCKED | UNKNOWN (from the monitor — not guessed)
    rawStatus: r.statusRaw,
    present: r.present,
    taskId: r.taskId,
    taskName: r.taskName,
    startedAt: r.startedAt,
    lastActivity: r.lastActivity,
    note: r.note,
    sessionOpen: r.session.open,
    sessionNote: r.session.note,
    sourceErrors: r.sourceErrors,
    sourceWarnings: r.sourceWarnings,
    registry: r.registry,
  }))

  const ph = projectPhases(root)
  const taskList = Array.isArray(registry.tasks) ? registry.tasks : []
  const overview = projectOverview(taskList)

  return {
    generatedAt: new Date().toISOString(),
    source: {
      present: mon.status.present,
      file: String(mon.status.file || ''),
      error: mon.status.error,
      monitorValid: mon.errors.length === 0,
      errors: mon.errors,
      warnings: mon.warnings,
    },
    agents,
    taskRegistry: { present: registry.present, parseError: registry.parseError, tasks: taskList },
    project: {
      name: 'Liquidity Radar',
      phase: ph.current ? { num: ph.current.num, name: ph.current.name, state: ph.current.state } : null,
      phases: ph.phases,
    },
    overview,
    git: gitInfo(root) || { isInsideWorkTree: false },
  }
}
function safeResolve(publicDir, urlPath) {
  let path
  try {
    path = normalize(join(publicDir, decodeURIComponent(urlPath)))
  } catch {
    return null
  }
  const rootNorm = normalize(publicDir)
  if (path !== rootNorm && !path.startsWith(rootNorm + '\\') && !path.startsWith(rootNorm + '/')) return null
  if (!existsSync(path)) return null
  return path
}

export function createControlCenterServer(opts = {}) {
  const root = opts.root || resolveRoot()
  const publicDir = opts.publicDir || PUBLIC_DIR

  return createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const path = url.pathname

    if (path === '/api/state') {
      let state
      try {
        state = buildState(root)
      } catch (err) {
        const body = JSON.stringify({ ok: false, error: String((err && err.message) || err) })
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(body)
        return
      }
      const body = JSON.stringify({ ok: true, data: state }, null, 2)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-agent-os': 'liquidity-radar/agent-os-control-center',
      })
      res.end(body)
      return
    }

    if (path === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, service: 'agent-os-control-center' }))
      return
    }

    const rel = path === '/' || path === '' ? '/index.html' : path
    const file = safeResolve(publicDir, rel)
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    const ext = extname(file).toLowerCase()
    const body = readFileSync(file, 'utf8')
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=60',
    })
    res.end(body)
  })
}

export function openBrowser(port, host) {
  const url = `http://${host}:${port}/?desktop=1`
  if (process.platform === 'win32') {
    const r = spawnSync('cmd.exe', ['/c', 'start', '', url], { shell: false })
    return r.status === 0
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const r = spawnSync(cmd, [url], { shell: false })
  return r.status === 0
}

function printHelp() {
  process.stdout.write(
    'Agent OS Control Center (CR-P0-009)\n' +
      'Serves the always-on Agent OS dashboard and a JSON API backed by the Agent Status Monitor.\n' +
      'Usage:\n' +
      '  node agent-os/control-center.mjs start [--port 8787] [--host 127.0.0.1] [--open]\n' +
      '  node agent-os/control-center.mjs --help / help\n',
  )
}

function main(argv) {
  const root = resolveRoot()
  if (!root) {
    process.stderr.write('[AGENT-OS] ERROR: repository root not found (AGENTS.md + agents/identities.json marker)\n')
    process.exitCode = 1
    return
  }
  const [command, ...rest] = argv
  const opt = (name) => {
    const i = rest.indexOf('--' + name)
    return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined
  }
  if (command === '--help' || command === 'help' || command === undefined) {
    printHelp()
    process.exitCode = command === undefined ? 1 : 0
    return
  }
  if (command !== 'start') {
    printHelp()
    process.exitCode = 1
    return
  }

  const port = Number(opt('port') || 8787)
  const host = opt('host') || '127.0.0.1'
  const shouldOpen = rest.includes('--open')

  const server = createControlCenterServer({ root })
  server.listen(port, host, () => {
    process.stdout.write(`[AGENT-OS] Control Center listening on http://${host}:${port}/\n`)
    process.stdout.write('[AGENT-OS] Open /api/state for the JSON source or / for the dashboard. Ctrl+C to stop.\n')
    if (shouldOpen) openBrowser(port, host)
  })
}

const IS_MAIN = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (IS_MAIN) {
  main(process.argv.slice(2))
}