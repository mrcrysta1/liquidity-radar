// Radar AI in Discord: POST /api/discord, the app's Interactions Endpoint URL.
//
// Discord sends each slash command here, signed with the app's Ed25519 key.
// A request whose signature does not check out is refused (Discord itself
// tests that before it accepts the URL). `/ask <question>` is answered in two
// steps, because Discord waits only 3 seconds for a reply: an immediate
// "thinking…" (a deferred response), then the answer edited in once the model
// has written it, through the interaction's own webhook (no bot token needed).
//
// Same free model chain and system prompt as the website (api/chat.mjs). What
// differs is the context: Discord has no screen, so instead of the browser's
// market snapshot it gets live Binance spot prices and the testnet bot's
// Supabase records (anonymous, read-only, the same tables the site shows).
// Read-only: nothing here can trade or change a setting.
//
// Register the command once with scripts/discord-register.mjs.
import { createPublicKey, verify } from 'node:crypto'
import { buildMessages, createRateLimiter, providerChain, providerRequest } from './chat.mjs'

// Both are public by design (the key only verifies Discord's signatures); the
// env overrides them for another Discord app.
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '60e2bddf5b6be1513aa5cc43491f5650699da5331a5bc6746975be99859cda8c'
const APP_ID = process.env.DISCORD_APP_ID || '1568628618957955082'

/** Signed requests older than this are refused (replays). */
const MAX_SKEW_S = 300
const MAX_BODY = 64 * 1024
/** Discord's message limit. */
const MAX_REPLY = 2000
const MAX_QUESTION = 500
const ANSWER_MS = 40_000
// Free-tier model quota is shared with the website: a few questions a minute per person.
const limiter = createRateLimiter({ limit: 8, windowMs: 5 * 60_000 })

// ---------------------------------------------------------------- signature

/** The app's Ed25519 public key (hex, as the developer portal shows it). */
export function publicKey(hex = PUBLIC_KEY) {
  // A raw 32-byte Ed25519 key wrapped in its fixed SPKI header.
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' })
}

/** True when Discord signed `timestamp + body` with the app's key, recently. */
export function verifySignature(body, signature, timestamp, key = publicKey(), now = Date.now()) {
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature) || !/^\d{1,12}$/.test(timestamp)) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_S) return false
  try {
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- context

const DB_URL = (process.env.VITE_WHALE_DB_URL || '').replace(/\/+$/, '')
const DB_KEY = process.env.VITE_WHALE_DB_KEY || ''
const DEFAULT_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'PAXG']

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error(url.split('?')[0] + ': HTTP ' + r.status)
  return r.json()
}

const db = (path) => getJson(DB_URL + '/rest/v1/' + path, { apikey: DB_KEY, authorization: 'Bearer ' + DB_KEY })

/** Coin tickers the question names ("how is DOGE", "sol?"), besides the defaults; at most 3. */
export function mentionedCoins(question) {
  const words = String(question).toUpperCase().match(/\b[A-Z0-9]{2,10}\b/g) || []
  // Plain words and the site's own names; anything else is tried as a ticker and dropped when Binance does not list it.
  const skip = new Set(('THE AND FOR HOW WHAT WHY WHO WHEN IS IT ITS BE AM ARE WAS DO DOES DID CAN WILL SHOULD ME MY WE OUR YOU TO IN ON OF AT UP BY OR IF SO NO NOT OK VS ALL ANY GO GOING LOOK LOOKING ABOUT WITH THIS THAT THERE NEXT WEEK DAY TODAY NOW ' +
    'BOT BUY SELL LONG SHORT PRICE USD USDT AI ML F1 C6 C2 X1 X2 F1X CPI NFP PPI GDP FOMC FED PCE RSI MACD EMA').split(' '))
  return [...new Set(words.map((w) => w.replace(/USDT$/, '')).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !skip.has(w) && !DEFAULT_COINS.includes(w)))].slice(0, 3)
}

/** One JSON line, cut to `cap` characters. */
const line = (label, v, cap = 2500) => (v == null ? '' : label + ': ' + JSON.stringify(v).slice(0, cap) + '\n')

