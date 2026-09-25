// Server-side LLM proxy for Radar AI.
//
// The key lives in Vercel's environment and never reaches the browser bundle,
// which is the rule .env.example already states for every key in this project.
// The browser sends its question plus a snapshot of what the radar currently
// knows; this function adds the system prompt and forwards to Groq.
//
// Groq speaks the OpenAI chat format, so swapping provider later is a URL, a
// header and a model name — the rest of this file would not change.
//
// Responses stream. A chat that prints a paragraph all at once after four
// seconds feels broken even when it is fast; token-by-token feels immediate.

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

/** Hard caps. A serverless function is a public endpoint, not a private one. */
const MAX_TURNS = 12
const MAX_CHARS = 4000
const MAX_CONTEXT = 14000

const SYSTEM = `You are Radar AI, the analyst built into Liquidity Radar — a live market terminal covering crypto, spot metals, FX, indices and equities.

You are given a MARKET CONTEXT block containing what the terminal currently knows: live prices, indicators, signal-scanner output, derivatives data, liquidity, and recent headlines. Treat it as your only source of live fact.

How to answer:
- Ground every number in the context block. Never invent a price, level, percentage or headline. If the context does not contain something, say so plainly in one short sentence and answer with what you do have.
- Lead with the answer. No throat-clearing, no restating the question.
- Be specific and quantitative. "RSI 64 on the 15m, MACD histogram still positive" beats "momentum looks strong".
- Explain the reasoning behind a read, briefly, so it can be judged rather than trusted.
- When the data disagrees with itself, say that — a mixed picture is a real answer and usually the honest one.
- Match the user's language and register. Answer follow-ups in the context of the conversation so far.

On trading:
- You may analyse, lay out scenarios, and explain the terminal's own signals and levels.
- Never promise an outcome, never state a price target as fact, and never imply certainty the data cannot support. Say what would invalidate a read.
- You are an analysis tool, not a financial adviser, and the user is responsible for their own positions. State that only when it actually matters — a disclaimer on every message is noise.

Formatting: plain text with Markdown. **bold** for emphasis, "- " for bullets, short paragraphs. No headings, no tables, no HTML, no code fences unless showing an actual formula. Keep it tight — this renders in a narrow chat panel, so a few short paragraphs or a handful of bullets, not an essay.`

function clean(s, cap) {
  return String(s == null ? '' : s).slice(0, cap)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method', message: 'POST only' })
    return
  }
  const key = process.env.GROQ_API_KEY
  if (!key) {
    // A specific code, so the client can fall back to the local analyst
    // silently rather than showing the user a failure they cannot act on.
    res.status(503).json({ error: 'no_key', message: 'GROQ_API_KEY is not configured on this deployment.' })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = null }
  }
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    res.status(400).json({ error: 'bad_request', message: 'messages[] required' })
    return
  }

  const turns = body.messages
    .slice(-MAX_TURNS)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: clean(m.content, MAX_CHARS) }))
  if (!turns.length) {
    res.status(400).json({ error: 'bad_request', message: 'no usable messages' })
    return
  }

  const context = clean(body.context, MAX_CONTEXT)
  const messages = [
    { role: 'system', content: SYSTEM },
    ...(context ? [{ role: 'system', content: 'MARKET CONTEXT (live, from the terminal):\n' + context }] : []),
    ...turns,
  ]

  let upstream
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: MODEL,
        messages,
        // Low-ish: this is analysis over supplied numbers, and a creative
        // model is a model that starts rounding prices to nicer ones.
        temperature: 0.4,
        max_tokens: 900,
        stream: true,
      }),
    })
  } catch (e) {
    res.status(502).json({ error: 'upstream', message: String((e && e.message) || e) })
    return
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    res.status(upstream.status || 502).json({
      error: 'upstream',
      status: upstream.status,
      message: detail.slice(0, 400) || 'upstream error',
    })
    return
  }

  res.setHeader('content-type', 'text/event-stream; charset=utf-8')
  res.setHeader('cache-control', 'no-cache, no-transform')
  res.setHeader('connection', 'keep-alive')

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // Straight passthrough of Groq's SSE frames. The client already has to
      // parse them, and re-framing here would only add a place to get it wrong.
      res.write(decoder.decode(value, { stream: true }))
    }
  } catch {
    // A dropped upstream mid-answer: end the stream rather than hanging the
    // request. The client renders whatever arrived and says it was cut short.
  } finally {
    res.end()
  }
}
