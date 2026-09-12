// Agent OS Control Center tests — CR-P0-009 (CL-UI).
// Run with: node agent-os/control-center.test.mjs
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  resolveRoot,
  buildState,
  projectPhases,
  projectOverview,
  createControlCenterServer,
  probeService,
} from './control-center.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')

let pass = 0
let fail = 0
const failedNames = []
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    failedNames.push(name)
    console.log('FAIL ' + name + (detail !== undefined ? ' - ' + detail : ''))
  }
}

function makeRoot() {
  const root = join(tmpdir(), 'agent-os-test-' + Date.now() + '-' + Math.floor(Math.random() * 1e9))
  mkdirSync(join(root, 'agents'), { recursive: true })
  mkdirSync(join(root, 'tasks'), { recursive: true })
  mkdirSync(join(root, 'agent-status'), { recursive: true })
  mkdirSync(join(root, 'agent-os', 'public'), { recursive: true })
  writeFileSync(
    join(root, 'AGENTS.md'),
    [
      '- Phase 1: React + Vite — COMPLETE',
      '- Phase 2: Modularization — COMPLETE',
      '- Phase 3: React Componentization — NEXT',
      '- Phase 4: Testing — UPCOMING',
      '- Phase 5: Production — COMPLETE',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'agents', 'identities.json'),
    JSON.stringify({
      identities: [
        { id: 'OC-LEAD', name: 'OpenCode', role: 'Lead' },
        { id: 'CL-UI', name: 'Cline', role: 'UI' },
        { id: 'AI-REF', name: 'Aider', role: 'Testing' },
      ],
    }),
  )
  writeFileSync(
    join(root, 'tasks', 'index.json'),
    JSON.stringify({
      tasks: [
        { id: 'CR-P0-001', title: 'A', status: 'COMPLETED' },
        { id: 'CR-P0-007', title: 'B', status: 'PRODUCTION', pr: 11 },
        { id: 'CR-P0-009', title: 'C', status: 'IN_PROGRESS', pr: 14 },
        { id: 'CR-P0-010', title: 'D', status: 'PENDING' },
        { id: 'CR-P0-011', title: 'E', status: 'BLOCKED' },
      ],
    }),
  )
  writeFileSync(
    join(root, 'agent-status', 'status.json'),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: {
        'OC-LEAD': { name: 'OpenCode', status: 'REST', taskId: 'CR-P0-007' },
        'CL-UI': { name: 'Cline', status: 'BUSY', taskId: 'CR-P0-009' },
        'AI-REF': { name: 'Aider', status: 'BLOCKED' },
      },
    }),
  )
  writeFileSync(join(root, 'agent-os', 'public', 'index.html'), '<!doctype html><title>t</title>', 'utf8')
  writeFileSync(join(root, 'agent-os', 'public', 'dashboard.js'), 'console.log(1)', 'utf8')
  return root
}
// --- resolveRoot ---
check('resolveRoot finds the real repo root', () => {
  const r = resolveRoot(ROOT)
  return r && existsSync(join(ROOT, 'AGENTS.md'))
})

// --- projectPhases (fixture) ---
{
  const root = makeRoot()
  const ph = projectPhases(root)
  check('projectPhases picks Phase 3 as current (NEXT)', ph.current && ph.current.num === 3 && ph.current.state === 'NEXT')
  check('projectPhases counts 3 COMPLETE phases', ph.phases.completed === 3)
}

// --- projectOverview (fixture) ---
{
  const root = makeRoot()
  const reg = JSON.parse(readFileSync(join(root, 'tasks', 'index.json'), 'utf8'))
  const ov = projectOverview(reg.tasks)
  check('overview active count = 2 (IN_PROGRESS + PRODUCTION)', ov.stats.active === 2)
  check('overview pending count = 1', ov.stats.pending === 1)
  check('overview completed count = 1', ov.stats.completed === 1)
  check('overview blocked count = 1', ov.stats.blocked === 1)
  check('overview latest PR = #14 from CR-P0-009', ov.latestPr && ov.latestPr.pr === 14)
  check('overview production deploying >= 1 (PRODUCTION)', ov.production.deploying >= 1)
}

