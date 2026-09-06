#!/usr/bin/env node
// Phase 0 - Agent Operating System validator. No external dependencies.
// Usage:
//   node scripts/agent-os.mjs identity
//   node scripts/agent-os.mjs task <task-file> [--agent-id <AGENT_ID>]
//   node scripts/agent-os.mjs report <report-file> [--agent-id <AGENT_ID>]
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const _here = fileURLToPath(import.meta.url)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IDENTITIES_FILE = join(ROOT, 'agents', 'identities.json')

const REQUIRED_TASK = ['TASK ID', 'AGENT ID', 'AGENT NAME', 'AUTHORIZED ROLE', 'PROJECT', 'EXPECTED OUTPUT']
const REQUIRED_REPORT = ['TASK ID', 'AGENT ID']
const REPORT_ADVISORY = ['AGENT NAME', 'STATUS', 'BRANCH', 'COMMIT', 'FILES CHANGED', 'TEST RESULTS', 'BLOCKERS', 'NEXT RECOMMENDED ACTION']

export function loadIdentities() {
  if (!existsSync(IDENTITIES_FILE)) throw new Error('agents/identities.json not found')
  return JSON.parse(readFileSync(IDENTITIES_FILE, 'utf8')).identities
}

export function identityById(identities, id) {
  return identities.find((x) => x.id === id) || null
}

export function parseHeader(text) {
  const header = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^\s*(?:-{3,}|={3,})\s*$/.test(line)) break
    const m = line.match(/^([A-Z][A-Z0-9 ]{1,40}):[ \t]*(.*)$/)
    if (!m) break
    header[m[1]] = m[2].trim()
  }
  return header
}

function missingFields(header, keys) {
  return keys.filter((k) => !(header[k] && String(header[k]).trim()))
}

export function validateTask(text, currentAgentId) {
  const header = parseHeader(text)
  const missing = missingFields(header, REQUIRED_TASK)
  if (missing.length) {
    return { ok: false, code: 3, kind: 'UNVERIFIABLE', header, missing, wrong: null }
  }
  const identity = identityById(loadIdentities(), header['AGENT ID'])
  if (!identity) {
    return { ok: false, code: 4, kind: 'UNKNOWN AGENT', header, missing: [], wrong: null }
  }
  const current = String(currentAgentId || '').toUpperCase()
  if (current && current !== header['AGENT ID']) {
    return {
      ok: false,
      code: 2,
      kind: 'WRONG AGENT',
      header,
      missing: [],
      wrong: { expected: header['AGENT ID'], current },
    }
  }
  return { ok: true, code: 0, kind: current ? 'AGENT ACCEPTED' : 'TASK VALIDATED', header, missing: [], wrong: null }
}

export function validateReport(text, currentAgentId) {
  const header = parseHeader(text)
  const missing = missingFields(header, REQUIRED_REPORT)
  if (missing.length) {
    return { ok: false, code: 3, kind: 'UNVERIFIED', header, missing, advisoryMissing: REPORT_ADVISORY }
  }
  const identity = identityById(loadIdentities(), header['AGENT ID'])
  if (!identity) {
    return { ok: false, code: 4, kind: 'UNKNOWN AGENT', header, missing: [], advisoryMissing: REPORT_ADVISORY }
  }
  return {
    ok: true,
    code: 0,
    kind: 'REPORT VERIFIED',
    header,
    missing: [],
    advisoryMissing: missingFields(header, REPORT_ADVISORY),
    identity,
  }
}

function usage() {
  process.stdout.write(
    'Phase 0 Agent OS\n' +
      'Usage:\n' +
      '  node scripts/agent-os.mjs identity\n' +
      '  node scripts/agent-os.mjs task <task-file> [--agent-id <AGENT_ID>]\n' +
      '  node scripts/agent-os.mjs report <report-file> [--agent-id <AGENT_ID>]\n',
  )
}

