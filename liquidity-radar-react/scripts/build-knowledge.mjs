// Builds Radar AI's knowledge pack: api/_knowledge.json, read by api/_brain.mjs.
//
//   node scripts/build-knowledge.mjs        (also runs first in `npm run build`)
//
// Everything the assistant should know about how the site and the bot work,
// taken from what the project already keeps up to date, so the pack never
// needs hand-editing:
// - the Learning library (src/features/learn/*: every guide, model and
//   technique, the same text as Settings → Learning),
// - the site and bot facts Radar AI already had (chat/projectKnowledge.ts),
// - the bot's README and the strategy audits (docs/research/*.md),
// - the header comment of every source file in the bot (radar-worker/src) and
//   the site's features (src/features): the "how it works and why" notes at
//   the top of each file.
// A source that is missing (e.g. a deploy without the bot's folder) is skipped
// with a warning; the pack is generated, not committed (.gitignore).
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const APP = resolve(here, '..')
const REPO = resolve(APP, '..')
/** Longest chunk (characters); longer documents are split at paragraphs. */
const CHUNK = 3500

const warn = (m) => console.warn('[knowledge] ' + m)

/** Splits text at blank lines into pieces of at most `max` characters. */
export function split(text, max = CHUNK) {
  const out = []
  let cur = ''
  for (const para of text.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length + 2 > max) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? cur + '\n\n' + para : para
    while (cur.length > max) {
      out.push(cur.slice(0, max))
      cur = cur.slice(max)
    }
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** One Learning entry as plain text. */
export function entryText(e) {
  const lines = [e.summary]
  if (e.inApp) lines.push('In the app: ' + e.inApp)
  for (const b of e.body || []) {
    if ('p' in b) lines.push(b.p)
    else if ('list' in b) lines.push(b.list.map((x) => '- ' + x).join('\n'))
    else if ('formula' in b) lines.push('Formula: ' + b.formula)
    else if ('tip' in b) lines.push('Tip: ' + b.tip)
    else if ('warn' in b) lines.push('Caution: ' + b.warn)
    else if ('caption' in b && b.caption) lines.push('(Diagram: ' + b.caption + ')')
  }
  return lines.join('\n\n')
}

/** A Markdown document cut at its ## and ### headings. */
export function markdownChunks(md, idBase, source) {
  const out = []
  const parts = md.split(/^(?=#{1,3} )/m)
  for (const part of parts) {
    const m = part.match(/^#{1,3} (.+)\n?/)
    const title = m ? m[1].trim() : source
    const body = (m ? part.slice(m[0].length) : part).trim()
    if (body.length < 40) continue
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
    split(body).forEach((t, i) => out.push({ id: `${idBase}#${slug}${i ? '-' + (i + 1) : ''}`, title, source, text: t }))
  }
  return out
}

/** The leading // comment block of a source file, as text ('' when there is none worth keeping). */
export function headerComment(src) {
  const lines = []
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*\/\//.test(line)) lines.push(line.replace(/^\s*\/\/ ?/, ''))
    else if (!line.trim() && !lines.length) continue
    else break
  }
  const text = lines.join('\n').trim()
  return text.length >= 200 ? text : ''
}

function walk(dir, exts) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name)
    if (d.isDirectory()) return d.name === 'node_modules' || d.name.startsWith('.') ? [] : walk(p, exts)
    return exts.some((e) => d.name.endsWith(e)) && !/\.(test|spec)\./.test(d.name) && !d.name.endsWith('.d.ts') ? [p] : []
  })
}

export async function buildKnowledge() {
  const chunks = []

  // The Learning library.
  const learn = join(APP, 'src/features/learn')
  for (const [file, names] of [['basics.ts', ['START', 'RISK', 'TECH']], ['models.ts', ['MODELS']], ['indicators.ts', ['INDICATORS']], ['concepts.ts', ['CONCEPTS']], ['patterns.ts', ['PATTERNS']]]) {
    try {
      const mod = await import(pathToFileURL(join(learn, file)).href)
      for (const name of names) {
        const s = mod[name]
        for (const e of s.entries) split(entryText(e)).forEach((t, i) => chunks.push({ id: 'learn:' + e.id + (i ? '-' + (i + 1) : ''), title: e.title, source: 'Learning library: ' + s.title, tags: e.tags || [], text: t }))
      }
    } catch (e) {
      warn(file + ': ' + e.message)
    }
  }

  // Site and bot facts.
  try {
    const { PROJECT_KNOWLEDGE } = await import(pathToFileURL(join(APP, 'src/features/chat/projectKnowledge.ts')).href)
    split(PROJECT_KNOWLEDGE).forEach((t, i) => chunks.push({ id: 'site:overview' + (i ? '-' + (i + 1) : ''), title: 'Liquidity Radar site and bot overview', source: 'Project knowledge', text: t }))
  } catch (e) {
    warn('projectKnowledge.ts: ' + e.message)
  }

  // Documents.
  const docs = [[join(REPO, 'radar-worker/README.md'), 'doc:bot-readme', 'Trading bot README (radar-worker)']]
  for (const f of walk(join(REPO, 'docs/research'), ['.md'])) docs.push([f, 'doc:' + relative(REPO, f).replace(/\\/g, '/').replace(/\.md$/, ''), 'Research report ' + relative(join(REPO, 'docs/research'), f)])
  for (const [file, id, source] of docs) {
    if (!existsSync(file)) {
      warn('missing ' + relative(REPO, file))
      continue
    }
    chunks.push(...markdownChunks(readFileSync(file, 'utf8'), id, source))
  }

  // How each part works, from the top-of-file notes.
  for (const [root, label] of [[join(REPO, 'radar-worker/src'), 'Trading bot code'], [join(REPO, 'radar-worker/scripts'), 'Trading bot scripts'], [join(APP, 'src/features'), 'Website code']]) {
    if (!existsSync(root)) {
      warn('missing ' + relative(REPO, root))
      continue
    }
    for (const f of walk(root, ['.ts', '.tsx', '.mjs'])) {
      if (f.startsWith(learn)) continue
      const text = headerComment(readFileSync(f, 'utf8'))
      if (!text) continue
      const rel = relative(REPO, f).replace(/\\/g, '/')
      split(text).forEach((t, i) => chunks.push({ id: 'code:' + rel + (i ? '#' + (i + 1) : ''), title: rel, source: label, text: t }))
    }
  }

  const ids = new Set()
  return chunks.filter((c) => !ids.has(c.id) && ids.add(c.id))
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const chunks = await buildKnowledge()
  const out = join(APP, 'api/_knowledge.json')
  writeFileSync(out, JSON.stringify({ built: new Date().toISOString(), chunks }))
  const chars = chunks.reduce((a, c) => a + c.text.length, 0)
  console.log(`[knowledge] ${chunks.length} chunks, ${Math.round(chars / 1000)}k chars -> ${relative(APP, out)}`)
}