function slimAccount(a) {
  if (!a) return null
  const r = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null)
  return {
    readAt: a.t ? new Date(a.t).toISOString() : null,
    equity: r(a.marginBalance),
    wallet: r(a.walletBalance),
    unrealized: r(a.unrealizedPnl),
    positions: (a.positions || []).map((p) => ({ symbol: p.symbol, side: p.side, size: p.size, entry: p.entry, mark: p.mark, unrealized: r(p.unrealized) })),
  }
}

function slimAudit(a) {
  if (!a || !Array.isArray(a.strategies)) return null
  return a.strategies.map((s) => ({ id: s.id, verdict: s.verdict, meanR_conservative: s.profiles?.conservative?.mean ?? null, n: s.profiles?.conservative?.n ?? s.n ?? null }))
}

/** The CONTEXT text for the model: each source on its own, a failed one marked unavailable. */
export async function discordContext(question, now = Date.now()) {
  const extra = mentionedCoins(question)
  const spot = (coins) => getJson('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(coins.map((c) => c + 'USDT'))))
  const bot = DB_URL && DB_KEY
  const iso = (ms) => new Date(ms).toISOString()
  const [prices, extras, state, trades, events] = await Promise.allSettled([
    spot(DEFAULT_COINS),
    // One request per named coin: an unknown ticker must not sink the others.
    Promise.all(extra.map((c) => spot([c]).then((r) => r[0]).catch(() => null))),
    bot ? db('bot_state?select=key,value&key=in.(heartbeat,account,context:latest,audit:latest,report:daily,ml:eval)') : Promise.reject(new Error('no bot database')),
    bot ? db('bot_trades?select=symbol,side,status,strategy,opened_at,closed_at,entry,exit,sl,tp,exit_reason,r_multiple&order=opened_at.desc&limit=15') : Promise.reject(new Error('no bot database')),
    bot ? db(`econ_events?select=title,category,impact,event_time,forecast,previous,actual&country=eq.USD&event_time=gte.${iso(now - 6 * 3_600_000)}&event_time=lte.${iso(now + 3 * 86_400_000)}&order=event_time.asc&limit=20`) : Promise.reject(new Error('no bot database')),
  ])
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null)
  const ticks = [...(ok(prices) || []), ...(ok(extras) || [])]
    .filter(Boolean)
    .map((t) => ({ symbol: t.symbol, last: Number(t.lastPrice), change24hPct: Number(t.priceChangePercent), high24h: Number(t.highPrice), low24h: Number(t.lowPrice), quoteVolume24h: Math.round(Number(t.quoteVolume)) }))
  const st = Object.fromEntries((ok(state) || []).map((r) => [r.key, r.value]))
  const report = st['report:daily']?.latest ?? null
  let out = `ANSWERED IN DISCORD at ${iso(now)}. No terminal screen here: no charts, indicators, scanner or order book, only the data below. Action tags ([[...]]) do nothing in Discord, so do not add them; mention the website tab in words instead.\n`
  out += ticks.length ? line('SPOT PRICES (Binance, live)', ticks, 3000) : 'SPOT PRICES: unavailable.\n'
  if (!bot) return out + 'BOT STATUS: unavailable (no bot database on this deployment).\n'
  if (state.status === 'rejected') out += 'BOT STATUS: unavailable (records could not be read).\n'
  else {
    out += line('BOT HEARTBEAT (testnet bot, fake money)', st.heartbeat ? { ...st.heartbeat, at: st.heartbeat.t ? iso(st.heartbeat.t) : null } : 'none recorded', 400)
    out += line('BOT ACCOUNT (testnet USDT)', slimAccount(st.account), 1500)
    out += line('MARKET CONTEXT (regime, BTC/gold/DXY, correlations)', st['context:latest'] ?? null, 3000)
    out += line('STRATEGY AUDIT (backtest verdicts, R per trade after conservative costs)', slimAudit(st['audit:latest']), 1500)
    out += line('LATEST DAILY REPORT', report, 2000)
    out += line('ML CALIBRATION STUDY', st['ml:eval'] ?? null, 1000)
  }
  out += trades.status === 'fulfilled' ? line('BOT TRADES (newest first, R = multiple of risk)', trades.value, 3500) : 'BOT TRADES: unavailable.\n'
  out += events.status === 'fulfilled' ? line('US ECONOMIC RELEASES (last 6 h and next 3 days)', events.value, 2500) : 'US ECONOMIC RELEASES: unavailable.\n'
  return out
}

// ---------------------------------------------------------------- answer

