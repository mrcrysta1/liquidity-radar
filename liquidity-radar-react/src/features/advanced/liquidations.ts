// Live liquidation feed (all Binance USD-M perps) — Pro Terminal's
// `!forceOrder@arr` stream adopted into the main app's native services.
import { noteStream } from '../../services/dataSources'
import { state } from '../../services/store'

export interface Liq {
  symbol: string
  side: 'BUY' | 'SELL'
  price: number
  qty: number
  ts: number
}

let ws: WebSocket | null = null
let retry = 0
let alive = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

export function initLiquidations(): void {
  alive = true
  if (!ws && !retryTimer) connect() // never a second socket
}

export function stopLiquidations(): void {
  alive = false
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  const old = ws
  ws = null
  if (!old) return
  // Detached first: an intentional close must not report the stream as down
  // or schedule a reconnect.
  old.onopen = old.onmessage = old.onclose = old.onerror = null
  state.liqWs = 'closed'
  try {
    old.close()
  } catch {
    /* ignore */
  }
}

const LIQ_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr'

function connect(): void {
  try {
    ws = new WebSocket(LIQ_URL)
  } catch {
    schedule()
    return
  }
  const self = ws
  self.onopen = () => {
    retry = 0
    state.liqWs = 'open'
    noteStream(LIQ_URL, true)
  }
  self.onmessage = (ev: MessageEvent) => {
    let d: { e?: string; o?: Record<string, unknown> } | null
    try {
      d = JSON.parse(ev.data)
    } catch {
      return
    }
    const o = d && d.o
    if (!o || !o.s) return
    const liq: Liq = {
      symbol: String(o.s),
      side: o.S === 'BUY' ? 'BUY' : 'SELL',
      price: Number(o.p),
      qty: Number(o.q),
      ts: Number(o.T) || Date.now(),
    }
    state.liqs = [liq, ...(state.liqs as Liq[])].slice(0, 200)
    state.liqWs = 'open'
  }
  self.onclose = () => {
    if (ws !== self) return
    ws = null
    state.liqWs = 'closed'
    noteStream(LIQ_URL, false)
    if (!alive) return
    schedule()
  }
  self.onerror = () => {
    /* recovery handled by onclose */
  }
}

function schedule(): void {
  retry++
  const delay = Math.min(30000, 1200 * Math.pow(2, Math.min(retry, 5)))
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (alive && !ws) connect()
  }, delay)
}
