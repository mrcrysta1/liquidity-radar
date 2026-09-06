// Phase 0 Agent OS validator tests.
// Run with: node scripts/agent-os.test.mjs
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadIdentities, parseHeader, validateTask, validateReport } from './agent-os.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

const TASK_OK =
  'TASK ID: CR-P0-001\n' +
  'PHASE: 0\n' +
  'AGENT ID: OC-LEAD\n' +
  'AGENT NAME: OpenCode\n' +
  'AUTHORIZED ROLE: Lead Architect + System Implementation\n' +
  'PROJECT: CRYPTO-RADAR\n' +
  'EXPECTED OUTPUT: Phase 0 Agent Operating System\n' +
  '---\n' +
  'OBJECTIVE: test\n'

const REPORT_OK =
  'TASK ID: CR-P0-001\n' +
  'AGENT ID: OC-LEAD\n' +
  'AGENT NAME: OpenCode\n' +
  'STATUS: COMPLETED\n' +
  'BRANCH: chore/phase-0-agent-operating-system\n' +
  'COMMIT: abc1234\n' +
  'TEST RESULTS: all pass\n' +
  'BLOCKERS: none\n' +
  '---\n'

// -- unit tests
const ids = loadIdentities()
check(
  'identities contain OC-LEAD / CL-UI / AI-REF',
  ids.some((i) => i.id === 'OC-LEAD') && ids.some((i) => i.id === 'CL-UI') && ids.some((i) => i.id === 'AI-REF'),
)

const h = parseHeader(TASK_OK)
check(
  'parseHeader extracts keys',
  h['TASK ID'] === 'CR-P0-001' && h['AGENT ID'] === 'OC-LEAD' && h['EXPECTED OUTPUT'].length > 0,
)

let v = validateTask(TASK_OK, 'OC-LEAD')
check(
  'correct agent accepted',
  v.ok === true && v.kind === 'AGENT ACCEPTED' && v.header['AGENT ID'] === 'OC-LEAD' && v.code === 0,
)

v = validateTask(TASK_OK, 'CL-UI')
check(
  'wrong agent rejected',
  v.ok === false && v.code === 2 && v.kind === 'WRONG AGENT' && v.wrong.expected === 'OC-LEAD' && v.wrong.current === 'CL-UI',
)

v = validateTask(TASK_OK, undefined)
check('task validated without current agent', v.ok === true && v.kind === 'TASK VALIDATED' && v.code === 0)

v = validateTask('TASK ID: CR-P0-001\nAGENT NAME: OpenCode\n', undefined)
check('task missing fields is unverifiable', v.ok === false && v.code === 3 && v.kind === 'UNVERIFIABLE')

v = validateTask(TASK_OK.replace('AGENT ID: OC-LEAD', 'AGENT ID: GHOST-X'), undefined)
check('unknown agent flagged', v.ok === false && v.code === 4 && v.kind === 'UNKNOWN AGENT')

v = validateReport(REPORT_OK, 'OC-LEAD')
check('report verified', v.ok === true && v.kind === 'REPORT VERIFIED' && v.code === 0)

v = validateReport('STATUS: COMPLETED\n')
check('report without identity is unverified', v.ok === false && v.code === 3 && v.kind === 'UNVERIFIED')

// -- CLI integration tests
function runCli(args) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'agent-os.mjs'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') }
  }
}

let cli = runCli(['task', 'tasks/CR-P0-001.md', '--agent-id', 'OC-LEAD'])
check(
  'CLI correct agent exits 0 with AGENT ACCEPTED',
  cli.code === 0 && cli.out.includes('AGENT ACCEPTED') && cli.out.includes('Task ID: CR-P0-001'),
)

cli = runCli(['task', 'tasks/CR-P0-001.md', '--agent-id', 'CL-UI'])
check(
  'CLI wrong agent exits 2 with standardized rejection',
  cli.code === 2 &&
    cli.out.includes('WRONG AGENT') &&
    cli.out.includes('Expected Agent: OC-LEAD') &&
    cli.out.includes('Current Agent: CL-UI') &&
    cli.out.includes('Action: STOP'),
)

cli = runCli(['identity'])
check('CLI identity lists all three agents', cli.code === 0 && cli.out.includes('OC-LEAD') && cli.out.includes('CL-UI') && cli.out.includes('AI-REF'))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)