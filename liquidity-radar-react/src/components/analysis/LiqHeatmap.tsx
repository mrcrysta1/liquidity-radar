// Liquidation heatmap for the Analysis tab — the Pro terminal's panel, wired
// to this app's data layer and given a full-screen control.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  COLORMAPS,
  MODELS,
  RANGES,
  buildHeatmap,
  clipLevel,
  colorAt,
  fmtUsd,
} from '../../features/analysis/liqHeatmap/engine'
import type { ColormapId, Heatmap, OiPoint } from '../../features/analysis/liqHeatmap/engine'
import { loadCandleWindow } from '../../services/marketData'
import type { CandleFlat } from '../../services/market'
import { state } from '../../services/store'
import { instrumentOf } from '../../constants/instruments'
import { baseOf } from '../../utils/coins'
import { poll } from '../../services/pollScheduler'

const PAD = { l: 46, r: 66, t: 8, b: 22 }

export function LiqHeatmap() {
  const [symbol, setSymbol] = useState<string>(() => String(state.symbol || 'BTCUSDT'))
  const [range, setRange] = useState('24h')
  const [modelId, setModelId] = useState('m1')
  const [cmap, setCmap] = useState<ColormapId>('viridis')
  const [threshold, setThreshold] = useState(0.85)
  const [showCandles, setShowCandles] = useState(true)
  const [full, setFull] = useState(false)
  const [candles, setCandles] = useState<CandleFlat[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [err, setErr] = useState<string>()
  // Open interest is refreshed by the engine; re-read it whenever candles land.
  const [oi, setOi] = useState<OiPoint[]>([])
  const [hover, setHover] = useState<{
    left: number
    top: number
    price: number
    value: number
    time: number
  } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const r = RANGES.find((x) => x.id === range) ?? RANGES[1]
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0]

  // The engine owns the selected symbol; poll it rather than reach into it.
  useEffect(() => {
    const id = setInterval(() => {
      const s = String(state.symbol || 'BTCUSDT')
      setSymbol((prev) => (prev === s ? prev : s))
    }, 1500)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let alive = true
    const load = () =>
      loadCandleWindow(symbol, r.tf, r.bars)
        .then((c) => {
          if (!alive) return
          setCandles(c)
          // oiHist belongs to whichever crypto symbol was last charted. Using
          // it here would scale gold's notional by Bitcoin's open interest.
          const raw = instrumentOf(symbol)
            ? null
            : (state.oiHist as Array<{ ts: number; openInterest: number }> | null)
          setOi(Array.isArray(raw) ? raw.map((x) => ({ ts: x.ts, value: x.openInterest })) : [])
          setStatus('ok')
          setErr(undefined)
        })
        .catch((e) => {
          if (!alive) return
          setStatus('error')
          setErr(e instanceof Error ? e.message : String(e))
        })
    load()
    // Was a raw setInterval — kept firing this REST fetch every 60s even
    // with the tab backgrounded while this panel happened to be open.
    const stop = poll(load, 60000)
    return () => {
      alive = false
      stop()
    }
  }, [symbol, r.tf, r.bars])

  // Funding is the one public number that says which side is actually crowded,
  // so the model uses it instead of assuming a balanced book. It is re-read
  // when the candles refresh rather than on its own timer — the engine already
  // polls it every 30s, and a heatmap rebuilt on a funding tick alone would
  // redraw for a number that barely moves.
  const funding = useMemo(() => {
    const fr = state.fr as { lastFundingRate?: string | number } | null
    const v = fr?.lastFundingRate
    const n = v == null ? NaN : Number(v)
    return isFinite(n) ? n : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, symbol])

  const heat: Heatmap | null = useMemo(
    () => (candles.length ? buildHeatmap(candles, { bins: full ? 260 : 170, model, oi, funding }) : null),
    [candles, model, oi, full, funding],
  )

  // Escape leaves full screen, and the page behind must not scroll under it.
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setFull(false)
    }
    document.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [full])

  useEffect(() => {
    const cv = canvasRef.current
    const el = wrapRef.current
    if (!cv || !el) return
    const draw = () => {
      const W = el.clientWidth
      const H = el.clientHeight
      if (!W || !H) return
      const dpr = window.devicePixelRatio || 1
      cv.width = W * dpr
      cv.height = H * dpr
      cv.style.width = W + 'px'
      cv.style.height = H + 'px'
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const gw = W - PAD.l - PAD.r
      const gh = H - PAD.t - PAD.b
      ctx.fillStyle = '#0B1020'
      ctx.fillRect(0, 0, W, H)
      if (!heat || gw <= 0 || gh <= 0) return

      const map = COLORMAPS[cmap]
      const clip = clipLevel(heat, threshold)
      const colW = gw / heat.cols
      const [br, bgc, bb] = colorAt(map, 0)
      ctx.fillStyle = 'rgb(' + (br | 0) + ',' + (bgc | 0) + ',' + (bb | 0) + ')'
      ctx.fillRect(PAD.l, PAD.t, gw, gh)

      // Cells go through ImageData — a fill per cell would be far too slow.
      const iw = Math.max(1, Math.round(gw * dpr))
      const ih = Math.max(1, Math.round(gh * dpr))
      const img = ctx.createImageData(iw, ih)
      const d = img.data
      for (let px = 0; px < iw; px++) {
        const col = Math.min(heat.cols - 1, Math.floor((px / iw) * heat.cols))
        for (let py = 0; py < ih; py++) {
          const bin = heat.bins - 1 - Math.min(heat.bins - 1, Math.floor((py / ih) * heat.bins))
          const v = heat.grid[col * heat.bins + bin]
          const [cr, cg, cb] = colorAt(map, Math.min(1, v / clip))
          const o = (py * iw + px) * 4
          d[o] = cr
          d[o + 1] = cg
          d[o + 2] = cb
          d[o + 3] = 255
        }
      }
      const off = document.createElement('canvas')
      off.width = iw
      off.height = ih
      off.getContext('2d')?.putImageData(img, 0, 0)
      ctx.drawImage(off, PAD.l, PAD.t, gw, gh)

      const yOf = (p: number) =>
        PAD.t + gh - ((p - heat.priceMin) / (heat.priceMax - heat.priceMin)) * gh

      if (showCandles) {
        const cw = Math.max(1, colW * 0.6)
        heat.candles.forEach((k, i) => {
          const x = PAD.l + (i + 0.5) * colW
          const up = k.c >= k.o
          ctx.strokeStyle = ctx.fillStyle = up ? '#19c37d' : '#f0475f'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, yOf(k.h))
          ctx.lineTo(x, yOf(k.l))
          ctx.stroke()
          const y1 = yOf(Math.max(k.o, k.c))
          const y2 = yOf(Math.min(k.o, k.c))
          ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1))
        })
      }

      const last = heat.candles[heat.candles.length - 1].c
      const yl = yOf(last)
      ctx.strokeStyle = '#ffffff'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.l, yl)
      ctx.lineTo(PAD.l + gw, yl)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(PAD.l + gw, yl - 8, PAD.r - 4, 16)
      ctx.fillStyle = '#0B1020'
      ctx.font = '600 10px JetBrains Mono, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(
        last.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        PAD.l + gw + 4,
        yl + 4,
      )

      ctx.fillStyle = '#8FA0B5'
      ctx.font = '10px JetBrains Mono, monospace'
      for (let i = 0; i <= 8; i++) {
        const p = heat.priceMin + ((heat.priceMax - heat.priceMin) * i) / 8
        const y = yOf(p)
        if (Math.abs(y - yl) < 10) continue
        ctx.fillText(
          p.toLocaleString(undefined, { maximumFractionDigits: p > 100 ? 0 : 4 }),
          PAD.l + gw + 4,
          y + 3,
        )
      }

      ctx.textAlign = 'center'
      const step = Math.max(1, Math.floor(heat.cols / Math.max(3, Math.floor(gw / 92))))
      for (let i = 0; i < heat.cols; i += step) {
        const t = new Date(heat.times[i])
        const label =
          r.tf === '1h' || r.tf === '4h'
            ? t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
              ' ' +
              String(t.getHours()).padStart(2, '0') +
              ':00'
            : t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        ctx.fillText(label, PAD.l + (i + 0.5) * colW, H - 7)
      }

      const cbX = 9
      const cbW = 14
      for (let y = 0; y < gh; y++) {
        const [cr, cg, cb] = colorAt(map, 1 - y / gh)
        ctx.fillStyle = 'rgb(' + (cr | 0) + ',' + (cg | 0) + ',' + (cb | 0) + ')'
        ctx.fillRect(cbX, PAD.t + y, cbW, 1.5)
      }
      ctx.fillStyle = '#8FA0B5'
      ctx.textAlign = 'left'
      ctx.fillText(fmtUsd(clip), cbX + cbW + 3, PAD.t + 9)
      ctx.fillText('0', cbX + cbW + 3, PAD.t + gh - 2)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [heat, cmap, threshold, showCandles, r.tf, full])

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current
    if (!el || !heat) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const gw = rect.width - PAD.l - PAD.r
    const gh = rect.height - PAD.t - PAD.b
    if (x < PAD.l || x > PAD.l + gw || y < PAD.t || y > PAD.t + gh) return setHover(null)
    const col = Math.min(heat.cols - 1, Math.floor(((x - PAD.l) / gw) * heat.cols))
    const bin = heat.bins - 1 - Math.min(heat.bins - 1, Math.floor(((y - PAD.t) / gh) * heat.bins))
    setHover({
      left: Math.min(x + 12, rect.width - 200),
      top: Math.max(4, y - 52),
      price: heat.priceMin + (bin + 0.5) * heat.binSize,
      value: heat.grid[col * heat.bins + bin],
      time: heat.times[col],
    })
  }

  return (
    <div className={'card liqhm' + (full ? ' liqhm-full' : '')}>
      <div className="sec-head">
        <div className="sec-title">Liquidation Heatmap</div>
        <div className="liqhm-tools">
          <span className="badge b-cyan">{instrumentOf(symbol) ? symbol : baseOf(symbol) + '/USDT'}</span>
          <div className="liqhm-seg">
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={modelId === m.id ? 'on' : ''}
                title={m.description}
                onClick={() => setModelId(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Range">
            {RANGES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <div className="liqhm-cmaps">
            {(Object.keys(COLORMAPS) as ColormapId[]).map((k) => {
              const m = COLORMAPS[k]
              return (
                <button
                  key={k}
                  type="button"
                  className={'liqhm-cmap' + (cmap === k ? ' on' : '')}
                  title={k}
                  aria-label={'Colour map ' + k}
                  onClick={() => setCmap(k)}
                  style={{
                    background:
                      'linear-gradient(to top, rgb(' +
                      m[0].join(',') +
                      '), rgb(' +
                      m[Math.floor(m.length / 2)].join(',') +
                      '), rgb(' +
                      m[m.length - 1].join(',') +
                      '))',
                  }}
                />
              )
            })}
          </div>
          <label className="liqhm-thr">
            Threshold {threshold.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
          <label className="liqhm-chk">
            <input
              type="checkbox"
              checked={showCandles}
              onChange={(e) => setShowCandles(e.target.checked)}
            />
            Price
          </label>
          <button
            type="button"
            className="chart-tool-btn"
            title={full ? 'Exit full screen [Esc]' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            aria-pressed={full}
            onClick={() => setFull((f) => !f)}
          >
            {full ? '✕' : '⛶'}
          </button>
        </div>
      </div>

      <div
        className="liqhm-wrap"
        ref={wrapRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} />
        {status === 'loading' && !heat && (
          <div className="liqhm-msg">
            Loading {r.bars} × {r.tf} candles…
          </div>
        )}
        {status === 'error' && <div className="liqhm-msg err">Heatmap unavailable: {err}</div>}
        {hover && heat && (
          <div className="liqhm-tip" style={{ left: hover.left, top: hover.top }}>
            <b>{hover.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b>
            <span>{new Date(hover.time).toLocaleString()}</span>
            <span>
              Liquidity est. <b>${fmtUsd(hover.value)}</b>
            </span>
          </div>
        )}
      </div>

      {heat && heat.levels.length > 0 && (
        <div className="liqhm-levels">
          {heat.levels.slice(0, 6).map((l) => {
            const last = heat.candles[heat.candles.length - 1].c
            return (
              <span
                key={l.price}
                className={l.price > last ? 'up' : 'down'}
                title="Strongest current liquidity clusters"
              >
                {l.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <small>${fmtUsd(l.value)}</small>
              </span>
            )
          })}
        </div>
      )}

      <div className="disclaimer">
        Estimated from {r.tf} candles{oi.length ? ' + open-interest changes' : ''} using leverage
        tiers {model.tiers.map((t) => t.lev + 'x').join('/')} — {model.description}.{' '}
        {funding != null ? (
          <>
            Long/short split skewed by live funding ({(funding * 100).toFixed(4)}%) rather than
            assumed even.{' '}
          </>
        ) : (
          <>No funding published for this market, so the split is the model&rsquo;s own. </>
        )}
        Positions are spread across each bar&rsquo;s range, not pinned to its close; bands persist
        until price trades through them, and what sat inside a bar&rsquo;s body is cleared harder
        than what a wick merely grazed. This is a model, not exchange position data.
      </div>
    </div>
  )
}
