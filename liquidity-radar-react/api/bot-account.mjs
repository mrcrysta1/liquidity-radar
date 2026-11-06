// Vercel serverless read of the bot's Binance testnet account snapshot:
// GET /api/bot-account → { account } for the Neural Net page's Binance card
// (components/neural/BinanceAccount.tsx) and Radar AI's bot context.
//
// The snapshot (bot_state key 'account', written by radar-worker) is no longer
// readable with the public anon key (radar-worker/sql/009_bot_private.sql), so
// it is read here with the service-role key, which stays in the server
// environment, and only the fields the card shows are passed on.
//
// Env (server only, never VITE_):
//   SUPABASE_SERVICE_ROLE_KEY  Supabase service_role / secret key
//   SUPABASE_URL               Project URL; falls back to VITE_WHALE_DB_URL
// Without them: 503 { error: 'not_configured' }, and the card says the account
// view is unavailable.
import { clientIp, createRateLimiter, requestAllowed } from './chat.mjs'

const TIMEOUT_MS = 8_000
// The card polls every 15 s and the chat once a minute, per open tab.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 })
const MAX_ROWS = 50
const MAX_FILLS = 20

/** The Supabase URL and key from the environment, or null. */
export function dbConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || env.VITE_WHALE_DB_URL || '').trim().replace(/\/+$/, '')
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!key || !/^https?:\/\/[^/\s]+$/i.test(url)) return null
  return { url, key }
}

const num = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const str = (v, cap = 40) => String(v ?? '').slice(0, cap)
const list = (v, cap) => (Array.isArray(v) ? v.slice(0, cap) : [])
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt)

/** The snapshot reduced to what the Binance card renders; null when unusable. */
export function publicAccount(raw) {
  let a = raw
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a)
    } catch {
      return null
    }
  }
  if (!a || typeof a !== 'object' || !Number.isFinite(Number(a.t))) return null
  return {
    t: num(a.t),
    venue: str(a.venue, 100),
    walletBalance: num(a.walletBalance),
    unrealizedPnl: num(a.unrealizedPnl),
    marginBalance: num(a.marginBalance),
    availableBalance: num(a.availableBalance),
    positions: list(a.positions, MAX_ROWS).map((p) => ({
      symbol: str(p?.symbol),
      side: pick(p?.side, ['LONG', 'SHORT'], 'LONG'),
      size: num(p?.size),
      entry: num(p?.entry),
      mark: num(p?.mark),
      unrealized: num(p?.unrealized),
      leverage: num(p?.leverage),
      liquidation: num(p?.liquidation),
      margin: num(p?.margin),
    })),
    orders: list(a.orders, MAX_ROWS).map((o) => ({
      symbol: str(o?.symbol),
      side: pick(o?.side, ['BUY', 'SELL'], 'BUY'),
      type: str(o?.type),
      price: num(o?.price),
      qty: num(o?.qty),
      reduceOnly: o?.reduceOnly === true,
    })),
    fills: list(a.fills, MAX_FILLS).map((f) => ({
      symbol: str(f?.symbol),
      time: num(f?.time),
      side: pick(f?.side, ['BUY', 'SELL'], 'BUY'),
      price: num(f?.price),
      qty: num(f?.qty),
      realizedPnl: num(f?.realizedPnl),
      commission: num(f?.commission),
    })),
  }
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (req.method !== 'GET') return res.status(405).json({ error: 'method', message: 'GET only' })
  if (!requestAllowed(req)) return res.status(403).json({ error: 'forbidden', message: 'Origin not allowed.' })
  const slot = limiter.take(clientIp(req))
  if (!slot.ok) {
    res.setHeader('retry-after', String(slot.retryAfter))
    return res.status(429).json({ error: 'rate_limited', message: 'Too many requests.' })
  }
  const cfg = dbConfig()
  if (!cfg) return res.status(503).json({ error: 'not_configured', message: 'Account view is not configured on this deployment.' })
  const headers = { apikey: cfg.key, accept: 'application/json' }
  // Legacy service_role keys are JWTs and go in Authorization too; the newer
  // sb_secret_ keys are not JWTs and only go in apikey.
  if (cfg.key.startsWith('eyJ')) headers.authorization = 'Bearer ' + cfg.key
  try {
    const r = await fetch(cfg.url + '/rest/v1/bot_state?select=value&key=eq.account', {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) {
      console.error('[api/bot-account] records read failed: HTTP', r.status)
      return res.status(502).json({ error: 'upstream', message: 'Account records could not be read.' })
    }
    const rows = await r.json()
    const account = Array.isArray(rows) && rows.length ? publicAccount(rows[0]?.value) : null
    return res.status(200).json({ account })
  } catch (e) {
    console.error('[api/bot-account] records read failed:', e && e.name ? e.name : 'error')
    return res.status(502).json({ error: 'upstream', message: 'Account records could not be read.' })
  }
}