/** The model's answer for Discord: action tags removed, cut to Discord's limit. */
export function forDiscord(text) {
  const t = String(text || '').replace(/\[\[[^\]\n]{1,60}\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > MAX_REPLY ? t.slice(0, MAX_REPLY - 1) + '…' : t
}

/** Ask the model chain (no streaming); the first provider that answers wins. */
export async function askModel(messages) {
  for (const p of providerChain()) {
    const q = providerRequest(p, messages)
    try {
      const r = await fetch(q.url, { method: 'POST', headers: q.headers, body: JSON.stringify({ ...q.body, stream: false }), signal: AbortSignal.timeout(ANSWER_MS) })
      if (!r.ok) {
        console.error('[api/discord]', p.id, 'status', r.status, (await r.text().catch(() => '')).slice(0, 300))
        continue
      }
      const text = (await r.json())?.choices?.[0]?.message?.content
      if (text) return text
    } catch (e) {
      console.error('[api/discord]', p.id, 'request failed:', (e && e.message) || e)
    }
  }
  return null
}

/** Answer one question and edit it into the deferred reply. */
export async function answer(interactionToken, question, appId = APP_ID) {
  let reply
  try {
    const context = await discordContext(question)
    const messages = buildMessages({ messages: [{ role: 'user', content: question }], context })
    const text = messages && (await askModel(messages))
    reply = text ? forDiscord(`> ${question.replace(/\n/g, ' ')}\n\n${text}`) : 'The assistant is unavailable right now. Try again in a minute.'
  } catch (e) {
    console.error('[api/discord] answer failed:', (e && e.message) || e)
    reply = 'Something went wrong while answering. Try again in a minute.'
  }
  const r = await fetch(`https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    // allowed_mentions: a model's text must never ping @everyone or a role.
    body: JSON.stringify({ content: reply, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(8000),
  }).catch((e) => ({ ok: false, status: (e && e.message) || e }))
  if (!r.ok) console.error('[api/discord] reply failed:', r.status)
}

/** Keep the function alive for work after the response (Vercel's request context, as @vercel/functions reads it). */
function waitUntil(p) {
  const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.()
  if (ctx?.waitUntil) ctx.waitUntil(p)
}

async function rawBody(req) {
  // Read before anything touches req.body, which would parse (and consume) it.
  let size = 0
  const chunks = []
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) return null
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Discord's reply types: 1 pong, 4 message, 5 deferred message. 64 = only the asker sees it. */
const say = (content, ephemeral = true) => ({ type: 4, data: { content, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method', message: 'POST only' })
    return
  }
  const body = await rawBody(req)
  const h = (n) => (Array.isArray(req.headers[n]) ? req.headers[n][0] : req.headers[n])
  if (body == null || !verifySignature(body, h('x-signature-ed25519'), h('x-signature-timestamp'))) {
    res.status(401).json({ error: 'signature', message: 'invalid request signature' })
    return
  }
  let i
  try {
    i = JSON.parse(body)
  } catch {
    res.status(400).json({ error: 'bad_request' })
    return
  }
  if (i.type === 1) {
    res.status(200).json({ type: 1 })
    return
  }
  if (i.type !== 2 || i.data?.name !== 'ask') {
    res.status(200).json(say('Unknown command. Use `/ask` followed by your question.'))
    return
  }
  const question = String(i.data.options?.find((o) => o.name === 'question')?.value ?? '').trim().slice(0, MAX_QUESTION)
  if (!question) {
    res.status(200).json(say('Ask a question, e.g. `/ask how is BTC looking?`'))
    return
  }
  // DISCORD_ALLOWED_USERS (optional, comma-separated user ids): only they may ask.
  const userId = i.member?.user?.id || i.user?.id || 'unknown'
  const allowed = String(process.env.DISCORD_ALLOWED_USERS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length && !allowed.includes(userId)) {
    res.status(200).json(say('Sorry, this assistant only answers its owner.'))
    return
  }
  const slot = limiter.take(userId)
  if (!slot.ok) {
    res.status(200).json(say(`Too many questions. Try again in about ${slot.retryAfter} s.`))
    return
  }
  if (!providerChain().length) {
    res.status(200).json(say('No AI provider key is configured on this deployment.'))
    return
  }
  waitUntil(answer(i.token, question))
  res.status(200).json({ type: 5 })
}
