// Live liquidation feed (all Binance USD-M perps) — Pro Terminal's
// `!forceOrder@arr` stream adopted into the main app's native services.
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

export function initLiquidations(): void {
  alive = true
  connect()
}

export function stopLiquidations(): void {
  alive = false
  try {
    ws?.close()
  } catch {
    /* ignore */
  }
  ws = null
}

function connect(): void {
  try {
    ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr')
  } catch {
    schedule()
    return
  }
  const self = ws
  self.onopen = () => {
    retry = 0
    state.liqWs = 'open'
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
    state.liqWs = 'closed'
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
  setTimeout(() => {
    if (alive) connect()
  }, delay)
}
