// Indicator dropdown for the price-action chart: everything active on the left
// with its settings, the full catalogue on the right to add from — and a Pine
// tab with the script editor and "My scripts" (see PinePanel).
//
// It works against one chart's store: the main chart's by default, or a
// multi-chart panel's (variant 'panel': a small header button whose menu
// floats over the page, since panel cells clip their contents).
//
// An instance's settings have TradingView's three tabs: Inputs (params,
// source), Style (per-output colour / width / line style / visibility,
// precision, levels) and Visibility (interval groups). Templates save and
// re-apply a whole set; the star on a catalogue row makes it a favourite.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  INDICATORS,
  INDICATOR_GROUPS,
  SOURCES,
  indicatorDef,
  instanceLabel,
  takesMtf,
} from '../../features/charts/indicators/registry'
import { MTF_OPTIONS } from '../../features/charts/indicators/mtf'
import type { IndicatorDef } from '../../features/charts/indicators/registry'
import { TF_GROUPS, instanceDef, mainIndicatorStore } from '../../features/charts/indicators/store'
import type {
  IndicatorInstance,
  IndicatorStore,
  LineStyleName,
} from '../../features/charts/indicators/store'
import { outputLook } from '../../features/charts/indicators/render'
import {
  applyTemplate,
  cleanTemplateName,
  deleteTemplate,
  favourites,
  listTemplates,
  saveTemplate,
  subscribeTemplates,
  toggleFavourite,
} from '../../features/charts/indicators/templates'
import { PINE_TYPE, pineStatus, subscribePine } from '../../features/charts/pine/indicator'
import type { PineInput } from '../../features/charts/pine/runtime'
import { editPineInstance } from '../../features/charts/pine/draft'
import { useFitMenu } from './useFitMenu'
// The Pine editor and its example scripts load on first open of the Pine tab,
// not with the first screen.
const PinePanel = lazy(() => import('./PinePanel').then((m) => ({ default: m.PinePanel })))

/**
 * A number setting that can be retyped. Clamping on every keystroke snapped a
 * cleared field straight back to the minimum, so selecting "14" and typing
 * "21" gave "121". The text is kept as typed; a value in range applies at
 * once, anything else is clamped (or restored) when the field loses focus.
 */
function NumberField({
  value,
  min,
  max,
  step,
  int,
  onCommit,
}: {
  value: number
  min?: number
  max?: number
  step?: number | 'any'
  int?: boolean
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (v: number) => {
    if (int) v = Math.round(v)
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    return v
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? String(value)}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        const v = Number(text)
        if (text !== '' && isFinite(v) && clamp(v) === v) onCommit(v)
      }}
      onBlur={() => {
        if (draft == null) return
        const v = Number(draft)
        if (draft !== '' && isFinite(v) && clamp(v) !== value) onCommit(clamp(v))
        setDraft(null)
      }}
    />
  )
}

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
      <NumberField
        min={input.min}
        max={input.max}
        step={input.step ?? (input.type === 'int' ? 1 : 'any')}
        int={input.type === 'int'}
        value={Number(cur)}
        onCommit={set}
      />
    )
  return (
    <label className={input.type === 'bool' ? 'pine-check' : undefined}>
      <span title={input.title}>{input.title}</span>
      {field}
    </label>
  )
}

/** `#rrggbb` for a colour input; rgba()/#rgb read, anything else grey. */
function toHex(c: string): string {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(c)
  if (h)
    return h[1].length === 3
      ? '#' + h[1].split('').map((x) => x + x).join('')
      : '#' + h[1].toLowerCase()
  const r = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c)
  if (!r) return '#888888'
  return (
    '#' +
    [r[1], r[2], r[3]]
      .map((x) => Math.round(Math.min(255, Number(x))).toString(16).padStart(2, '0'))
      .join('')
  )
}

/**
 * A picked colour, keeping the translucency the old one had: a band fill or a
 * faded basis line stays faded when only its hue is changed.
 */
function keepAlpha(hex: string, prev: string): string {
  const a = /rgba\([^)]*,\s*([\d.]+)\s*\)/i.exec(prev)
  if (!a || Number(a[1]) >= 1) return hex
  const n = parseInt(hex.slice(1), 16)
  return 'rgba(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',') + ',' + a[1] + ')'
}

/** Guide levels as a comma list; applied when the field loses focus. */
function LevelsField({ value, onCommit }: { value: number[]; onCommit: (v: number[]) => void }) {
  const text = value.join(', ')
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="text"
      value={draft ?? text}
      placeholder="none"
      aria-label="Levels"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft == null) return
        const next = draft
          .split(/[,;\s]+/)
          .filter(Boolean)
          .map(Number)
          .filter((x) => isFinite(x))
        if (next.join(', ') !== text) onCommit(next)
        setDraft(null)
      }}
    />
  )
}

const STYLE_NAMES: LineStyleName[] = ['solid', 'dashed', 'dotted']