// --- buildState (fixture) uses monitor (source of truth) ---
{
  const root = makeRoot()
  const s = buildState(root)
  check('buildState returns 3 agents', s.agents.length === 3)
  check('agent statuses only come from allowed set', s.agents.every((a) => ['BUSY', 'REST', 'BLOCKED', 'UNKNOWN'].includes(a.status)))
  check('CL-UI status BUSY surfaced from monitor', s.agents.find((a) => a.id === 'CL-UI').status === 'BUSY')
  check('AI-REF BLOCKED surfaced', s.agents.find((a) => a.id === 'AI-REF').status === 'BLOCKED')
  check('source.present true', s.source.present === true)
  check('source.monitorValid true', s.source.monitorValid === true)
  check('project phase surfaced', s.project.phase && s.project.phase.num === 3)
  check('git info present (object)', s.git && typeof s.git === 'object')
}
// --- Server integration (ephemeral port, real HTTP on 127.0.0.1) ---
{
  const root = makeRoot()
  const server = createControlCenterServer({ root })
  server.listen(0, '127.0.0.1')
  // Wait a moment for the OS to bind the ephemeral port.
  await new Promise((r) => setTimeout(r, 150))
  const actualPort = server.address().port
  check('server bound to an ephemeral port', actualPort > 0, 'actualPort=' + actualPort)

  const base = `http://127.0.0.1:${actualPort}`
  const get = async (path) => {
    const res = await fetch(base + path)
    const text = await res.text()
    return { status: res.status, type: res.headers.get('content-type'), text }
  }

  const health = await get('/api/health')
  check('GET /api/health returns 200 JSON ok', health.status === 200 && health.text.includes('"ok":true'))

  const rootRes = await get('/')
  check('GET / returns index.html (200, html)', rootRes.status === 200 && rootRes.type && rootRes.type.includes('text/html'))

  const stateRes = await get('/api/state')
  let state = null
  try {
    state = JSON.parse(stateRes.text)
  } catch {}
  check('GET /api/state returns 200 JSON', stateRes.status === 200 && state !== null)
  check('api/state ok flag', state && state.ok === true)
  check('api/state has 3 agents', state && state.data && state.data.agents && state.data.agents.length === 3)
  check('api/state has taskRegistry + overview', state && state.data.taskRegistry && state.data.overview)
  check('api/state content-type is JSON', stateRes.type && stateRes.type.includes('json'))

  const miss = await get('/nope.txt')
  check('unknown static path returns 404', miss.status === 404)

  server.close()
}

// --- probeService duplicate-instance detection ---
{
  // 1. A running control center must probe as 'running'.
  const root = makeRoot()
  const server = createControlCenterServer({ root })
  server.listen(0, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 150))
  const p1 = server.address().port
  const probe1 = await probeService(p1, '127.0.0.1')
  check('probeService detects a running control center as "running"', probe1 === 'running', 'got ' + probe1)
  server.close()

  // 2. A different service on the port must probe as 'conflict'.
  const other = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('some other service')
  })
  other.listen(0, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 150))
  const p2 = other.address().port
  const probe2 = await probeService(p2, '127.0.0.1')
  check('probeService flags an unrelated service as "conflict"', probe2 === 'conflict', 'got ' + probe2)
  other.close()

  // 3. A free port must probe as 'free'.
  const free = createServer(() => {})
  free.listen(0, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 150))
  const p3 = free.address().port
  free.close()
  await new Promise((r) => setTimeout(r, 150))
  const probe3 = await probeService(p3, '127.0.0.1')
  check('probeService reports an unoccupied port as "free"', probe3 === 'free', 'got ' + probe3)
}

// --- Real repo smoke (uses the actual status.json + tasks) ---
{
  const s = buildState(ROOT)
  check('real repo buildState returns 3 agents', s.agents.length === 3)
  check('real repo statuses within allowed set', s.agents.every((a) => ['BUSY', 'REST', 'BLOCKED', 'UNKNOWN'].includes(a.status)))
  check('real repo generatedAt present', !!s.generatedAt)
  check('real repo git branch non-empty', typeof s.git.branch === 'string' && s.git.branch.length > 0)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)