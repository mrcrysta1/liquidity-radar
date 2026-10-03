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
import { useTick } from './useTick'
import { MkIco } from './market/MarketHead'
import { MK_ICONS } from './market/mkIcons'

type Any = any

type Timeframe = '1h' | '24h' | '7d'
type FilterKey = 'all' | 'major' | 'meme'

const MAJORS = [
  'BTC',
  'ETH',
  'XAUUSD',
  'SOL',
  'BNB',
  'XRP',
  'ADA',
  'DOGE',
  'AVAX',
  'DOT',
  'LINK',
  'UNI',
  'SUI',
]
const MEMES = ['DOGE', 'PEPE', 'WIF', 'FLOKI', 'SHIB', 'BONK', 'TRUMP']
const WALL_THICKNESS = 60

interface BubbleMeta {
  sym: string
  name: string
  /** Gain/loss tone as r,g,b — the fill glows from it, the rim is drawn in it. */
  rgb: [number, number, number]
  pct: number
  r: number
}

function pctFor(k: string, tf: Timeframe, tickerPct: number): number | null {
  const mc = state.marketCaps[k]
  if (tf === '24h') return tickerPct
  if (tf === '1h') return mc?.chg1h ?? null
  return mc?.chg7d ?? null
}

/** Brighter for bigger moves: a +12% bubble glows harder than a +0.3% one. */
function toneFor(pct: number): [number, number, number] {
  const t = Math.min(1, Math.abs(pct) / 12)
  if (pct >= 0) return [Math.round(30 + t * 10), Math.round(150 + t * 80), Math.round(105 + t * 20)]
  return [Math.round(190 + t * 60), Math.round(60 - t * 25), Math.round(75 - t * 20)]
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

export function BubblesCanvas() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [tf, setTf] = useState<Timeframe>('24h')
  const [query, setQuery] = useState('')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<Matter.Engine | null>(null)
  const bodiesRef = useRef<Map<string, Matter.Body>>(new Map())
  const metaRef = useRef<Map<string, BubbleMeta>>(new Map())
  const wallsRef = useRef<Matter.Body[]>([])
  const sizeRef = useRef({ w: 800, h: 560 })
  // Mirrored into state as well: the radius pass below sizes bubbles against
  // the stage, so it has to re-run once the real width is known and again on
  // rotation. A ref alone would leave a phone showing desktop-sized bubbles.
  const [stage, setStage] = useState({ w: 800, h: 560 })
  const dragRef = useRef<{ k: string; x: number; y: number; moved: boolean } | null>(null)
  // Coin logos (from the market-cap feed), loaded once and drawn inside the bigger bubbles.
  const imgRef = useRef<Map<string, HTMLImageElement>>(new Map())

  const now = useTick(4000, ['bubbles'])
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
      dragRef.current = {
        k: String(body.label),
        x: mouse.position.x,
        y: mouse.position.y,
        moved: false,
      }
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
      setStage((p) => (Math.abs(p.w - rect.width) < 1 ? p : { w: rect.width, h: 560 }))
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
    let frame = 0
    let ink = '#fff'
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
      // Text colour follows the theme; re-read about once a second, not per frame.
      if (++frame % 60 === 1) ink = getComputedStyle(container).getPropertyValue('--txt').trim() || '#fff'
      bodiesRef.current.forEach((body, k) => {
        const meta = metaRef.current.get(k)
        if (!meta) return
        const { x, y } = body.position
        const r = meta.r
        const c = meta.rgb
        // Glass bubble: clear centre, colour gathering towards the rim, bright edge.
        const g = ctx.createRadialGradient(x, y - r * 0.25, r * 0.15, x, y, r)
        g.addColorStop(0, rgba(c, 0.1))
        g.addColorStop(0.72, rgba(c, 0.28))
        g.addColorStop(1, rgba(c, 0.62))
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()
        ctx.lineWidth = dragRef.current?.k === k ? 3 : 1.6
        ctx.strokeStyle = rgba(c, 0.95)
        ctx.stroke()
        // A soft highlight, top-left, so it reads as a sphere rather than a disc.
        ctx.beginPath()
        ctx.ellipse(x - r * 0.32, y - r * 0.42, r * 0.28, r * 0.13, -0.6, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.07)'
        ctx.fill()
        if (r <= 14) return
        const img = imgRef.current.get(k)
        const withLogo = r >= 30 && !!img && img.complete && img.naturalWidth > 0
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const label = k === 'XAUUSD' ? 'GOLD' : k
        if (withLogo) {
          const s2 = r * 0.5
          ctx.save()
          ctx.beginPath()
          ctx.arc(x, y - r * 0.36, s2 / 2, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(img!, x - s2 / 2, y - r * 0.36 - s2 / 2, s2, s2)
          ctx.restore()
        }
        const ty = withLogo ? y + r * 0.14 : r > 24 ? y - r * 0.12 : y
        ctx.fillStyle = ink
        ctx.font = '700 ' + Math.max(9, Math.round(r * (label.length > 4 ? 0.26 : 0.32))) + 'px Inter, system-ui, sans-serif'
        ctx.fillText(label, x, ty)
        if (r > 24) {
          ctx.font = '600 ' + Math.max(8, Math.round(r * 0.22)) + 'px "JetBrains Mono", ui-monospace, monospace'
          ctx.fillStyle = rgba([Math.min(255, c[0] + 60), Math.min(255, c[1] + 60), Math.min(255, c[2] + 60)], 1)
          ctx.fillText((meta.pct >= 0 ? '+' : '') + meta.pct.toFixed(1) + '%', x, ty + r * (withLogo ? 0.34 : 0.4))
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
    const { w, h } = stage
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

    // Radii used to be fixed in pixels, which only ever suited a desktop-width
    // canvas. The same thirty bubbles that fill about a sixth of a 1400px
    // stage tried to fill two-thirds of a phone's, so the solver shoved them
    // straight through the walls and half the coins sat clipped off the left
    // edge. Size them against the area actually available instead.
    const metricOf = (k: string): number => {
      const mc = state.marketCaps[k]
      return useCap && mc ? mc.marketCap : (state.tickers[COINS[k].sym]?.qvol ?? 0)
    }
    const maxMetricOf = (k: string): number => {
      const mc = state.marketCaps[k]
      return useCap && mc ? maxCap : maxVol
    }
    const baseR = (k: string): number =>
      22 + 56 * Math.sqrt(Math.max(0, metricOf(k)) / (maxMetricOf(k) || 1))

    // Aim for roughly a third of the stage covered — dense enough to look
    // alive, loose enough that the solver can still separate everything.
    const stageArea = Math.max(1, w * h)
    const baseArea = filtered.reduce((acc, k) => acc + Math.PI * baseR(k) ** 2, 0)
    const fit = baseArea > 0 ? Math.min(1, Math.sqrt((stageArea * 0.33) / baseArea)) : 1
    // No single coin may swallow the stage, however large its cap.
    const capR = Math.min(w, h) * 0.22
    const radiusOf = (k: string): number => Math.max(9, Math.min(capR, baseR(k) * fit))

    for (const k of filtered) {
      const c = COINS[k]
      const t = state.tickers[c.sym]!
      const pct = pctFor(k, tf, t.pct) ?? 0
      const r = radiusOf(k)

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
        Matter.Body.setVelocity(body, {
          x: (Math.random() - 0.5) * 2,
          y: (Math.random() - 0.5) * 2,
        })
        bodiesRef.current.set(k, body)
        Matter.Composite.add(engine.world, body)
      }
      metaRef.current.set(k, { sym: c.sym, name: c.name, rgb: toneFor(pct), pct, r })
      const logo = state.marketCaps[k]?.image
      if (logo && /^https:\/\//.test(logo) && !imgRef.current.has(k)) {
        const im = new Image()
        im.src = logo
        imgRef.current.set(k, im)
      }
    }
  }, [filtered, tf, stage])

  const anyCapData = filtered.some((k) => state.marketCaps[k])
  const moves = filtered
    .map((k) => ({ k, pct: pctFor(k, tf, state.tickers[COINS[k].sym]?.pct ?? 0) }))
    .filter((m): m is { k: string; pct: number } => m.pct != null && isFinite(m.pct))
  const up = moves.filter((m) => m.pct > 0).length
  const down = moves.filter((m) => m.pct < 0).length
  const best = moves.reduce<{ k: string; pct: number } | null>((a, m) => (!a || m.pct > a.pct ? m : a), null)
  const worst = moves.reduce<{ k: string; pct: number } | null>((a, m) => (!a || m.pct < a.pct ? m : a), null)
  const name = (k: string) => (k === 'XAUUSD' ? 'Gold' : k)
  const sgn = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const FILTERS: Array<[FilterKey, string]> = [['all', 'All coins'], ['major', 'Majors'], ['meme', 'Memes']]

  return (
    <div className="bub-page">
      <header className="sg-head">
        <div className="sg-title">
          <span className="sg-logo"><MkIco d={MK_ICONS.bubbles} size={28} /></span>
          <span>
            <h2>Crypto Bubbles</h2>
            <p>Every tracked coin as a bubble: size is how big it is, colour is how it moved</p>
          </span>
        </div>
        <div className="sg-stats bub-stats">
          <div className="sg-stat">
            <span className="sg-stat-ico"><MkIco d={MK_ICONS.breadth} size={20} /></span>
            <span><small>Gainers · losers</small><b><span className="up">{up}</span> <i className="mk-vs">vs</i> <span className="dn">{down}</span></b><em>{filtered.length} coins · {tf}</em></span>
          </div>
          <div className="sg-stat">
            <span className="sg-stat-ico"><MkIco d={MK_ICONS.up} size={20} /></span>
            <span><small>Top gainer</small><b>{best ? name(best.k) : '—'}</b><em className="up">{best ? sgn(best.pct) : 'waiting for prices'}</em></span>
          </div>
          <div className="sg-stat">
            <span className="sg-stat-ico bub-ico-red"><MkIco d={MK_ICONS.down} size={20} /></span>
            <span><small>Top loser</small><b>{worst ? name(worst.k) : '—'}</b><em className="dn">{worst ? sgn(worst.pct) : 'waiting for prices'}</em></span>
          </div>
        </div>
      </header>

      <div className="card bub-card">
        <div className="bub-ctrl">
          <div className="sg-chips">
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="sg-chips sg-chips-side bub-tf" role="group" aria-label="Change over">
            {(['1h', '24h', '7d'] as Timeframe[]).map((k) => (
              <button
                key={k}
                type="button"
                className={tf === k ? 'on' : ''}
                onClick={() => setTf(k)}
                title={k === '1h' || k === '7d' ? 'From CoinGecko — only available for the tracked Top 16' : undefined}
              >
                {k}
              </button>
            ))}
          </div>
          <label className="bub-search">
            <MkIco d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3" size={15} />
            <input type="text" placeholder="Search coin…" value={query} onChange={(e) => setQuery(e.currentTarget.value)} aria-label="Search coin" />
          </label>
        </div>
        <div className="bub-legend">
          <span><i className="lg sog"></i>Gainers</span>
          <span><i className="lg sor"></i>Losers</span>
          <span className="bub-hint">
            Size = {anyCapData ? 'market cap (24h volume where cap is unavailable)' : '24h traded volume'} · colour = {tf} change · drag to move, click to open the chart
          </span>
        </div>
        <div ref={containerRef} className="bub-stage" style={{ position: 'relative', width: '100%', height: 560 }}>
          <canvas ref={canvasRef} style={{ display: 'block', cursor: 'grab', touchAction: 'none' }} />
        </div>
      </div>
    </div>
  )
}
