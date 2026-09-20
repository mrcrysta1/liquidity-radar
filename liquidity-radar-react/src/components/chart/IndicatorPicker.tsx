// Indicator dropdown for the price-action chart: everything active on the left
// with its settings, the full catalogue on the right to add from.
import { useEffect, useRef, useState } from 'react'
import {
  INDICATORS,
  INDICATOR_GROUPS,
  SOURCES,
  indicatorDef,
  instanceLabel,
} from '../../features/charts/indicators/registry'
import type { SourceKey } from '../../features/charts/indicators/registry'
import {
  addIndicator,
  getIndicators,
  indicatorCount,
  maxIndicators,
  removeIndicator,
  resetIndicators,
  setParam,
  setSource,
  subscribeIndicators,
  toggleIndicator,
} from '../../features/charts/indicators/store'

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

export function IndicatorPicker() {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeIndicators(() => force((n) => n + 1)), [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
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

  return (
    <div className="ind-picker" ref={wrapRef}>
      <button
        type="button"
        className={'tv-chip ind-open' + (open ? ' on' : '')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <path
            d="M3 17.5 9 11l4 4 8-9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Indicators
        <span className="ind-count">{items.length}</span>
      </button>

      {open && (
        <div className="ind-menu" onKeyDown={onKeyDown}>
          <div className="ind-menu-head">
            <span>Indicators</span>
            <button type="button" className="ind-reset" onClick={resetIndicators}>
              Reset
            </button>
          </div>

          <div className="ind-cols">
            <div className="ind-active">
              <div className="ind-col-lbl">
                On chart <span>{items.length}</span>
              </div>
              {!items.length && <div className="ind-empty">Nothing added yet.</div>}
              {items.map((inst) => {
                const def = indicatorDef(inst.type)
                if (!def) return null
                const isEditing = editing === inst.uid
                const canEdit = def.params.length > 0 || def.sourced
                return (
                  <div className={'ind-item' + (inst.visible ? '' : ' off')} key={inst.uid}>
                    <div className="ind-item-row">
                      <span className="ind-dot" style={{ background: def.outputs[0]?.color }} />
                      <span className="ind-item-name">{instanceLabel(def, inst.params)}</span>
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
                    {isEditing && (
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
                              onChange={(e) => setSource(inst.uid, e.target.value as SourceKey)}
                            >
                              {SOURCES.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
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
        </div>
      )}
    </div>
  )
}
