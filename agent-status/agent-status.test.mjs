// Agent Status Monitor tests — CR-P0-008 (CL-UI).
// Run with: node agent-status/agent-status.test.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStatusToken, analyze, snapshotResult, STATUS_TOKENS } from './agent-status.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SCRIPT = join(HERE, 'agent-status.mjs')

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (detail !== undefined ? ' - ' + detail : ''))
  }
}

function makeRoot(withStatus, extra = {}) {
  const root = join(tmpdir(), 'agent-status-test-' + Date.now() + '-' + Math.floor(Math.random() * 1e9))
  mkdirSync(join(root, 'agents'), { recursive: true })
  mkdirSync(join(root, 'tasks'), { recursive: true })
  writeFileSync(join(root, 'AGENTS.md'), '# test', 'utf8')
  writeFileSync(
    join(root, 'agents', 'identities.json'),
    JSON.stringify({
      identities: [
        { id: 'OC-LEAD', name: 'OpenCode', role: 'Lead Architect' },
        { id: 'CL-UI', name: 'Cline', role: 'UI/UX' },
        { id: 'AI-REF', name: 'Aider', role: 'Testing' },
      ],
    }),
  )
  writeFileSync(
    join(root, 'tasks', 'index.json'),
    JSON.stringify({ tasks: [{ id: 'CR-P0-007', title: 'Some task', status: 'COMPLETED', branch: 'b', pr: 11 }] }),
  )
  if (withStatus !== null) {
    mkdirSync(join(root, 'agent-status'), { recursive: true })
    writeFileSync(join(root, 'agent-status', 'status.json'), withStatus, 'utf8')
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const VALID_JSON = JSON.stringify({
  version: 1,
  agents: {
    'OC-LEAD': { name: 'OpenCode', status: 'REST' },
    'CL-UI': { name: 'Cline', status: 'TESTING', taskId: 'CR-P0-007' },
    'AI-REF': { name: 'Aider', status: 'BLOCKED' },
  },
})

// -- parseStatusToken unit tests
const tokenCases = [
  ['REST', 'REST', true],
  ['busy', 'BUSY', true],
  ['BLOCKED', 'BLOCKED', true],
  ['UNKNOWN', 'UNKNOWN', true],
  ['TESTING', 'BUSY', true],
  ['VERIFYING', 'BUSY', true],
  ['PR', 'BUSY', true],
  ['PRODUCTION', 'BUSY', true],
  ['GARBAGE', 'UNKNOWN', false],
  ['', 'UNKNOWN', false],
]
for (const [tok, pub, valid] of tokenCases) {
  const r = parseStatusToken(tok)
  check(`parseStatusToken(${JSON.stringify(tok)}) -> ${pub}/valid=${valid}`, r.public === pub && r.valid === valid)
}
check('STATUS_TOKENS includes all 8', STATUS_TOKENS.length === 8)

// -- analyze() tests
{
  const t = makeRoot(VALID_JSON)
  const a = analyze(t.root)
  check('valid status -> no errors', a.errors.length === 0, JSON.stringify(a.errors))
  const byId = Object.fromEntries(a.records.map((r) => [r.id, r]))
  check('OC-LEAD REST', byId['OC-LEAD'].statusPublic === 'REST')
  check('CL-UI TESTING surfaces as BUSY', byId['CL-UI'].statusPublic === 'BUSY')
  check('CL-UI raw status kept', byId['CL-UI'].statusRaw === 'TESTING')
  check('AI-REF BLOCKED', byId['AI-REF'].statusPublic === 'BLOCKED')
  check('CL-UI task cross-ref found', byId['CL-UI'].registry && byId['CL-UI'].registry.status === 'COMPLETED')
  t.cleanup()
}

{
  const t = makeRoot('{ not valid json ')
  const a = analyze(t.root)
  check('invalid JSON captured as error', a.errors.some((e) => e.includes('invalid JSON')))
  check('invalid JSON -> all UNKNOWN', a.records.every((r) => r.statusPublic === 'UNKNOWN'))
  t.cleanup()
}

{
  const t = makeRoot(null) // no status.json
  const a = analyze(t.root)
  check('missing source reported', a.errors.some((e) => e.includes('not found')))
  check('missing source -> all UNKNOWN', a.records.every((r) => r.statusPublic === 'UNKNOWN'))
  check('missing source marks agents present=false', a.records.every((r) => r.present === false))
  t.cleanup()
}

{
  const t = makeRoot(JSON.stringify({ agents: { 'OC-LEAD': { name: 'OpenCode', status: 'NOPE' } } }))
  const a = analyze(t.root)
  const oc = a.records.find((r) => r.id === 'OC-LEAD')
  check('invalid status token -> UNKNOWN', oc.statusPublic === 'UNKNOWN')
  check('invalid token is an error', a.errors.some((e) => e.includes('invalid status token')))
  check('missing CL-UI/AI-REF -> UNKNOWN', a.records.filter((r) => r.id !== 'OC-LEAD').every((r) => r.statusPublic === 'UNKNOWN'))
  t.cleanup()
}

{
  const t = makeRoot(JSON.stringify({ agents: { 'OC-LEAD': { status: 'REST' }, 'CL-UI': { status: 'REST' }, 'AI-REF': { status: 'REST' }, 'GHOST-X': { status: 'BUSY' } } }))
  const a = analyze(t.root)
  check('unknown agent key flagged', a.errors.some((e) => e.includes('GHOST-X')))
  t.cleanup()
}

{
  const t = makeRoot(JSON.stringify({ agents: { 'OC-LEAD': { name: 'WrongName', status: 'REST' }, 'CL-UI': { status: 'REST' }, 'AI-REF': { status: 'REST' } } }))
  const a = analyze(t.root)
  check('name mismatch -> warning, no error', a.warnings.some((w) => w.includes('name')) && a.errors.length === 0)
  t.cleanup()
}

check('snapshotResult valid shape', snapshotResult().agents['OC-LEAD'] && Array.isArray(Object.keys(snapshotResult().agents)))

// -- CLI integration tests
function runCli(args) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') }
  }
}

