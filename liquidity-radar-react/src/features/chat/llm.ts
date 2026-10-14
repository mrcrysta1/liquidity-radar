// Client half of Radar AI: talks to /api/chat, streams the answer back.
//
// The model returns Markdown, never HTML, and this file renders a small safe
// subset of it. That is deliberate: the chat log is written with innerHTML, so
// letting a model emit raw markup would make every future context source —
// news headlines, exchange names, anything scraped — a potential injection
// path. Escaping first and formatting second closes that off entirely.
import { buildMarketContext } from './aiContext'
import { appGuide } from './actions'
import { storageGet, storageSet } from '../../services/storage'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Remembered across messages, and across reloads, so follow-ups follow up. */
const HISTORY_KEY = 'lr-chatHistory-v1'
const MAX_HISTORY = 10
const history: ChatTurn[] = (() => {
  const saved = storageGet<ChatTurn[]>(HISTORY_KEY, [])
  return Array.isArray(saved)
    ? saved.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string').slice(-MAX_HISTORY)
    : []
})()

/** The saved conversation, oldest first (for redrawing the log after a reload). */
export function chatHistory(): ChatTurn[] {
  return history.slice()
}

/** Remember an exchange that did not go through the model (local commands, fallback answers). */
export function rememberTurn(question: string, answer: string): void {
  history.push({ role: 'user', content: question }, { role: 'assistant', content: answer })
  while (history.length > MAX_HISTORY) history.shift()
  storageSet(HISTORY_KEY, history)
}

/** Learning topic ids and titles, loaded with the library on the first question. */
let learnIndex: Map<string, string> | null = null
/** Search words (id, tags, title) per topic, for matching "fvg" to fair-value-gap. */
let learnWords: Array<[string, string[]]> = []
export async function loadLearnIndex(): Promise<Map<string, string>> {
  if (learnIndex) return learnIndex
  try {
    const { LEARN_SECTIONS } = await import('../learn/content')
    const entries = LEARN_SECTIONS.flatMap((s) => s.entries)
    learnIndex = new Map(entries.map((e) => [e.id, e.title] as [string, string]))
    learnWords = entries.map((e) => [e.id, [e.id, e.id.replace(/-/g, ' '), e.title.toLowerCase(), ...(e.tags ?? []).map((t) => t.toLowerCase())]])
  } catch {
    learnIndex = new Map()
  }
  return learnIndex
}
/** The topic a phrase names: exact id, then an exact tag or title, then a title containing it. */
export async function findLearnTopic(phrase: string): Promise<string | null> {
  const idx = await loadLearnIndex()
  const q = phrase.trim().toLowerCase()
  if (idx.has(q)) return q
  const exact = learnWords.find(([, w]) => w.includes(q))
  if (exact) return exact[0]
  const part = learnWords.find(([, w]) => w[2].includes(q) || w.some((x) => x.startsWith(q + ' ')))
  return part ? part[0] : null
}
export function learnTitle(id: string): string | undefined {
  return learnIndex?.get(id)
}

/**
 * Whether the deployment has an LLM behind it.
 *
 * Unknown until the first attempt — probing on load would mean a request
 * every page view for a feature the user may never open.
 */
let available: boolean | null = null
export function llmAvailable(): boolean | null {
  return available
}

export function resetChatHistory(): void {
  history.length = 0
  storageSet(HISTORY_KEY, history)
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Markdown → HTML for the narrow subset the system prompt asks for.
 * Everything is escaped first, so only the tags produced here can exist.
 */
export function renderMarkdown(md: string): string {
  const lines = esc(md).split('\n')
  const out: string[] = []
  let inList = false
  const inline = (s: string): string =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  for (const raw of lines) {
    const line = raw.trimEnd()
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    if (li) {
      if (!inList) {
        out.push('<ul class="ai-ul">')
        inList = true
      }
      out.push('<li>' + inline(li[1]) + '</li>')
      continue
    }
    if (inList) {
      out.push('</ul>')
      inList = false
    }
    if (!line.trim()) {
      out.push('<br>')
      continue
    }
    out.push('<div>' + inline(line) + '</div>')
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

export class LlmUnavailable extends Error {}

/**
 * Ask the model, streaming tokens to `onChunk` as they arrive.
 *
 * Throws LlmUnavailable when this deployment has no key, or when the endpoint
 * is not there at all — which is the case under plain `vite dev`, where there
 * are no serverless functions. The caller falls back to the local analyst.
 */
export async function askLlm(
  question: string,
  onChunk: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatTurn[] = [...history, { role: 'user', content: question }]
  const learn = await loadLearnIndex()
  const context = buildMarketContext() + '\n\n' + appGuide([...learn.keys()])

  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, context }),
      signal,
    })
  } catch {
    available = false
    throw new LlmUnavailable('network')
  }

  if (res.status === 503 || res.status === 404 || res.status === 405) {
    available = false
    throw new LlmUnavailable('not configured')
  }
  if (!res.ok || !res.body) {
    // A real upstream failure, not a missing key — surface it rather than
    // pretending the assistant simply does not exist.
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.message || j?.error || ''
    } catch {
      /* body was not json */
    }
    throw new Error(detail || 'chat failed (' + res.status + ')')
  }
  available = true

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // SSE frames are separated by a blank line; a frame can also arrive split
    // across reads, so only complete ones are consumed.
    const frames = buf.split('\n\n')
    buf = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          const piece = j?.choices?.[0]?.delta?.content
          if (piece) {
            full += piece
            onChunk(full)
          }
        } catch {
          /* a partial or non-JSON frame — the next read completes it */
        }
      }
    }
  }

  if (full.trim()) rememberTurn(question, full)
  return full
}
