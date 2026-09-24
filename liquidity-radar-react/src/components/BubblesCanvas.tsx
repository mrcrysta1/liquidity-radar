// Real physics via Matter.js - circle bodies with actual mass/restitution,
// a proper collision solver instead of a hand-rolled pairwise separation
// loop, static boundary walls, and spring-based mouse dragging
// (Matter.MouseConstraint) so grabbing a bubble feels like grabbing a bubble
// (it drags with give, and shoves its neighbors realistically) rather than
// teleporting to the cursor. Rendering stays hand-drawn on a plain canvas -
// Matter only owns the simulation, not the visuals - so labels, colors and
// the market-cap-driven sizing stay exactly as designed.
import { useEffect, useMemo, useRef, useState } from 'react'
import Matter from 'matter-js'
import { COINS } from '../constants/market'
import { state } from '../services/store'
import { setSymbol, switchTab } from '../features/actions/userActions'

type Any = any

type Timeframe = '1h' | '24h' | '7d'
type FilterKey = 'all' | 'major' | 'meme'

const MAJORS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'UNI', 'SUI']
const MEMES = ['DOGE', 'PEPE', 'WIF', 'FLOKI', 'SHIB', 'BONK', 'TRUMP']
const WALL_THICKNESS = 60

interface BubbleMeta {
  sym: string
  name: string
  color: string
  pct: number
  r: number
}

function pctFor(k: string, tf: Timeframe, tickerPct: number): number | null {
  const mc = state.marketCaps[k]
  if (tf === '24h') return tickerPct
  if (tf === '1h') return mc?.chg1h ?? null
  return mc?.chg7d ?? null
}

function colorFor(pct: number): string {
  const t = Math.min(1, Math.abs(pct) / 15)
  if (pct >= 0) {
    const g = Math.round(120 + t * 110)
    return `rgb(${Math.round(20 + t * 10)},${g},${Math.round(90 + t * 20)})`
  }
  const r = Math.round(150 + t * 100)
  return `rgb(${r},${Math.round(40 - t * 20)},${Math.round(50 - t * 10)})`
}