{
  const v = runCli(['validate'])
  check('CLI validate on real repo is valid (exit 0)', v.code === 0, 'code=' + v.code + ' ' + v.err)
}
{
  const s = runCli(['snapshot'])
  check('CLI snapshot valid JSON', JSON.parse(s.out).agents['OC-LEAD'] !== undefined)
}
{
  const j = runCli(['status'])
  check('CLI status renders table with BUSY/REST/BLOCKED/UNKNOWN', ['BUSY', 'REST', 'BLOCKED', 'UNKNOWN'].every((k) => j.out.includes(k)))
}

// -- CLI set command (writes to a temp-root status.json)
{
  const t = makeRoot(JSON.stringify({ version: 1, agents: { 'OC-LEAD': { name: 'OpenCode', status: 'REST' }, 'CL-UI': { name: 'Cline', status: 'REST' }, 'AI-REF': { name: 'Aider', status: 'REST' } } }))
  const s = execFileSync(process.execPath, [SCRIPT, 'set', 'OC-LEAD', 'BUSY', '--task-id', 'CR-P0-999', '--task-name', 'X'], { cwd: t.root, encoding: 'utf8' })
  check('CLI set exits 0', s.status === 0 || s.status === undefined)
  const reread = analyze(t.root)
  const oc = reread.records.find((r) => r.id === 'OC-LEAD')
  check('CLI set updated status to BUSY', oc.statusPublic === 'BUSY')
  check('CLI set recorded taskId', oc.taskId === 'CR-P0-999')
  t.cleanup()
}
{
  const t = makeRoot(null)
  let threw = false
  try {
    execFileSync(process.execPath, [SCRIPT, 'set', 'GHOST', 'BUSY'], { cwd: t.root, encoding: 'utf8' })
  } catch (e) {
    threw = true
    check('CLI set rejects unknown agent (exit ' + e.status + ')', e.status !== 0)
  }
  if (!threw) check('CLI set rejects unknown agent', false, 'did not fail as expected')
  t.cleanup()
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)