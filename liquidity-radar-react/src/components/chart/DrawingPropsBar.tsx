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
import { TF_GROUPS, toggleHidden } from '../../features/charts/drawings/visibility'
import { ICON_DEFAULT, ICON_SET } from '../../features/charts/drawings/shapesExtra'
import { ALERTABLE_DRAWINGS, openAlertForSelectedDrawing } from '../../features/alerts/drawingAlert'

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
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15ZM10 20.5a2 2 0 0 0 4 0',
  box: 'M3.5 6h17v12h-17ZM7.5 10h9M7.5 14h5',
  vis: 'M3 5h18M3 12h18M3 19h18M8 3v4M16 10v4M11 17v4',
}

/** "Visible on intervals": hide the drawing on whole groups of timeframes. */
function VisibilitySettings({ sel }: { sel: SelectedInfo }) {
  return (
    <div className="dp-pop r4dr-pop" role="group" aria-label="Visible on intervals">
      <p className="dp-pop-note">Visible on intervals</p>
      {TF_GROUPS.map((g) => (
        <label key={g.id} className="r4dr-check">
          <input
            type="checkbox"
            checked={!sel.hideOn.includes(g.id)}
            onChange={() => editSelectedDrawing({ hideOn: toggleHidden(sel, g.id) })}
          />
          <span>{g.label}</span>
        </label>
      ))}
    </div>
  )
}

/** Background and border of a text drawing's box. */
function TextBoxSettings({ sel }: { sel: SelectedInfo }) {
  return (
    <div className="dp-pop r4dr-pop" role="group" aria-label="Text box">
      <p className="dp-pop-note">Background</p>
      <div className="r4dr-swatches">
        <button
          type="button"
          className={'dp-swatch r4dr-none' + (!sel.bg ? ' on' : '')}
          aria-label="Default background"
          title="Default"
          onClick={() => editSelectedDrawing({ bg: undefined })}
        />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={'dp-swatch' + (sel.bg === c + '40' ? ' on' : '')}
            aria-label={'Background ' + c}
            style={{ background: c + '40' }}
            onClick={() => editSelectedDrawing({ bg: c + '40' })}
          />
        ))}
      </div>
      <p className="dp-pop-note">Border</p>
      <div className="r4dr-swatches">
        <button
          type="button"
          className={'dp-swatch r4dr-none' + (sel.border === 'none' ? ' on' : '')}
          aria-label="No border"
          title="None"
          onClick={() => editSelectedDrawing({ border: 'none' })}
        />
        <button
          type="button"
          className={'dp-swatch' + (!sel.border ? ' on' : '')}
          aria-label="Border in the text colour"
          title="Text colour"
          style={{ background: sel.color }}
          onClick={() => editSelectedDrawing({ border: undefined })}
        />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={'dp-swatch' + (sel.border === c ? ' on' : '')}
            aria-label={'Border ' + c}
            style={{ boxShadow: 'inset 0 0 0 3px ' + c }}
            onClick={() => editSelectedDrawing({ border: c })}
          />
        ))}
      </div>
    </div>
  )
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
  const [pop, setPop] = useState<null | 'position' | 'vis' | 'box'>(null)
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
  const isIcon = sel.type === 'icon'
  const canAlert = ALERTABLE_DRAWINGS.includes(sel.type)
  const togglePop = (p: 'position' | 'vis' | 'box') => setPop((cur) => (cur === p ? null : p))
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
            <button
              type="button"
              className={'dp-btn' + (pop === 'box' ? ' on' : '')}
              aria-label="Text background and border"
              aria-expanded={pop === 'box'}
              title="Background and border"
              onClick={() => togglePop('box')}
            >
              <Glyph d={G.box} />
            </button>
          </>
        )}
        {isIcon && (
          <>
            <span className="dp-sep" aria-hidden="true" />
            <div className="dp-group r4dr-icons" role="radiogroup" aria-label="Icon">
              {ICON_SET.map((ic) => {
                const on = (sel.text || ICON_DEFAULT) === ic
                return (
                  <button
                    key={ic}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={'Icon ' + ic}
                    className={'dp-btn' + (on ? ' on' : '')}
                    onClick={() => editSelectedDrawing({ text: ic })}
                  >
                    {ic}
                  </button>
                )
              })}
            </div>
            <select
              className="dp-select"
              aria-label="Icon size"
              value={sel.fontSize}
              onChange={(e) => editSelectedDrawing({ fontSize: Number(e.target.value) })}
            >
              {FONT_SIZES.map((f) => (
                <option key={f} value={f}>
                  {Math.max(16, f * 2)}px
                </option>
              ))}
            </select>
          </>
        )}
        {canAlert && (
          <>
            <span className="dp-sep" aria-hidden="true" />
            <button
              type="button"
              className="dp-btn"
              aria-label="Add alert on this drawing"
              title="Add alert"
              onClick={openAlertForSelectedDrawing}
            >
              <Glyph d={G.bell} />
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
              onClick={() => togglePop('position')}
            >
              <Glyph d={G.calc} />
            </button>
          </>
        )}
        <span className="dp-sep" aria-hidden="true" />
        <button
          type="button"
          className={'dp-btn' + (pop === 'vis' || sel.hideOn.length ? ' on' : '')}
          aria-label="Visible on intervals"
          aria-expanded={pop === 'vis'}
          title={sel.hideOn.length ? 'Hidden on some intervals' : 'Visible on intervals'}
          onClick={() => togglePop('vis')}
        >
          <Glyph d={G.vis} />
        </button>
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
      {pop === 'vis' && <VisibilitySettings sel={sel} />}
      {pop === 'box' && isText && <TextBoxSettings sel={sel} />}
    </div>
  )
}