function readFile(path) {
  if (!existsSync(path)) {
    process.stderr.write('FILE NOT FOUND: ' + path + '\n')
    process.exit(5)
  }
  return readFileSync(path, 'utf8')
}

function runTask(file, agentId) {
  const v = validateTask(readFile(file), agentId)
  if (v.kind === 'WRONG AGENT') {
    process.stdout.write(
      'WRONG AGENT\n' +
        'Expected Agent: ' + v.wrong.expected + '\n' +
        'Current Agent: ' + v.wrong.current + '\n' +
        'Task ID: ' + v.header['TASK ID'] + '\n' +
        'Action: STOP\n' +
        'Reason: This task is not authorized for this agent.\n' +
        'Do not attempt to "help anyway."\n',
    )
    process.exit(2)
  }
  if (v.kind === 'UNVERIFIABLE') {
    process.stdout.write(
      'UNVERIFIABLE\n' +
        'Task ID: ' + (v.header['TASK ID'] || '(missing)') + '\n' +
        'Missing required fields: ' + v.missing.join(', ') + '\n',
    )
    process.exit(3)
  }
  if (v.kind === 'UNKNOWN AGENT') {
    process.stdout.write('UNKNOWN AGENT\nAGENT ID in the task is not defined in agents/identities.json.\n')
    process.exit(4)
  }
  process.stdout.write(
    v.kind + '\n' +
      'Task ID: ' + v.header['TASK ID'] + '\n' +
      'Agent ID: ' + v.header['AGENT ID'] + '\n' +
      'Agent Name: ' + v.header['AGENT NAME'] + '\n' +
      'Role: ' + v.header['AUTHORIZED ROLE'] + '\n' +
      'Project: ' + v.header['PROJECT'] + '\n' +
      'Expected Output: ' + v.header['EXPECTED OUTPUT'] + '\n' +
      'Branch Policy: work only on the dedicated task branch; never commit to master.\n',
  )
  process.exit(0)
}

function runReport(file, agentId) {
  const v = validateReport(readFile(file), agentId)
  if (v.kind === 'UNVERIFIED') {
    process.stdout.write(
      'UNVERIFIED\n' +
        'Missing required identity fields: ' + v.missing.join(', ') + '\n' +
        'A report without valid task + agent identification is UNVERIFIED and must be re-submitted.\n',
    )
    process.exit(3)
  }
  if (v.kind === 'UNKNOWN AGENT') {
    process.stdout.write('UNKNOWN AGENT\nReport AGENT ID is not defined in agents/identities.json.\n')
    process.exit(4)
  }
  process.stdout.write(
    'REPORT VERIFIED\n' +
      'Task ID: ' + v.header['TASK ID'] + '\n' +
      'Agent ID: ' + v.header['AGENT ID'] + '\n',
  )
  if (v.advisoryMissing.length) process.stdout.write('Missing advisory fields: ' + v.advisoryMissing.join(', ') + '\n')
  if (agentId && String(agentId).toUpperCase() !== v.header['AGENT ID']) {
    process.stdout.write('WARNING: report agent does not match --agent-id ' + agentId + '\n')
  }
  process.exit(0)
}

function main() {
  const [, , command, file, ...rest] = process.argv
  const agentId = (() => {
    const i = rest.indexOf('--agent-id')
    return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined
  })()
  if (command === 'identity') {
    const identities = loadIdentities()
    process.stdout.write('AGENT ID | AGENT NAME  | AUTHORIZED ROLE\n')
    for (const id of identities) {
      process.stdout.write(id.id.padEnd(8) + ' | ' + id.name.padEnd(11) + ' | ' + id.role + '\n')
    }
    process.exit(0)
  }
  if (command === 'task') return runTask(file, agentId)
  if (command === 'report') return runReport(file, agentId)
  usage()
  process.exit(1)
}

export const _selfIsMain = (() => {
  if (!process.argv[1]) return false
  try {
    return resolve(process.argv[1]) === resolve(_here)
  } catch {
    return false
  }
})()

if (_selfIsMain) main()