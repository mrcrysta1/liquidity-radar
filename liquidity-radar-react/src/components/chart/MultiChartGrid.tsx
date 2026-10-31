// The multi-chart workspace grid (Charts tab): one cell per panel, with its
// header (icon, coin picker, price readout, indicators slot, interval and
// remove), and the "+ Add Chart" tile.
//
// The panels themselves live in features/charts/multiCharts: this renders its
// snapshot and hands each cell's chart body element over (mcAttachBody /
// mcDetachBody), and the module builds and disposes the LightweightCharts
// instance in it. Cells are keyed by panel id, so adding, removing or
// re-pointing one panel leaves every other panel's chart alone.
//
// The price line (#mcPx<id>), RSI value (#mcRsiV<id>) and crosshair legend
// (#mcLeg<id>) are written by multiCharts on every tick, so React renders
// them empty and never touches their contents. The indicators button is
// portalled into `.mc-ind[data-ind-slot]` by PanelIndicatorButtons.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { CoinPicker } from './CoinPicker'
import { LinkChip } from './LinkChip'
import { state } from '../../services/store'
import { baseOf, coinMeta } from '../../utils/coins'
import {
  MC_INTERVALS,
  mcAdd,
  mcAttachBody,
  mcChangeInterval,
  mcChangeSymbol,
  mcDetachBody,
  mcGridRendered,
  mcRemove,
  mcSnapshot,
  onMcChange,
} from '../../features/charts/multiCharts'
import type { McPanelView } from '../../features/charts/multiCharts'

function PanelIcon({ sym }: { sym: string }) {
  const meta = coinMeta(sym)
  const img = (state.marketCaps as Record<string, { image?: string }> | undefined)?.[baseOf(sym)]?.image
  return (
    <i
      className="tk-ico"
      style={{ borderColor: meta.color + '66', background: meta.color + '1f', color: meta.color }}
    >
      {img && /^https:\/\//.test(img) ? <img src={img} alt="" loading="lazy" /> : meta.icon}
    </i>
  )
}

function McCell({ panel, slot }: { panel: McPanelView; slot: number }) {
  const { id, sym, interval } = panel
  const bodyRef = useRef<HTMLDivElement>(null)
  // The chart lives as long as this cell: built when it mounts, disposed when
  // it unmounts. A new symbol or interval is handled by multiCharts itself.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    mcAttachBody(id, el)
    return () => mcDetachBody(id, el)
  }, [id])
  return (
    <div className="multi-chart-cell" data-mc-id={id}>
      <div className="mc-head">
        <span className="mc-id">
          <PanelIcon sym={sym} />
          <span>
            {/* Panels read Binance pairs only (fetchKlineRows + the kline hub). */}
            <span className="mc-sym" data-mc-sym={id}>
              <CoinPicker
                value={sym}
                compact
                float
                cryptoOnly
                label="Chart symbol"
                onPick={(s) => mcChangeSymbol(id, s)}
              />
            </span>
            <small className="mc-px" id={'mcPx' + id} />
          </span>
        </span>
        <div className="mc-controls">
          {/* Its link group: panels in one group follow each other. */}
          <LinkChip linkKey={'mc' + slot} />
          <span
            className="mc-ind"
            data-ind-slot={'mc' + slot}
            data-ind-label={baseOf(sym) + '/USDT ' + interval}
          />
          <select
            aria-label="Interval"
            value={interval}
            onChange={(e) => mcChangeInterval(id, e.target.value)}
          >
            {MC_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
          <button
            className="mc-x"
            onClick={() => mcRemove(id)}
            title="Remove chart"
            aria-label="Remove chart"
          >
            <svg width="12" height="12" viewBox="0 0 24 24">
              <path
                d="M6 6l12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="mc-body" id={'mcBody' + id} ref={bodyRef}>
        <div className="mc-legend" id={'mcLeg' + id} />
        <span className="mc-rsi-tag">
          RSI <b id={'mcRsiV' + id} />
        </span>
      </div>
    </div>
  )
}

/**
 * A new cell starts on the coin and interval being charted (the interval
 * mapped onto the grid's six; 1h when it has no match) — it always added
 * BTCUSDT 1h.
 */
function addCurrent(): void {
  // Exact ids only: lower-casing would turn the month (1M) into a minute.
  const tf = String(state.tf || '')
  const interval = (MC_INTERVALS as readonly string[]).includes(tf) ? tf : '1h'
  mcAdd(state.symbol || 'BTCUSDT', interval)
}

function AddTile() {
  return (
    <div className="mc-add">
      <button className="mc-add-btn" onClick={addCurrent} aria-label="Add chart">
        <svg width="30" height="30" viewBox="0 0 24 24">
          <path
            d="M12 5v14M5 12h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <b>+ Add Chart</b>
      <small>Add more assets, compare or build a new workspace.</small>
      <span className="mc-add-sym">
        <CoinPicker
          compact
          float
          cryptoOnly
          label="Choose symbol"
          trigger={
            <span className="cp-id">
              <b>Choose Symbol</b>
            </span>
          }
          onPick={(s) => mcAdd(s, '1h')}
        />
      </span>
    </div>
  )
}

export function MultiChartGrid() {
  const snap = useSyncExternalStore(onMcChange, mcSnapshot)
  // Tell DOM readers (the panel indicator buttons) the grid is in place.
  useEffect(() => {
    mcGridRendered()
  }, [snap])
  return (
    <div className="multi-chart-grid" id="mcGrid" data-cols={snap.cols}>
      {snap.ready && (
        <>
          {snap.panels.map((p, i) => (
            <McCell key={p.id} panel={p} slot={i} />
          ))}
          {snap.canAdd && <AddTile />}
        </>
      )}
    </div>
  )
}
