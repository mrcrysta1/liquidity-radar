// Client half of Radar AI: talks to /api/chat, streams the answer back.
//
// The model returns Markdown, never HTML, and this file renders a small safe
// subset of it. That is deliberate: the chat log is written with innerHTML, so
// letting a model emit raw markup would make every future context source —
// news headlines, exchange names, anything scraped — a potential injection
// path. Escaping first and formatting second closes that off entirely.
import { buildMarketContext } from './aiContext'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Remembered across messages so follow-ups actually follow up. */
const history: ChatTurn[] = []
const MAX_HISTORY = 10

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

  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, context: buildMarketContext() }),
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

  if (full.trim()) {
    history.push({ role: 'user', content: question })
    history.push({ role: 'assistant', content: full })
    while (history.length > MAX_HISTORY) history.shift()
  }
  return full
}
