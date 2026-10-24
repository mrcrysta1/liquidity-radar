// One combined-stream Binance socket for the focused symbol's live streams.
//
// The main chart used to open four sockets per symbol (ticker, trade tape,
// kline, depth) and close all four on every coin or timeframe switch. Binance
// takes ~2s to answer a client's Close frame and pings every connection on its
// own schedule; a ping landing inside that window makes Chrome fail the socket
// ("Ping received after close"), and a quick switch closed sockets that were
// still connecting. Here the socket stays up across switches: the wanted set
// is replaced and the difference is sent as one UNSUBSCRIBE and one SUBSCRIBE
// frame. The socket is only closed when nothing has been wanted for a while,
// when it stalls, or when the host changes.
//
// Binance drops a connection that sends more than 5 frames a second, so
// changes are coalesced and flushes are spaced at least `minGapMs` apart.
//
// Dependency-free so scripts/test-engines.mjs can load it in Node with a fake
// WebSocket.

export type StreamHandler = (data: unknown) => void

export interface MuxOptions {
  /** Combined-stream endpoint, e.g. wss://stream.binance.com:9443/stream */
  base: string
  /** Delay before a change is sent, so bursts coalesce. */
  flushMs: number
  /** Minimum spacing between flushes (each is at most two frames). */
  minGapMs: number
  /** Close the socket after this long with nothing wanted. */
  idleCloseMs: number
  /** Silence after which a stream counts as stalled (0 = never). */
  stallMs?: (stream: string) => number
  /** A stream went live (`up`) or stopped; `dropped` when the socket was lost rather than unsubscribed. */
  onLive?: (stream: string, up: boolean, dropped: boolean) => void
  /** The live set changed (open, drop, flush). */
  onChange?: () => void
  /** The socket was lost without being asked to close. */
  onDrop?: (reason: string) => void
}

interface SocketLike {
  readyState?: number
  send(data: string): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
}

export class StreamMux {
  private opts: MuxOptions
  private ws: SocketLike | null = null
  private open = false
  private attempt = 0
  private msgId = 1
  private wanted = new Map<string, StreamHandler>()
  /** Streams the server is subscribed to on the current socket. */
  private server = new Set<string>()
  /** Last message (or subscription) time per subscribed stream. */
  private since = new Map<string, number>()
  private lastFlush = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  /** Sockets created — the tests use it to prove switches reuse the socket. */
  socketsOpened = 0

  constructor(opts: Partial<MuxOptions> & { base: string }) {
    this.opts = { flushMs: 100, minGapMs: 600, idleCloseMs: 30_000, ...opts }
  }

  get connected(): boolean {
    return this.open
  }

  /** Wanted streams the open socket is actually subscribed to. */
  get liveCount(): number {
    if (!this.open) return 0
    let n = 0
    this.wanted.forEach((_h, k) => {
      if (this.server.has(k)) n++
    })
    return n
  }