export function BubblesCanvas() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [tf, setTf] = useState<Timeframe>('24h')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<Matter.Engine | null>(null)
  const bodiesRef = useRef<Map<string, Matter.Body>>(new Map())
  const metaRef = useRef<Map<string, BubbleMeta>>(new Map())
  const wallsRef = useRef<Matter.Body[]>([])
  const sizeRef = useRef({ w: 800, h: 560 })
  const dragRef = useRef<{ k: string; x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 4000)
    return () => clearInterval(id)
  }, [])
  void now

  const keys = useMemo(() => {
    const all = Object.keys(COINS)
    if (filter === 'major') return all.filter((k) => MAJORS.includes(k))
    if (filter === 'meme') return all.filter((k) => MEMES.includes(k))
    return all
  }, [filter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return keys.filter((k) => {
      const t = state.tickers[COINS[k].sym]
      if (!t || !isFinite(t.last) || !(t.qvol > 0)) return false
      if (!q) return true
      return k.toLowerCase().includes(q) || COINS[k].name.toLowerCase().includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, query, now])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } })
    engineRef.current = engine

    const mouse = Matter.Mouse.create(canvas)
    const mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: 0.15, damping: 0.15, render: { visible: false } },
    })
    Matter.Composite.add(engine.world, mouseConstraint)

    Matter.Events.on(mouseConstraint, 'startdrag', (e: Any) => {
      const body = e.body as Matter.Body | undefined
      if (!body) return
      dragRef.current = { k: String(body.label), x: mouse.position.x, y: mouse.position.y, moved: false }
    })
    Matter.Events.on(mouseConstraint, 'mousemove', () => {
      const d = dragRef.current
      if (!d) return
      if (Math.hypot(mouse.position.x - d.x, mouse.position.y - d.y) > 4) d.moved = true
    })
    Matter.Events.on(mouseConstraint, 'enddrag', () => {
      const d = dragRef.current
      dragRef.current = null
      if (!d || d.moved) return
      const meta = metaRef.current.get(d.k)
      if (meta) {
        setSymbol(meta.sym)
        switchTab('radar')
      }
    })

    function buildWalls(w: number, h: number): void {
      if (wallsRef.current.length) Matter.Composite.remove(engine.world, wallsRef.current)
      const t = WALL_THICKNESS
      wallsRef.current = [
        Matter.Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, { isStatic: true }),
        Matter.Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, { isStatic: true }),
        Matter.Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, { isStatic: true }),
        Matter.Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, { isStatic: true }),
      ]
      Matter.Composite.add(engine.world, wallsRef.current)
    }

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      sizeRef.current = { w: rect.width, h: 560 }
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = 560 * dpr
      canvas.style.width = rect.width + 'px'
      canvas.style.height = '560px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildWalls(rect.width, 560)
    })
    ro.observe(container)

    // Every tab section stays mounted and is merely display:none when it is
    // not the active one, but requestAnimationFrame keeps firing — so the
    // matter-js collision pass below was running the whole time the user was
    // on some other tab. Watch whether the canvas is actually on screen and
    // idle the simulation when it is not.
    let onScreen = false
    const vis = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting
      },
      { threshold: 0 },
    )
    vis.observe(container)

    let raf = 0
    let last = performance.now()
    const step = (t: number) => {
      if (!onScreen) {
        // Keep `last` current so the first visible frame steps by one frame's
        // worth of time instead of the whole time spent hidden.
        last = t
        raf = requestAnimationFrame(step)
        return
      }
      const delta = Math.min(32, t - last)
      last = t
      bodiesRef.current.forEach((body) => {
        if (body === mouseConstraint.body) return
        Matter.Body.applyForce(body, body.position, {
          x: (Math.random() - 0.5) * body.mass * 0.0006,
          y: (Math.random() - 0.5) * body.mass * 0.0006,
        })
      })
      Matter.Engine.update(engine, delta)

      const { w, h } = sizeRef.current
      ctx.clearRect(0, 0, w, h)
      bodiesRef.current.forEach((body, k) => {
        const meta = metaRef.current.get(k)
        if (!meta) return
        const { x, y } = body.position
        const r = meta.r
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = meta.color
        ctx.globalAlpha = 0.88
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.lineWidth = dragRef.current?.k === k ? 2 : 0.5
        ctx.strokeStyle = 'rgba(255,255,255,.25)'
        ctx.stroke()
        if (r > 16) {
          ctx.fillStyle = '#fff'
          ctx.textAlign = 'center'
          ctx.font = Math.max(9, Math.round(r * 0.3)) + 'px sans-serif'
          ctx.fillText(k, x, y - r * 0.05)
          if (r > 26) {
            ctx.font = Math.max(8, Math.round(r * 0.22)) + 'px monospace'
            ctx.fillText((meta.pct >= 0 ? '+' : '') + meta.pct.toFixed(1) + '%', x, y + r * 0.32)
          }
        }
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(raf)
      vis.disconnect()
      ro.disconnect()
      Matter.Composite.clear(engine.world, false)
      Matter.Engine.clear(engine)
    }
  }, [])

  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const { w, h } = sizeRef.current
    const caps = filtered.map((k) => state.marketCaps[k]?.marketCap ?? 0)
    const vols = filtered.map((k) => state.tickers[COINS[k].sym]?.qvol ?? 0)
    const maxCap = Math.max(...caps, 0)
    const maxVol = Math.max(...vols, 1)
    const useCap = maxCap > 0
    const wanted = new Set(filtered)

    bodiesRef.current.forEach((body, k) => {
      if (wanted.has(k)) return
      Matter.Composite.remove(engine.world, body)
      bodiesRef.current.delete(k)
      metaRef.current.delete(k)
    })

    for (const k of filtered) {
      const c = COINS[k]
      const t = state.tickers[c.sym]!
      const pct = pctFor(k, tf, t.pct) ?? 0
      const mc = state.marketCaps[k]
      const metric = useCap && mc ? mc.marketCap : t.qvol
      const maxMetric = useCap && mc ? maxCap : maxVol
      const r = 22 + 56 * Math.sqrt(Math.max(0, metric) / (maxMetric || 1))

      const existing = bodiesRef.current.get(k)
      if (existing) {
        const prevR = metaRef.current.get(k)?.r ?? r
        if (Math.abs(prevR - r) > 0.5) Matter.Body.scale(existing, r / prevR, r / prevR)
      } else {
        const body = Matter.Bodies.circle(Math.random() * w, Math.random() * h, r, {
          restitution: 0.85,
          frictionAir: 0.02,
          friction: 0,
          label: k,
        })
        Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 })
        bodiesRef.current.set(k, body)
        Matter.Composite.add(engine.world, body)
      }
      metaRef.current.set(k, { sym: c.sym, name: c.name, color: colorFor(pct), pct, r })
    }
  }, [filtered, tf])

  const anyCapData = filtered.some((k) => state.marketCaps[k])

  return (
    <div className="card">
      <div className="sec-head">
        <div className="sec-title">Crypto Bubbles</div>
        <span className="badge b-cyan">{filtered.length} COINS</span>
      </div>
      <div className="bub-ctrl">
        <div className="bub-filter">
          <button className={'bub-f' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>
            All Coins
          </button>
          <button className={'bub-f' + (filter === 'major' ? ' on' : '')} onClick={() => setFilter('major')}>
            Majors
          </button>
          <button className={'bub-f' + (filter === 'meme' ? ' on' : '')} onClick={() => setFilter('meme')}>
            Memes
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['1h', '24h', '7d'] as Timeframe[]).map((k) => (
            <button
              key={k}
              className={'bub-f' + (tf === k ? ' on' : '')}
              onClick={() => setTf(k)}
              title={k === '1h' || k === '7d' ? 'From CoinGecko — only available for the tracked Top 16' : undefined}
            >
              {k}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search coin…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          className="pf-input"
          style={{ maxWidth: 160, marginLeft: 'auto' }}
        />
      </div>
      <div className="bub-legend">
        <span><i className="lg sog"></i>Gainers</span>
        <span><i className="lg sor"></i>Losers</span>
        <span className="bub-hint">
          Size = {anyCapData ? 'market cap (24h volume where cap is unavailable)' : '24h traded volume'} · color =
          {' ' + tf} change · drag to move, click to open chart
        </span>
      </div>
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: 560 }}>
        <canvas ref={canvasRef} style={{ display: 'block', cursor: 'grab', touchAction: 'none' }} />
      </div>
    </div>
  )
}
