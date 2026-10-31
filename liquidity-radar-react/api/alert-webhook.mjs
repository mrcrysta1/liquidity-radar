// Vercel serverless relay for alert webhooks: POST /api/alert-webhook
// { url, message } → POSTs `message` to the user's https URL, as TradingView
// does (JSON content type when the message parses as JSON, plain text
// otherwise).
//
// Why a relay: the browser cannot POST to arbitrary hosts (most webhook
// receivers send no CORS headers), and a public relay must not become a way
// into private networks, so the target is checked here — https only, no IP
// literals, no credentials, and the host must resolve to public addresses.
//
// Alerts are evaluated in the browser (features/alerts), so a webhook only
// fires while the app is open somewhere; there is no server-side alert engine.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { clientIp, createRateLimiter, requestAllowed } from './chat.mjs'

const TIMEOUT_MS = 5_000
/** Request body cap (the message is capped at 500 chars client-side). */
const MAX_BODY = 4 * 1024
const MAX_MESSAGE = 2000
const MAX_URL = 500
// A few alerts can fire together; a loop of them should not hammer anyone.
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 })

/** The https URL to call, or null. Host names only: IP literals are refused outright. */
export function webhookTarget(raw) {
  const s = String(raw ?? '').trim()
  if (!s || s.length > MAX_URL) return null
  let u
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  if (u.port && u.port !== '443') return null
  const h = u.hostname.toLowerCase()
  if (isIP(h.replace(/^\[|\]$/g, '')) || !h.includes('.')) return null
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h)) return null
  return u
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip) {
  const v = String(ip).toLowerCase()
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  if (isIP(v) === 6) {
    if (v === '::' || v === '::1') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    if (mapped) return isPrivateAddress(mapped[1])
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v)
  }
  return true
}

/** The content type the message goes out with. */
export function messageType(msg) {
  try {
    const v = JSON.parse(msg)
    return v && typeof v === 'object' ? 'application/json' : 'text/plain; charset=utf-8'
  } catch {
    return 'text/plain; charset=utf-8'
  }
}

async function readBody(req) {
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : ''
  if (raw.length > MAX_BODY) throw new Error('too large')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  // Same gate as the chat proxy: only the app itself relays.
  if (!requestAllowed(req)) return res.status(403).json({ error: 'Origin not allowed' })
  const len = Number(req.headers?.['content-length'])
  if (len > MAX_BODY) return res.status(413).json({ error: 'Body too large' })
  const rl = limiter.take(clientIp(req))
  if (!rl.ok) {
    res.setHeader('retry-after', String(rl.retryAfter))
    return res.status(429).json({ error: 'Too many webhooks' })
  }
  let body
  try {
    body = await readBody(req)
  } catch {
    return res.status(400).json({ error: 'Bad JSON' })
  }
  const u = webhookTarget(body?.url)
  if (!u) return res.status(400).json({ error: 'Webhook must be a public https:// URL' })
  const message = String(body?.message ?? '').slice(0, MAX_MESSAGE)
  if (!message) return res.status(400).json({ error: 'Empty message' })
  // Resolve first and refuse private targets. (A host could re-resolve
  // differently for the fetch itself; redirects are not followed, which closes
  // the easy route, and the response body is never returned to the caller.)
  try {
    const addrs = await lookup(u.hostname, { all: true, verbatim: true })
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
      return res.status(400).json({ error: 'Webhook host is not public' })
  } catch {
    return res.status(400).json({ error: 'Webhook host does not resolve' })
  }
  try {
    const r = await fetch(u, {
      method: 'POST',
      headers: { 'content-type': messageType(message), 'user-agent': 'LiquidityRadar-Alerts/1.0' },
      body: message,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await r.body?.cancel().catch(() => {})
    return res.status(200).json({ ok: r.status >= 200 && r.status < 300, status: r.status })
  } catch (e) {
    console.error('[api/alert-webhook] delivery failed', u.hostname, e && e.message ? e.message : e)
    return res.status(502).json({ error: 'Webhook delivery failed' })
  }
}