  /** Replace the wanted set. A stream already subscribed keeps flowing to its new handler. */
  want(streams: Record<string, StreamHandler>): void {
    this.wanted = new Map(Object.entries(streams))
    if (this.wanted.size) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer)
        this.idleTimer = null
      }
      this.ensure()
    } else {
      // Nothing to reconnect for.
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
      this.scheduleIdleClose()
    }
    this.scheduleFlush()
  }

  /** Replace the socket if a live stream has gone quiet. Returns true when it did. */
  check(now = Date.now()): boolean {
    if (!this.open || !this.opts.stallMs) return false
    for (const k of this.server) {
      if (!this.wanted.has(k)) continue
      const limit = this.opts.stallMs(k)
      if (limit > 0 && now - (this.since.get(k) ?? now) > limit) {
        this.retire()
        this.opts.onDrop?.('stalled ' + k)
        this.retry()
        return true
      }
    }
    return false
  }

  /** The network came back: skip the remaining backoff. */
  wake(): void {
    if (this.ws || !this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.ensure()
  }

  /** Close the socket and forget everything (e.g. the host changes). */
  dispose(): void {
    this.wanted.clear()
    for (const t of [this.flushTimer, this.retryTimer, this.idleTimer]) if (t) clearTimeout(t)
    this.flushTimer = this.retryTimer = this.idleTimer = null
    this.retire()
  }

  private scheduleFlush(): void {
    if (this.flushTimer || !this.open) return
    const wait = Math.max(this.opts.flushMs, this.lastFlush + this.opts.minGapMs - Date.now())
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, wait)
  }

  /** Bring the server's subscriptions in line with the wanted set. */
  private flush(): void {
    if (!this.open || !this.ws) return
    const add: string[] = []
    const del: string[] = []
    this.wanted.forEach((_h, k) => {
      if (!this.server.has(k)) add.push(k)
    })
    this.server.forEach((k) => {
      if (!this.wanted.has(k)) del.push(k)
    })
    if (!add.length && !del.length) return
    this.lastFlush = Date.now()
    if (del.length) {
      this.send({ method: 'UNSUBSCRIBE', params: del, id: this.msgId++ })
      del.forEach((k) => {
        this.server.delete(k)
        this.since.delete(k)
        this.opts.onLive?.(k, false, false)
      })
    }
    if (add.length) {
      this.send({ method: 'SUBSCRIBE', params: add, id: this.msgId++ })
      const now = Date.now()
      add.forEach((k) => {
        this.server.add(k)
        this.since.set(k, now)
        this.opts.onLive?.(k, true, false)
      })
    }
    this.opts.onChange?.()
  }

  private send(m: unknown): void {
    try {
      this.ws?.send(JSON.stringify(m))
    } catch (e) {
      /* the close handler recovers */
    }
  }

  private scheduleIdleClose(): void {
    if (this.idleTimer || !this.ws) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.wanted.size) this.retire()
    }, this.opts.idleCloseMs)
  }

  /** Forget the current socket and close it, without scheduling a reconnect. */
  private retire(): void {
    const ws = this.ws
    this.drop(false)
    if (!ws) return
    // Handlers are already detached, so nothing from this socket reaches the
    // app again. A socket still connecting is aborted outright; deferring the
    // close until it opens would only add a Close handshake (and its ping race).
    try {
      ws.close()
    } catch (e) {
      /* ignore */
    }
  }

  private drop(lost: boolean): void {
    const ws = this.ws
    if (ws) ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    const was = this.open
    this.ws = null
    this.open = false
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (was) this.server.forEach((k) => this.opts.onLive?.(k, false, lost))
    this.server.clear()
    this.since.clear()
    if (was) this.opts.onChange?.()
  }

  private ensure(): void {
    if (this.ws || this.retryTimer || !this.wanted.size) return
    const names = [...this.wanted.keys()]
    let ws: SocketLike
    try {
      const Ctor = (globalThis as unknown as { WebSocket: new (url: string) => SocketLike })
        .WebSocket
      // The streams ride on the URL, so the first data needs no extra frame.
      ws = new Ctor(this.opts.base + '?streams=' + names.join('/'))
    } catch (e) {
      this.retry()
      return
    }
    this.socketsOpened++
    this.ws = ws
    this.server = new Set(names)
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.open = true
      this.attempt = 0
      const now = Date.now()
      this.server.forEach((k) => {
        this.since.set(k, now)
        this.opts.onLive?.(k, true, false)
      })
      this.opts.onChange?.()
      // The wanted set may have changed while connecting.
      this.scheduleFlush()
      if (!this.wanted.size) this.scheduleIdleClose()
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      let m: { stream?: string; data?: unknown }
      try {
        m = JSON.parse(String(ev.data))
      } catch (e) {
        return
      }
      // Subscription acks ({result, id}) carry no stream.
      if (!m || !m.stream || m.data === undefined) return
      const h = this.wanted.get(m.stream)
      if (!h || !this.server.has(m.stream)) return // unsubscribed; frames still in flight
      this.since.set(m.stream, Date.now())
      h(m.data)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.drop(true)
      this.opts.onDrop?.('closed')
      this.retry()
    }
    ws.onerror = () => {
      /* onclose follows and recovers */
    }
  }

  private retry(): void {
    if (this.retryTimer || !this.wanted.size) return
    // 1.2s x 2^attempt, capped at 30s, with jitter.
    const delay =
      Math.min(30_000, 1200 * Math.pow(2, Math.min(this.attempt++, 5))) +
      Math.floor(Math.random() * 400)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.ensure()
    }, delay)
  }
}
