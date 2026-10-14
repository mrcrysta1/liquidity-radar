// Shared kline WebSocket hub. Ported from the Pro terminal's core/ws/streamHub.ts.
//
// Every companion chart used to open its own Binance socket. The hub carries
// all of them on one combined-stream connection: subscriptions are
// reference-counted per stream, changed live with SUBSCRIBE / UNSUBSCRIBE
// frames, and replayed after a reconnect (with exponential backoff).
//
// Two things differ from the Pro version:
// - Binance drops a connection that sends more than 5 frames a second, so
//   changes are coalesced: the hub diffs what is wanted against what the
//   server has and sends at most one SUBSCRIBE and one UNSUBSCRIBE per flush.
// - With nothing subscribed for a while the socket is closed, rather than
//   left open carrying nothing.
//
// Dependency-free so scripts/test-engines.mjs can load it in Node with a fake
// WebSocket.

/** A kline event exactly as Binance sends it (`{ e: 'kline', s, k: {...} }`). */
export type KlineEvent = { e: string; s?: string; k: Record<string, unknown> }
export type KlineHandler = (d: KlineEvent) => void

/** Binance allows 1024 streams per connection; stay well inside it. */
export const MAX_HUB_STREAMS = 200

export interface HubOptions {
  url: string
  /** Delay before pending (un)subscriptions are sent, so bursts coalesce. */
  flushMs: number
  /** Close the socket after this long with no subscriptions. */
  idleCloseMs: number
  onStatus?: (up: boolean, url: string) => void
}

interface SocketLike {
  send(data: string): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
}

export class KlineHub {
  private opts: HubOptions
  private ws: SocketLike | null = null
  private open = false
  private attempt = 0
  private msgId = 1
  private subs = new Map<string, Set<KlineHandler>>()
  /** Streams the server has been told about on the current socket. */
  private server = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** Sockets this hub has created — the tests use it to prove multiplexing. */
  socketsOpened = 0

  constructor(opts: Partial<HubOptions> = {}) {
    this.opts = {
      url: 'wss://stream.binance.com:9443/stream',
      flushMs: 250,
      idleCloseMs: 15_000,
      ...opts,
    }
  }

  get streamCount(): number {
    return this.subs.size
  }
  get connected(): boolean {
    return this.open
  }

  /** `sym` is a Binance symbol (BTCUSDT), `interval` a native Binance interval. */
  static key(sym: string, interval: string): string {
    return sym.toLowerCase() + '@kline_' + interval
  }

  subscribe(sym: string, interval: string, h: KlineHandler): () => void {
    const k = KlineHub.key(sym, interval)
    let set = this.subs.get(k)
    if (!set) {
      if (this.subs.size >= MAX_HUB_STREAMS)
        throw new Error('Stream limit reached (' + MAX_HUB_STREAMS + ')')
      set = new Set()
      this.subs.set(k, set)
    }
    set.add(h)
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.ensure()
    this.scheduleFlush()
    let done = false
    return () => {
      if (done) return
      done = true
      const s = this.subs.get(k)
      if (!s) return
      s.delete(h)
      if (s.size) return
      this.subs.delete(k)
      this.scheduleFlush()
      if (!this.subs.size) this.scheduleIdleClose()
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer || !this.open) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, this.opts.flushMs)
  }

  /** Bring the server's subscription set in line with the wanted one. */
  private flush(): void {
    if (!this.open || !this.ws) return
    const add: string[] = []
    const del: string[] = []
    this.subs.forEach((_s, k) => {
      if (!this.server.has(k)) add.push(k)
    })
    this.server.forEach((k) => {
      if (!this.subs.has(k)) del.push(k)
    })
    // One frame per 100 streams keeps each frame small; with the 200-stream
    // cap that is at most two frames each way.
    for (let i = 0; i < del.length; i += 100) {
      const params = del.slice(i, i + 100)
      this.send({ method: 'UNSUBSCRIBE', params, id: this.msgId++ })
      params.forEach((k) => this.server.delete(k))
    }
    for (let i = 0; i < add.length; i += 100) {
      const params = add.slice(i, i + 100)
      this.send({ method: 'SUBSCRIBE', params, id: this.msgId++ })
      params.forEach((k) => this.server.add(k))
    }
  }

  private send(m: unknown): void {
    try {
      this.ws?.send(JSON.stringify(m))
    } catch (e) {
      /* the close handler recovers */
    }
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.subs.size) return
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
      const ws = this.ws
      this.drop()
      try {
        ws?.close()
      } catch (e) {
        /* ignore */
      }
    }, this.opts.idleCloseMs)
  }

  /** Forget the current socket without scheduling a reconnect. */
  private drop(): void {
    const ws = this.ws
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    }
    const was = this.open
    this.ws = null
    this.open = false
    this.server.clear()
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (was) this.opts.onStatus?.(false, this.opts.url)
  }

  private ensure(): void {
    if (this.ws || this.retryTimer || !this.subs.size) return
    let ws: SocketLike
    try {
      const Ctor = (globalThis as unknown as { WebSocket: new (url: string) => SocketLike })
        .WebSocket
      ws = new Ctor(this.opts.url)
    } catch (e) {
      this.retry()
      return
    }
    this.socketsOpened++
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.open = true
      this.attempt = 0
      this.server.clear()
      this.opts.onStatus?.(true, this.opts.url)
      this.flush() // replay every wanted stream on the fresh socket
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      let m: { stream?: string; data?: KlineEvent }
      try {
        m = JSON.parse(String(ev.data))
      } catch (e) {
        return
      }
      const d = m && m.data
      if (!m.stream || !d || d.e !== 'kline' || !d.k) return
      const set = this.subs.get(m.stream)
      if (!set) return
      set.forEach((h) => {
        try {
          h(d)
        } catch (e) {
          /* one bad handler must not starve the rest */
        }
      })
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.drop()
      this.retry()
    }
    ws.onerror = () => {
      try {
        ws.close()
      } catch (e) {
        /* ignore */
      }
    }
  }

  private retry(): void {
    if (this.retryTimer || !this.subs.size) return
    const delay = Math.min(30_000, 500 * Math.pow(2, this.attempt++)) + Math.random() * 300
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.ensure()
    }, delay)
  }
}
