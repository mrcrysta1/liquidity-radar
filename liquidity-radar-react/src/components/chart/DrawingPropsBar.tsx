// The floating toolbar over a selected drawing, as on TradingView: colour,
// line width, line style, text size, lock / hide / clone / stacking order,
// "save as default" for its tool, the position calculator settings and
// delete. Drawings had a fixed colour per tool and nothing could be changed
// after placing them.
import { useEffect, useRef, useState } from 'react'
import {
  deleteSelectedDrawing,
  drawToolDef,
  drawingCommand,
  editSelectedDrawing,
  resetToolTemplate,
  saveToolTemplate,
  selectedDrawing,
  subscribeDrawTools,
  toolTemplate,
} from '../../features/charts/drawTools'
import type { DrawDash, SelectedInfo } from '../../features/charts/drawTools'
import { POS_ACCOUNT_DEFAULT, POS_RISK_DEFAULT } from '../../features/charts/drawings/ops'

const COLORS = ['#2962FF', '#4FC3F7', '#00E676', '#FFD54F', '#FF9800', '#FF1744', '#E040FB', '#B2B5BE']
const WIDTHS = [1, 2, 3, 4]
const FONT_SIZES = [10, 12, 14, 18, 24]
const DASHES: Array<{ id: DrawDash; label: string; d: string }> = [
  { id: 'solid', label: 'Solid line', d: 'M3 12h18' },
  { id: 'dashed', label: 'Dashed line', d: 'M3 12h5M11 12h5M19 12h2' },
  { id: 'dotted', label: 'Dotted line', d: 'M3 12h1M8 12h1M13 12h1M18 12h1' },
]

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

const G = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13Z',
  unlock: 'M7 11V8a5 5 0 0 1 9.6-2M5.5 11h13v9h-13Z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  eyeOff: 'M4 4l16 16M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.3M6.4 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9',
  clone: 'M8.5 8.5h11v11h-11ZM15.5 8.5v-4h-11v11h4',
  front: 'M12 19V7M7 12l5-5 5 5M5 4h14',
  back: 'M12 5v12M7 12l5 5 5-5M5 20h14',
  text: 'M5 6h14M12 6v13',
  star: 'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z',
  calc: 'M6 3.5h12v17H6ZM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14.5h.01M12 14.5h.01M15 14.5h.01M9 18h.01M12 18h3',
  del: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
}

