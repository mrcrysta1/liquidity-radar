// Indicator dropdown for the price-action chart: everything active on the left
// with its settings, the full catalogue on the right to add from — and a Pine
// tab with the script editor and "My scripts" (see PinePanel).
//
// It works against one chart's store: the main chart's by default, or a
// multi-chart panel's (variant 'panel': a small header button whose menu
// floats over the page, since panel cells clip their contents).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  INDICATORS,
  INDICATOR_GROUPS,
  SOURCES,
  indicatorDef,
  instanceLabel,
} from '../../features/charts/indicators/registry'
import { instanceDef, mainIndicatorStore } from '../../features/charts/indicators/store'
import type { IndicatorInstance, IndicatorStore } from '../../features/charts/indicators/store'
import { PINE_TYPE, pineStatus, subscribePine } from '../../features/charts/pine/indicator'
import type { PineInput } from '../../features/charts/pine/runtime'
import { editPineInstance } from '../../features/charts/pine/draft'
import { PinePanel } from './PinePanel'

/** One Pine input, in the same settings grid as a built-in's params. */
function PineInputField({
  store,
  inst,
  input,
}: {
  store: IndicatorStore
  inst: IndicatorInstance
  input: PineInput
}) {
  const cur = inst.pineInputs?.[input.key] ?? input.def
  const set = (v: number | boolean | string) => store.setPineInput(inst.uid, input.key, v)
  let field: React.ReactNode
  if (input.type === 'bool')
    field = <input type="checkbox" checked={!!cur} onChange={(e) => set(e.target.checked)} />
  else if (input.type === 'source')
    field = (
      <select value={String(cur)} onChange={(e) => set(e.target.value)}>
        {SOURCES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    )
  else if (input.options)
    field = (
      <select value={String(cur)} onChange={(e) => set(e.target.value)}>
        {input.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  else if (input.type === 'string' || input.type === 'color')
    field = (
      <input
        type={input.type === 'color' && /^#[0-9a-f]{6}$/i.test(String(cur)) ? 'color' : 'text'}
        value={String(cur)}
        maxLength={200}
        onChange={(e) => set(e.target.value)}
      />
    )
  else
    field = (
      <input
        type="number"
        min={input.min}
        max={input.max}
        step={input.step ?? (input.type === 'int' ? 1 : 'any')}
        value={Number(cur)}
        onChange={(e) => {
          let v = Number(e.target.value)
          if (e.target.value === '' || !isFinite(v)) return
          if (input.type === 'int') v = Math.round(v)
          if (input.min != null) v = Math.max(input.min, v)
          if (input.max != null) v = Math.min(input.max, v)
          set(v)
        }}
      />
    )
  return (
    <label className={input.type === 'bool' ? 'pine-check' : undefined}>
      <span title={input.title}>{input.title}</span>
      {field}
    </label>
  )
}

function Eye({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      {!on && <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}
    </svg>
  )
}

interface PickerProps {
  /** The chart's indicator set; the main chart's by default. */
  store?: IndicatorStore
  /** 'rail' is the main chart's side-rail button; 'panel' a panel header's. */
  variant?: 'rail' | 'panel'
  /** Names the chart in the button's label (panel variant). */
  chartLabel?: string
}

export function IndicatorPicker({
  store = mainIndicatorStore,
  variant = 'rail',
  chartLabel,
}: PickerProps = {}) {
  const {
    addIndicator,
    getIndicators,
    indicatorCount,
    maxIndicators,
    removeIndicator,
    resetIndicators,
    resetPineInputs,
    setParam,
    setSource,
    sourceOptions,
    toggleIndicator,
  } = store
  const panel = variant === 'panel'
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'catalog' | 'pine'>('catalog')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
  useEffect(() => subscribePine(() => force((n) => n + 1)), [])

  // A panel's menu floats (position: fixed) under its button, kept on screen.
  useLayoutEffect(() => {
    if (!open || !panel) return
    const place = (e?: Event) => {
      // Scrolling the menu's own lists does not move its anchor.
      if (e && menuRef.current?.contains(e.target as Node)) return
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r) return
      const w = Math.min(560, window.innerWidth - 16)
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))
      const top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 200))
      setPos({ left, top, width: w, maxHeight: Math.max(200, window.innerHeight - top - 12) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, panel])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase, so the engine's global Escape (which exits full screen)
      // does not also fire: closing the menu is the whole gesture here.
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onEsc, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onEsc, true)
    }
  }, [open])

  const items = getIndicators()
  const full = indicatorCount() >= maxIndicators()
  const q = query.trim().toLowerCase()
  const matches = (n: string) => !q || n.toLowerCase().includes(q)

  // The engine's global key handler owns Escape and the letter shortcuts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      return
    }
    e.stopPropagation()
  }

  const menu = open ? (
    <div
      ref={menuRef}
      className={'ind-menu' + (tab === 'pine' ? ' pine-on' : '') + (panel ? ' ind-menu-float' : '')}
      style={panel ? pos || { visibility: 'hidden' } : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="ind-menu-head">
        <div className="ind-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'catalog'}
            className={tab === 'catalog' ? 'on' : ''}
            onClick={() => setTab('catalog')}
          >
            Indicators
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pine'}
            className={tab === 'pine' ? 'on' : ''}
            onClick={() => setTab('pine')}
          >
            Pine scripts
          </button>
        </div>
        {tab === 'catalog' && (
          <button type="button" className="ind-reset" onClick={resetIndicators}>
            Reset
          </button>
        )}
      </div>

      {tab === 'pine' && <PinePanel store={store} />}
      {tab === 'catalog' && (
        <div className="ind-cols">
          <div className="ind-active">
            <div className="ind-col-lbl">
              On chart <span>{items.length}</span>
            </div>
            {!items.length && <div className="ind-empty">Nothing added yet.</div>}
            {items.map((inst) => {
              const def = instanceDef(inst)
              if (!def) return null
              const isEditing = editing === inst.uid
              const pine = inst.type === PINE_TYPE ? pineStatus(inst) : null
              const canEdit = def.params.length > 0 || def.sourced || !!pine
              return (
                <div className={'ind-item' + (inst.visible ? '' : ' off')} key={inst.uid}>
                  <div className="ind-item-row">
                    <span className="ind-dot" style={{ background: def.outputs[0]?.color }} />
                    <span className="ind-item-name">{instanceLabel(def, inst.params)}</span>
                    {pine && (
                      <span
                        className={'pine-tag' + (pine.error ? ' err' : '')}
                        title={pine.error || 'Pine script'}
                      >
                        {pine.error ? 'error' : 'pine'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="ind-icon"
                      aria-pressed={inst.visible}
                      title={inst.visible ? 'Hide' : 'Show'}
                      onClick={() => toggleIndicator(inst.uid)}
                    >
                      <Eye on={inst.visible} />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className={'ind-icon' + (isEditing ? ' active' : '')}
                        aria-expanded={isEditing}
                        title="Settings"
                        onClick={() => setEditing(isEditing ? null : inst.uid)}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                          <circle
                            cx="12"
                            cy="12"
                            r="3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <path
                            d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      className="ind-icon danger"
                      title="Remove"
                      onClick={() => removeIndicator(inst.uid)}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                        <path
                          d="M6 6 18 18M18 6 6 18"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                  {isEditing && pine && (
                    <div className="ind-settings">
                      {pine.error && <div className="pine-msg err pine-span">{pine.error}</div>}
                      {pine.inputs.map((input) => (
                        <PineInputField key={input.key} store={store} inst={inst} input={input} />
                      ))}
                      {!pine.inputs.length && !pine.error && (
                        <div className="ind-empty pine-span">This script has no inputs.</div>
                      )}
                      {pine.warnings.length > 0 && (
                        <div className="ind-empty pine-span">
                          Ignored: {pine.warnings.join(', ')}
                        </div>
                      )}
                      <div className="pine-span pine-row">
                        <button
                          type="button"
                          className="pine-btn sm"
                          onClick={() => {
                            editPineInstance(inst.uid, getIndicators())
                            setTab('pine')
                          }}
                        >
                          Edit source
                        </button>
                        {pine.inputs.length > 0 && (
                          <button
                            type="button"
                            className="pine-btn sm"
                            onClick={() => resetPineInputs(inst.uid)}
                          >
                            Defaults
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {isEditing && !pine && (
                    <div className="ind-settings">
                      {def.params.map((p) => (
                        <label key={p.key}>
                          <span>{p.label}</span>
                          <input
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            value={inst.params[p.key]}
                            onChange={(e) => setParam(inst.uid, p.key, Number(e.target.value))}
                          />
                        </label>
                      ))}
                      {def.sourced && (
                        <label>
                          <span>Source</span>
                          <select
                            value={inst.source}
                            onChange={(e) => setSource(inst.uid, e.target.value)}
                          >
                            {/* Price fields, then other indicators' outputs
                                  (indicator-on-indicator); options that would
                                  loop back to this one are left out. */}
                            {sourceOptions(inst.uid).map((s, i) => (
                              <option key={s.key} value={s.key}>
                                {i >= SOURCES.length ? '↳ ' + s.label : s.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {full && <div className="ind-empty">Limit of {maxIndicators()} reached.</div>}
          </div>

          <div className="ind-catalog">
            <input
              className="ind-search"
              type="text"
              placeholder="Search indicators…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search indicators"
            />
            <div className="ind-list">
              {INDICATOR_GROUPS.map((group) => {
                const list = INDICATORS.filter((d) => d.group === group && matches(d.name))
                if (!list.length) return null
                return (
                  <div key={group}>
                    <div className="ind-group-lbl">{group}</div>
                    {list.map((d) => (
                      <button
                        type="button"
                        className="ind-add"
                        key={d.id}
                        disabled={full}
                        title={full ? 'Limit reached' : 'Add ' + d.name}
                        onClick={() => addIndicator(d.id)}
                      >
                        <span className="ind-dot" style={{ background: d.outputs[0]?.color }} />
                        <span className="ind-add-name">{d.name}</span>
                        <span className="ind-add-kind">
                          {d.placement === 'pane' ? 'pane' : 'overlay'}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  ) : null

  return (
    <div className={'ind-picker' + (panel ? ' ind-picker-panel' : '')} ref={wrapRef}>
      {panel ? (
        <button
          type="button"
          className={'rc-ind-btn' + (open ? ' on' : '')}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            'Indicators' + (chartLabel ? ' for ' + chartLabel : '') + ' (' + items.length + ')'
          }
          title="Indicators"
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M3 17.5 9 11l4 4 8-9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {items.length > 0 && <span className="rc-ind-count">{items.length}</span>}
        </button>
      ) : (
        <>
          <button
            type="button"
            className={'cs-rail-btn ind-open' + (open ? ' on' : '')}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={'Indicators (' + items.length + ')'}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path
                d="M3 17.5 9 11l4 4 8-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {items.length > 0 && <span className="rail-count">{items.length}</span>}
            <span className="cs-rail-tip">Indicators</span>
          </button>
        </>
      )}
      {panel ? menu && createPortal(menu, document.body) : menu}
    </div>
  )
}