/** The Style tab: how each output draws, the axis precision, guide levels. */
function StyleSettings({
  store,
  inst,
  def,
}: {
  store: IndicatorStore
  inst: IndicatorInstance
  def: IndicatorDef
}) {
  // Levels belong to a pane (on the price pane they would be prices).
  const hasLevels = def.placement === 'pane' || !!def.guides || !!def.hlines || !!inst.levels
  const levels = inst.levels ?? def.guides ?? (def.hlines || []).map((x) => x.price)
  return (
    <div className="ind-style pine-span">
      {def.outputs.map((o) => {
        const lk = outputLook(inst, o)
        const kind = o.kind || 'line'
        const lined = kind === 'line' || kind === 'step'
        const st = inst.styles?.[o.key]
        return (
          <div className="ind-style-row" key={o.key}>
            <input
              type="checkbox"
              checked={lk.visible}
              aria-label={'Show ' + o.label}
              onChange={(e) =>
                store.setStyle(inst.uid, o.key, { visible: e.target.checked ? undefined : false })
              }
            />
            <span className="ind-style-name" title={o.label}>
              {o.label}
            </span>
            <input
              type="color"
              value={toHex(lk.color)}
              aria-label={o.label + ' colour'}
              onChange={(e) =>
                store.setStyle(inst.uid, o.key, { color: keepAlpha(e.target.value, lk.color) })
              }
            />
            {lined ? (
              <>
                <select
                  value={lk.width}
                  aria-label={o.label + ' width'}
                  onChange={(e) => store.setStyle(inst.uid, o.key, { width: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4].map((w) => (
                    <option key={w} value={w}>
                      {w}px
                    </option>
                  ))}
                </select>
                <select
                  value={st?.style ?? (o.dashed ? 'dashed' : 'solid')}
                  aria-label={o.label + ' line style'}
                  onChange={(e) =>
                    store.setStyle(inst.uid, o.key, { style: e.target.value as LineStyleName })
                  }
                >
                  {STYLE_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <span className="ind-style-kind">{kind}</span>
            )}
          </div>
        )
      })}
      <div className="ind-style-opts">
        <label>
          <span>Precision</span>
          <select
            value={inst.precision ?? ''}
            onChange={(e) =>
              store.setPrecision(inst.uid, e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">Default</option>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {hasLevels && (
          <label>
            <span>Levels</span>
            <LevelsField value={levels} onCommit={(v) => store.setLevels(inst.uid, v)} />
          </label>
        )}
        <button type="button" className="pine-btn sm" onClick={() => store.resetLook(inst.uid)}>
          Defaults
        </button>
      </div>
    </div>
  )
}

/** The Visibility tab: which interval groups the indicator shows on. */
function VisibilitySettings({ store, inst }: { store: IndicatorStore; inst: IndicatorInstance }) {
  return (
    <div className="ind-vis pine-span">
      {TF_GROUPS.map((g) => (
        <label key={g.key} className="pine-check">
          <input
            type="checkbox"
            checked={inst.tfVisibility?.[g.key] !== false}
            onChange={(e) => store.setTfVisible(inst.uid, g.key, e.target.checked)}
          />
          <span>{g.label}</span>
        </label>
      ))}
    </div>
  )
}

/** Save the chart's set under a name, or apply / delete a saved one. */
function TemplateBar({ store, count }: { store: IndicatorStore; count: number }) {
  const [sel, setSel] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const list = listTemplates()
  const chosen = list.some((t) => t.name === sel) ? sel : ''
  const save = () => {
    const n = cleanTemplateName(name)
    if (!n) return
    if (saveTemplate(n, store.getIndicators())) {
      setSel(n)
      setName('')
      setMsg('Saved')
    } else setMsg('Template list is full')
  }
  return (
    <div className="ind-tpl">
      <div className="ind-tpl-row">
        <select
          value={chosen}
          aria-label="Indicator templates"
          onChange={(e) => {
            setSel(e.target.value)
            setMsg('')
          }}
        >
          <option value="">Templates ({list.length})</option>
          {list.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} · {t.items.length}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pine-btn sm"
          disabled={!chosen}
          title="Replace this chart's indicators with the template"
          onClick={() => {
            if (applyTemplate(store, chosen)) setMsg('Applied')
          }}
        >
          Apply
        </button>
        <button
          type="button"
          className="ind-icon danger"
          disabled={!chosen}
          title="Delete template"
          aria-label="Delete template"
          onClick={() => {
            deleteTemplate(chosen)
            setSel('')
            setMsg('')
          }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M6 6 18 18M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="ind-tpl-row">
        <input
          type="text"
          value={name}
          maxLength={60}
          placeholder="Save current set as…"
          aria-label="Template name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
        <button
          type="button"
          className="pine-btn sm"
          disabled={!count || !cleanTemplateName(name)}
          onClick={save}
        >
          Save
        </button>
      </div>
      {msg && <div className="ind-tpl-msg">{msg}</div>}
    </div>
  )
}

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        d="m12 3.2 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z"
        fill={on ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
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
  /** 'rail' is the main chart's toolbar button; 'panel' a panel header's. */
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
  const [settingsTab, setSettingsTab] = useState<'inputs' | 'style' | 'vis'>('inputs')
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store])
  useEffect(() => subscribePine(() => force((n) => n + 1)), [])
  useEffect(() => subscribeTemplates(() => force((n) => n + 1)), [])

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

  // The toolbar's menu opens left-aligned under its button, which ran past
  // the right edge at 1366px. A panel's menu places itself (above).
  useFitMenu(menuRef, open && !panel, [tab])

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
  const favs = favourites()

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

      {tab === 'pine' && (
        <Suspense fallback={null}>
          <PinePanel store={store} />
        </Suspense>
      )}
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
              // Every indicator has a Style and a Visibility tab.
              const canEdit = true
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
                        onClick={() => {
                          setEditing(isEditing ? null : inst.uid)
                          setSettingsTab('inputs')
                        }}
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
                    <div className="ind-set-tabs" role="tablist">
                      {(
                        [
                          ['inputs', 'Inputs'],
                          ['style', 'Style'],
                          ['vis', 'Visibility'],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          role="tab"
                          aria-selected={settingsTab === k}
                          className={settingsTab === k ? 'on' : ''}
                          onClick={() => setSettingsTab(k)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {isEditing && settingsTab === 'style' && (
                    <div className="ind-settings">
                      <StyleSettings store={store} inst={inst} def={def} />
                    </div>
                  )}
                  {isEditing && settingsTab === 'vis' && (
                    <div className="ind-settings">
                      <VisibilitySettings store={store} inst={inst} />
                    </div>
                  )}
                  {isEditing && settingsTab === 'inputs' && pine && (
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
                  {isEditing && settingsTab === 'inputs' && !pine && (
                    <div className="ind-settings">
                      {!def.params.length && !def.sourced && !takesMtf(def) && (
                        <div className="ind-empty pine-span">No inputs.</div>
                      )}
                      {def.params.map((p) => (
                        <label key={p.key}>
                          <span>{p.label}</span>
                          {p.options ? (
                            <select
                              value={inst.params[p.key]}
                              onChange={(e) => setParam(inst.uid, p.key, Number(e.target.value))}
                            >
                              {p.options.map((o, k) => (
                                <option key={o} value={k}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <NumberField
                              min={p.min}
                              max={p.max}
                              step={p.step}
                              value={inst.params[p.key]}
                              onCommit={(v) => setParam(inst.uid, p.key, v)}
                            />
                          )}
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
                      {takesMtf(def) && (
                        <label>
                          <span>Timeframe</span>
                          <select
                            value={inst.tf ?? ''}
                            onChange={(e) => store.setTimeframe(inst.uid, e.target.value || null)}
                          >
                            {MTF_OPTIONS.map((o) => (
                              <option key={o.key} value={o.key}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {takesMtf(def) && inst.tf && (
                        <label className="ind-mtf-wait">
                          <span>Wait for bar close</span>
                          <input
                            type="checkbox"
                            checked={!!inst.tfWait}
                            onChange={(e) => store.setWaitClose(inst.uid, e.target.checked)}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {full && <div className="ind-empty">Limit of {maxIndicators()} reached.</div>}
            <TemplateBar store={store} count={items.length} />
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
              {/* Favourites first, then the catalogue by group (a favourite
                  stays in its group too). */}
              {(['Favourites', ...INDICATOR_GROUPS] as const).map((group) => {
                const list = INDICATORS.filter(
                  (d) =>
                    (group === 'Favourites' ? favs.indexOf(d.id) !== -1 : d.group === group) &&
                    matches(d.name),
                )
                if (!list.length) return null
                return (
                  <div key={group}>
                    <div className="ind-group-lbl">{group}</div>
                    {list.map((d) => {
                      const fav = favs.indexOf(d.id) !== -1
                      return (
                        <div className="ind-add-row" key={d.id}>
                          <button
                            type="button"
                            className="ind-add"
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
                          <button
                            type="button"
                            className={'ind-icon ind-fav' + (fav ? ' on' : '')}
                            aria-pressed={fav}
                            title={fav ? 'Remove from favourites' : 'Add to favourites'}
                            onClick={() => toggleFavourite(d.id)}
                          >
                            <Star on={fav} />
                          </button>
                        </div>
                      )
                    })}
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
            className={'chart-tool-btn tvb-text ind-open' + (open ? ' open' : '')}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={'Indicators (' + items.length + ')'}
            onClick={() => setOpen((o) => !o)}
          >
            {/* TradingView's "fx": an italic f and an x. */}
            <svg viewBox="0 0 28 28" width="20" height="20" aria-hidden="true">
              <path
                d="M8.5 22.5 11 9.2C11.4 7 12.6 6 14.6 6.3M8 12h5.5M14.5 13l5.5 8M20 13l-5.5 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="tvb-label">Indicators</span>
            {items.length > 0 && <span className="rail-count">{items.length}</span>}
            <span className="tvb-tip">Indicators &amp; strategies</span>
          </button>
        </>
      )}
      {panel ? menu && createPortal(menu, document.body) : menu}
    </div>
  )
}