function Glyph({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        d={d}
        fill={fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Account size and risk % of a long / short position, as on TradingView. */
function PositionSettings({ sel, onClose }: { sel: SelectedInfo; onClose: () => void }) {
  const [account, setAccount] = useState(String(sel.account ?? POS_ACCOUNT_DEFAULT))
  const [risk, setRisk] = useState(String(sel.risk ?? POS_RISK_DEFAULT))
  const apply = () => {
    const a = parseFloat(account)
    const r = parseFloat(risk)
    editSelectedDrawing({
      account: Number.isFinite(a) && a > 0 ? a : POS_ACCOUNT_DEFAULT,
      // Risking more than the whole account is never meant.
      risk: Number.isFinite(r) && r > 0 ? Math.min(100, r) : POS_RISK_DEFAULT,
    })
    onClose()
  }
  return (
    <form
      className="dp-pop"
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
    >
      <label>
        <span>Account size</span>
        <input inputMode="decimal" value={account} onChange={(e) => setAccount(e.target.value)} autoFocus />
      </label>
      <label>
        <span>Risk %</span>
        <input inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} />
      </label>
      <p className="dp-pop-note">Quantity is sized so the stop loses exactly this share of the account.</p>
      <div className="dp-pop-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Apply
        </button>
      </div>
    </form>
  )
}

export function DrawingPropsBar() {
  const [, force] = useState(0)
  const [pop, setPop] = useState<null | 'position'>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => subscribeDrawTools(() => force((n) => n + 1)), [])
  const sel = selectedDrawing()
  useEffect(() => {
    if (!pop) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPop(null)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [pop])
  if (!sel) return null
  const def = drawToolDef(sel.type)
  const isText = !!def?.text
  const isPosition = sel.type === 'long' || sel.type === 'short'
  const template = toolTemplate(sel.type)
  return (
    <div className="dp-wrap" ref={rootRef}>
      <div className="dp-bar" role="toolbar" aria-label="Drawing properties">
        <div className="dp-colors" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={sel.color.toLowerCase() === c.toLowerCase()}
              aria-label={'Colour ' + c}
              className={'dp-swatch' + (sel.color.toLowerCase() === c.toLowerCase() ? ' on' : '')}
              style={{ background: c }}
              onClick={() => editSelectedDrawing({ color: c })}
            />
          ))}
        </div>
        <span className="dp-sep" aria-hidden="true" />
        <div className="dp-group" role="radiogroup" aria-label="Line width">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={Math.round(sel.width) === w}
              aria-label={w + 'px line'}
              className={'dp-btn' + (Math.round(sel.width) === w ? ' on' : '')}
              onClick={() => editSelectedDrawing({ width: w })}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M4 12h16" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
              </svg>
            </button>
          ))}
        </div>
        <span className="dp-sep" aria-hidden="true" />
        <div className="dp-group" role="radiogroup" aria-label="Line style">
          {DASHES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={sel.dash === s.id}
              aria-label={s.label}
              className={'dp-btn' + (sel.dash === s.id ? ' on' : '')}
              onClick={() => editSelectedDrawing({ dash: s.id })}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d={s.d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          ))}
        </div>
        {isText && (
          <>
            <span className="dp-sep" aria-hidden="true" />
            <select
              className="dp-select"
              aria-label="Font size"
              value={sel.fontSize}
              onChange={(e) => editSelectedDrawing({ fontSize: Number(e.target.value) })}
            >
              {FONT_SIZES.map((f) => (
                <option key={f} value={f}>
                  {f}px
                </option>
              ))}
            </select>
            <button
              type="button"
              className="dp-btn"
              aria-label="Edit text"
              title="Edit text (or double-click it)"
              disabled={sel.locked}
              onClick={() => drawingCommand({ kind: 'editText' })}
            >
              <Glyph d={G.text} />
            </button>
          </>
        )}
        {isPosition && (
          <>
            <span className="dp-sep" aria-hidden="true" />
            <button
              type="button"
              className={'dp-btn' + (pop === 'position' ? ' on' : '')}
              aria-label="Position settings"
              aria-expanded={pop === 'position'}
              title="Account size and risk"
              onClick={() => setPop((p) => (p === 'position' ? null : 'position'))}
            >
              <Glyph d={G.calc} />
            </button>
          </>
        )}
        <span className="dp-sep" aria-hidden="true" />
        <button
          type="button"
          className={'dp-btn' + (sel.locked ? ' on' : '')}
          aria-pressed={sel.locked}
          aria-label={sel.locked ? 'Unlock drawing' : 'Lock drawing'}
          title={sel.locked ? 'Unlock' : 'Lock (no moving or erasing)'}
          onClick={() => drawingCommand({ kind: 'toggle', flag: 'locked' })}
        >
          <Glyph d={sel.locked ? G.lock : G.unlock} />
        </button>
        <button
          type="button"
          className="dp-btn"
          aria-label="Hide drawing"
          title="Hide (show again from the Objects panel)"
          onClick={() => drawingCommand({ kind: 'toggle', flag: 'hidden' })}
        >
          <Glyph d={G.eyeOff} />
        </button>
        <button
          type="button"
          className="dp-btn"
          aria-label="Clone drawing"
          title={'Clone (' + MOD + 'D)'}
          onClick={() => drawingCommand({ kind: 'clone' })}
        >
          <Glyph d={G.clone} />
        </button>
        <button
          type="button"
          className="dp-btn"
          aria-label="Bring to front"
          title="Bring to front"
          onClick={() => drawingCommand({ kind: 'order', to: 'front' })}
        >
          <Glyph d={G.front} />
        </button>
        <button
          type="button"
          className="dp-btn"
          aria-label="Send to back"
          title="Send to back"
          onClick={() => drawingCommand({ kind: 'order', to: 'back' })}
        >
          <Glyph d={G.back} />
        </button>
        <button
          type="button"
          className={'dp-btn' + (template ? ' on' : '')}
          aria-pressed={!!template}
          aria-label={template ? 'Reset default style for this tool' : 'Save style as default for this tool'}
          title={
            template
              ? 'New ' + (def?.name || 'drawings') + ' use this style — click to reset'
              : 'Save as default for ' + (def?.name || 'this tool')
          }
          onClick={() => {
            if (template) resetToolTemplate(sel.type)
            else
              saveToolTemplate(sel.type, {
                color: sel.color,
                width: sel.width,
                dash: sel.dash,
                fontSize: isText ? sel.fontSize : undefined,
              })
          }}
        >
          <Glyph d={G.star} fill={!!template} />
        </button>
        <span className="dp-sep" aria-hidden="true" />
        <button type="button" className="dp-btn dp-del" aria-label="Delete drawing" onClick={deleteSelectedDrawing}>
          <Glyph d={G.del} />
        </button>
      </div>
      {pop === 'position' && isPosition && <PositionSettings sel={sel} onClose={() => setPop(null)} />}
    </div>
  )
}
