// The alerts modal: create price / technical / conditions / watchlist rules,
// list them and show the recent-trigger log. Opened by the bell
// (openModal('alModal')); the rule list and log are rendered by
// features/alerts renderAlerts() into #alList / #alLog, as before, so every
// existing opener keeps working.
//
// "Conditions" is the TradingView-style builder: up to five conditions joined
// with AND, each comparing price or any indicator output on the main chart
// against a value, another series, or a drawing's line / channel — or a Pine
// script's alertcondition(). It is tied to the charted symbol and interval,
// since that is where the indicators and drawings it reads live.
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { state } from '../../services/store'
import { closeModal, showToast } from '../../utils/dom'
import { useFavorites, watchList } from '../../features/favorites/favorites'
import {
  addRule,
  clearAlertLog,
  enableAlerts,
  removeAlert,
  toggleAlert,
} from '../../features/alerts'
import type { AlertCond, AlertKind } from '../../features/alerts'
import { CONDS_BY_KIND, TECH_CONDS, condLabel } from '../../features/alerts/rules'
import type { AlertFreq, TechCond } from '../../features/alerts/rules'
import {
  CHANNEL_OPS,
  COND_OPS,
  MAX_CONDS,
  MAX_MESSAGE,
  OP_LABEL,
  PCT_OPS,
  PRICE_FIELDS,
  drawingLines,
  operandLabel,
} from '../../features/alerts/conditions'
import type { Cond, CondOp, LineGeom, Operand, PriceField } from '../../features/alerts/conditions'
import { chartOutputs, chartPineConditions } from '../../features/alerts/condRuntime'
import type { OutputPick, PinePick } from '../../features/alerts/condRuntime'
import { chartDrawings } from '../../features/charts/chartRender'
import { CoinPicker } from '../chart/CoinPicker'

const TECH_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
const COOLDOWNS = [0, 1, 5, 15, 60, 240]
const FREQ_LABEL: Record<AlertFreq, string> = {
  once: 'Only once',
  bar: 'Once per bar',
  close: 'Once per bar close',
  every: 'Every time',
}
const KIND_LABEL: Record<AlertKind, string> = {
  price: 'Price / %',
  technical: 'Technical',
  cond: 'Conditions',
  watchlist: 'Watchlist',
}

function valueHint(c: AlertCond): string {
  if (c.startsWith('ema')) return 'Fast EMA (9)'
  if (c.includes('sma')) return 'SMA length (50)'
  if (c.startsWith('macd')) return '—'
  if (c.startsWith('rsi')) return 'RSI level (70)'
  if (c.startsWith('move')) return '% move (2)'
  if (c.includes('pct')) return '% change (5)'
  return 'Price'
}
const value2Hint = (c: AlertCond) => (c.startsWith('ema') ? 'Slow EMA (21)' : c.startsWith('move') ? 'Bars (1)' : 'Min coins (3)')

// ---------------------------------------------------------------- operand picks
// A select's value encodes an operand: 'v' (typed value), 'p:close',
// 'o:<uid>:<key>' (indicator output), 'l:<n>' (n-th drawing line in the
// current pick list), 'c:<uid>:<idx>' (Pine alertcondition).

interface LinePick {
  label: string
  line: LineGeom
}
interface Picks {
  outputs: OutputPick[]
  pine: PinePick[]
  lines: LinePick[]
  /** Indices into `lines` that belong to the selected drawing. */
  selLines: number[]
}

function readPicks(): Picks {
  const lines: LinePick[] = []
  const selLines: number[] = []
  let outputs: OutputPick[] = []
  let pine: PinePick[] = []
  try {
    outputs = chartOutputs()
    pine = chartPineConditions()
    const d = chartDrawings()
    const seen: Record<string, number> = {}
    d.drawings.forEach((dr, di) => {
      drawingLines(dr).forEach((l) => {
        const n = (seen[l.label] = (seen[l.label] || 0) + 1)
        if (di === d.selected) selLines.push(lines.length)
        lines.push({ label: l.label + ' #' + n + (di === d.selected ? ' (selected)' : ''), line: l.line })
      })
    })
  } catch {
    /* chart not mounted yet — only price and values to offer */
  }
  return { outputs, pine, lines, selLines }
}

function toOperand(code: string, num: string, p: Picks): Operand | null {
  if (code === 'v') {
    const v = Number(num)
    return num.trim() !== '' && Number.isFinite(v) ? { t: 'value', v } : null
  }
  const [k, a, b] = code.split(':')
  if (k === 'p') return { t: 'price', field: a as PriceField }
  if (k === 'o') {
    const o = p.outputs.find((x) => x.uid === a && x.key === b)
    return o ? { t: 'out', uid: o.uid, key: o.key, label: o.label } : null
  }
  if (k === 'l') {
    const l = p.lines[Number(a)]
    return l ? { t: 'line', line: l.line, label: l.label.replace(' (selected)', '') } : null
  }
  if (k === 'c') {
    const s = p.pine.find((x) => x.uid === a)
    const c = s?.conds.find((x) => x.idx === Number(b))
    return s && c ? { t: 'pine', uid: s.uid, idx: c.idx, title: s.title + ': ' + c.title } : null
  }
  return null
}

interface Row {
  a: string
  op: CondOp
  b: string
  bNum: string
  c: string
  cNum: string
  bars: string
}
const newRow = (): Row => ({ a: 'p:close', op: 'cross', b: 'v', bNum: '', c: 'v', cNum: '', bars: '1' })

function SeriesOptions({ p, withValue, withLines }: { p: Picks; withValue?: boolean; withLines?: boolean }) {
  return (
    <>
      {withValue && <option value="v">Value</option>}
      <optgroup label="Price">
        {PRICE_FIELDS.map((f) => (
          <option key={f} value={'p:' + f}>
            {operandLabel({ t: 'price', field: f })}
          </option>
        ))}
      </optgroup>
      {p.outputs.length > 0 && (
        <optgroup label="Indicators">
          {p.outputs.map((o) => (
            <option key={o.uid + o.key} value={'o:' + o.uid + ':' + o.key}>
              {o.label}
            </option>
          ))}
        </optgroup>
      )}
      {withLines && p.lines.length > 0 && (
        <optgroup label="Drawings">
          {p.lines.map((l, i) => (
            <option key={i} value={'l:' + i}>
              {l.label}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )
}

function CondRow({
  row,
  p,
  onChange,
  onRemove,
}: {
  row: Row
  p: Picks
  onChange: (r: Row) => void
  onRemove?: () => void
}) {
  const set = (patch: Partial<Row>) => onChange({ ...row, ...patch })
  const pine = row.a.startsWith('c:')
  const channel = CHANNEL_OPS.includes(row.op)
  const pct = PCT_OPS.includes(row.op)
  const side = (code: string, num: string, key: 'b' | 'c') => (
    <>
      <select
        className="pf-input al-cond-sel"
        value={code}
        onChange={(e) => set({ [key]: e.target.value } as Partial<Row>)}
        aria-label={key === 'b' ? 'Compared with' : 'Second bound'}
      >
        <SeriesOptions p={p} withValue withLines />
      </select>
      {code === 'v' && (
        <input
          className="pf-input al-cond-num"
          type="number"
          step="any"
          placeholder="Value"
          value={num}
          onChange={(e) => set({ [key + 'Num']: e.target.value } as Partial<Row>)}
        />
      )}
    </>
  )
  return (
    <div className="al-cond">
      <select
        className="pf-input al-cond-sel"
        value={row.a}
        onChange={(e) => set({ a: e.target.value, op: e.target.value.startsWith('c:') ? 'true' : row.op === 'true' ? 'cross' : row.op })}
        aria-label="Series"
      >
        <SeriesOptions p={p} />
        {p.pine.some((s) => s.conds.length) && (
          <optgroup label="Pine alertcondition">
            {p.pine.flatMap((s) =>
              s.conds.map((c) => (
                <option key={s.uid + c.idx} value={'c:' + s.uid + ':' + c.idx}>
                  {s.title + ': ' + c.title}
                </option>
              )),
            )}
          </optgroup>
        )}
      </select>
      {!pine && (
        <select
          className="pf-input al-cond-op"
          value={row.op}
          onChange={(e) => set({ op: e.target.value as CondOp })}
          aria-label="Operator"
        >
          {COND_OPS.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </select>
      )}
      {!pine && !pct && side(row.b, row.bNum, 'b')}
      {!pine && channel && side(row.c, row.cNum, 'c')}
      {!pine && pct && (
        <>
          <input
            className="pf-input al-cond-num"
            type="number"
            step="any"
            placeholder="%"
            value={row.bNum}
            onChange={(e) => set({ bNum: e.target.value })}
            aria-label="Percent"
          />
          <input
            className="pf-input al-cond-num"
            type="number"
            min={1}
            step={1}
            placeholder="Bars"
            value={row.bars}
            onChange={(e) => set({ bars: e.target.value })}
            aria-label="Bars"
          />
        </>
      )}
      {pine && <span className="al-cur">is true</span>}
      {onRemove && (
        <button type="button" className="al-act" onClick={onRemove} aria-label="Remove condition" title="Remove condition">
          ×
        </button>
      )}
    </div>
  )
}

function rowToCond(r: Row, p: Picks): Cond | null {
  const a = toOperand(r.a, '', p)
  if (!a) return null
  if (a.t === 'pine') return { a, op: 'true' }
  if (PCT_OPS.includes(r.op)) {
    const b = toOperand('v', r.bNum, p)
    return b ? { a, op: r.op, b, bars: Math.max(1, Math.round(Number(r.bars) || 1)) } : null
  }
  const b = toOperand(r.b, r.bNum, p)
  if (!b) return null
  if (!CHANNEL_OPS.includes(r.op)) return { a, op: r.op, b }
  const c = toOperand(r.c, r.cNum, p)
  return c ? { a, op: r.op, b, c } : null
}

// ---------------------------------------------------------------- modal

export function AlertsModal() {
  useFavorites() // re-render the watchlist hint when favourites change
  const [kind, setKind] = useState<AlertKind>('price')
  const [cond, setCond] = useState<AlertCond>('crosses_above')
  const [tech, setTech] = useState<TechCond>('rsi_above')
  const [sym, setSym] = useState(state.symbol)
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [tf, setTf] = useState('15m')
  const [freq, setFreq] = useState<AlertFreq>('once')
  const [cooldown, setCooldown] = useState(15)
  const [expiry, setExpiry] = useState('')
  const [message, setMessage] = useState('')
  const [webhook, setWebhook] = useState('')
  const [rows, setRows] = useState<Row[]>([newRow()])
  const [picks, setPicks] = useState<Picks>({ outputs: [], pine: [], lines: [], selLines: [] })
  const boxRef = useRef<HTMLDivElement>(null)

  // Prefill the charted symbol (and re-read the chart's indicators and
  // drawings) each time the modal opens.
  useEffect(() => {
    const el = boxRef.current?.parentElement
    if (!el) return
    const mo = new MutationObserver(() => {
      if (el.classList.contains('open')) {
        setSym(state.symbol)
        if (state.tf && TECH_TFS.includes(state.tf)) setTf(state.tf)
        setPicks(readPicks())
      }
    })
    mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  const watchTech = kind === 'watchlist' && cond === 'any_technical'
  /** The condition whose value fields show: the watchlist's technical pick when there is one. */
  const shown: AlertCond = watchTech ? tech : cond
  const needsValue = kind !== 'cond' && !shown.startsWith('macd')
  const hasValue2 =
    kind !== 'cond' && (shown.startsWith('ema') || shown.startsWith('move') || shown === 'count_above_pct')
  const barBased = kind === 'technical' || kind === 'cond' || watchTech
  const freqs: AlertFreq[] = barBased ? ['once', 'bar', 'close', 'every'] : ['once', 'every']

  const pickKind = (k: AlertKind) => {
    setKind(k)
    setCond(CONDS_BY_KIND[k][0])
    setValue('')
    setValue2('')
    if (!['once', 'every'].includes(freq) && k !== 'technical' && k !== 'cond') setFreq('once')
    if (k === 'cond') setPicks(readPicks())
  }

  /** Alert on the drawing selected on the chart: a cross of its line, or entering its channel. */
  const pickSelectedDrawing = () => {
    const s = picks.selLines
    if (!s.length) return
    const r =
      s.length >= 2
        ? { ...newRow(), op: 'enter' as CondOp, b: 'l:' + s[0], c: 'l:' + s[1] }
        : { ...newRow(), op: 'cross' as CondOp, b: 'l:' + s[0] }
    setRows([r])
  }

  const submit = () => {
    const v = needsValue ? Number(value) : 0
    if (needsValue && (value.trim() === '' || !Number.isFinite(v))) {
      showToast('Enter a numeric value')
      return
    }
    let conds: Cond[] | undefined
    if (kind === 'cond') {
      const list = rows.map((r) => rowToCond(r, picks))
      if (list.some((c) => !c)) {
        showToast('Complete every condition')
        return
      }
      conds = list as Cond[]
    }
    const exp = expiry ? new Date(expiry).getTime() : undefined
    // A frequency picked on a bar-based tab may not apply to this one.
    const eff: AlertFreq = freqs.includes(freq) ? freq : 'once'
    const isCond = kind === 'cond'
    // A Pine alertcondition carries its own message: the default text when none is typed.
    const pineMsg = isCond && !message.trim() ? pineMessage(conds!, picks) : ''
    const err = addRule({
      kind,
      sym: kind === 'watchlist' ? undefined : isCond ? state.symbol : sym,
      tf: barBased ? (isCond ? state.tf : tf) : undefined,
      condition: cond,
      value: v,
      value2: hasValue2 && value2.trim() !== '' ? Number(value2) : undefined,
      once: eff === 'once',
      freq: eff,
      cooldownMin: eff === 'every' ? cooldown : undefined,
      expires: exp != null && Number.isFinite(exp) ? exp : undefined,
      message: message.trim() || pineMsg || undefined,
      webhook: webhook.trim() || undefined,
      tech: watchTech ? tech : undefined,
      conds,
    })
    if (err) {
      showToast(err)
      return
    }
    showToast(
      'Alert set: ' +
        (kind === 'watchlist' ? 'watchlist' : isCond ? state.symbol : sym.toUpperCase()) +
        ' ' +
        (isCond ? rows.length + ' condition' + (rows.length > 1 ? 's' : '') : condLabel(shown)) +
        (needsValue ? ' ' + value : ''),
    )
    setValue('')
    setValue2('')
  }

  // Row buttons are plain HTML from renderAlerts(); handle them here.
  const onListClick = (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-al-act]') as HTMLElement | null
    const row = btn?.closest('[data-al-id]') as HTMLElement | null
    if (!btn || !row) return
    const id = row.dataset.alId!
    if (btn.dataset.alAct === 'remove') removeAlert(id)
    else toggleAlert(id)
  }

  return (
    <div
      className="modal-overlay"
      id="alModal"
      role="dialog"
      aria-modal="true"
      aria-label="Alerts"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal('alModal')
      }}
    >
      <div className="modal-box" style={{ maxWidth: '600px' }} ref={boxRef}>
        <div className="modal-head">
          <div>Alerts</div>
          <button className="modal-x" onClick={() => closeModal('alModal')}>
            X
          </button>
        </div>
        <div className="modal-body">
          <div className="al-kinds" role="tablist" aria-label="Alert type">
            {(['price', 'technical', 'cond', 'watchlist'] as AlertKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={'al-kind' + (kind === k ? ' on' : '')}
                onClick={() => pickKind(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {kind === 'cond' ? (
            <div className="al-conds">
              <div className="al-cond-head">
                <span>
                  <b>{state.symbol}</b> <span className="al-cur">{state.tf} · all must hold</span>
                </span>
                {picks.selLines.length > 0 && (
                  <button type="button" className="al-act" onClick={pickSelectedDrawing}>
                    Use selected drawing
                  </button>
                )}
              </div>
              {rows.map((r, i) => (
                <CondRow
                  key={i}
                  row={r}
                  p={picks}
                  onChange={(nr) => setRows(rows.map((x, j) => (j === i ? nr : x)))}
                  onRemove={rows.length > 1 ? () => setRows(rows.filter((_, j) => j !== i)) : undefined}
                />
              ))}
              {rows.length < MAX_CONDS && (
                <button type="button" className="al-act al-cond-add" onClick={() => setRows([...rows, newRow()])}>
                  + AND condition
                </button>
              )}
            </div>
          ) : (
            <div className="pf-field al-form">
              {kind === 'watchlist' ? (
                <span className="al-wl" title={watchList().join(', ')}>
                  All favourites ({watchList().length})
                </span>
              ) : (
                <CoinPicker
                  value={sym}
                  onPick={(s) => setSym(s)}
                  compact
                  float
                  tabs={null}
                  label="Alert symbol"
                  className="al-sym"
                />
              )}
              <select
                id="alDir"
                className="pf-input"
                value={cond}
                onChange={(e) => setCond(e.target.value as AlertCond)}
                style={{ flex: '1 1 150px' }}
                aria-label="Condition"
              >
                {CONDS_BY_KIND[kind].map((c) => (
                  <option key={c} value={c}>
                    {c === 'any_technical' ? 'any: technical…' : condLabel(c)}
                  </option>
                ))}
              </select>
              {watchTech && (
                <select
                  className="pf-input"
                  value={tech}
                  onChange={(e) => setTech(e.target.value as TechCond)}
                  style={{ flex: '1 1 130px' }}
                  aria-label="Technical condition"
                >
                  {TECH_CONDS.map((c) => (
                    <option key={c} value={c}>
                      {condLabel(c)}
                    </option>
                  ))}
                </select>
              )}
              {(kind === 'technical' || watchTech) && (
                <select
                  id="alTf"
                  className="pf-input"
                  value={tf}
                  onChange={(e) => setTf(e.target.value)}
                  style={{ flex: '0 0 70px' }}
                  aria-label="Timeframe"
                >
                  {TECH_TFS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              )}
              {needsValue && (
                <input
                  id="alPrice"
                  className="pf-input"
                  type="number"
                  step="any"
                  placeholder={valueHint(shown)}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                  style={{ flex: '1 1 90px' }}
                />
              )}
              {hasValue2 && (
                <input
                  id="alValue2"
                  className="pf-input"
                  type="number"
                  step="any"
                  placeholder={value2Hint(shown)}
                  value={value2}
                  onChange={(e) => setValue2(e.target.value)}
                  style={{ flex: '1 1 90px' }}
                />
              )}
            </div>
          )}
          <div className="al-opts">
            <select
              className="pf-input al-freq"
              value={freqs.includes(freq) ? freq : 'once'}
              onChange={(e) => setFreq(e.target.value as AlertFreq)}
              aria-label="Trigger frequency"
              title="How often the alert may fire"
            >
              {freqs.map((f) => (
                <option key={f} value={f}>
                  {FREQ_LABEL[f]}
                </option>
              ))}
            </select>
            {freq === 'every' && (
              <select
                className="pf-input al-freq"
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
                aria-label="Cooldown"
              >
                {COOLDOWNS.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'no cooldown' : 'at most every ' + (m >= 60 ? m / 60 + 'h' : m + 'm')}
                  </option>
                ))}
              </select>
            )}
          </div>
          <details className="al-more">
            <summary>Expiry, message, webhook</summary>
            <label className="al-more-row">
              <span>Expires</span>
              <input
                className="pf-input"
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                aria-label="Expiry"
              />
            </label>
            <label className="al-more-row">
              <span>Message</span>
              <input
                className="pf-input"
                maxLength={MAX_MESSAGE}
                placeholder="{{ticker}} crossed {{close}} on {{interval}} at {{time}}"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-label="Alert message"
              />
            </label>
            <label className="al-more-row">
              <span>Webhook</span>
              <input
                className="pf-input"
                type="url"
                inputMode="url"
                placeholder="https://… (POSTs the message)"
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                aria-label="Webhook URL"
              />
            </label>
            <div className="al-note">
              Alerts are checked in this browser: they (and their webhooks) only fire while the app is open.
            </div>
          </details>
          <button id="alSubmit" className="tb-btn" style={{ width: '100%', marginTop: '2px' }} onClick={submit}>
            Set Alert
          </button>
          <div className="al-perm" id="alPerm">
            Desktop notifications: <b id="alPermState">off</b> —{' '}
            <button className="al-enable-btn" onClick={() => enableAlerts()}>
              Enable
            </button>
          </div>
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--dim)' }}>
            Checked live and fire desktop notifications + toasts. &quot;Crosses&quot; waits for the price to
            move through the level; &quot;above/below&quot; fires as soon as it is there.
          </div>
          <div className="al-list" id="alList" onClick={onListClick}></div>
          <div className="al-log-head">
            <span>Recent triggers</span>
            <button type="button" className="al-act" onClick={() => clearAlertLog()}>
              Clear
            </button>
          </div>
          <div className="al-list" id="alLog"></div>
        </div>
      </div>
    </div>
  )
}

/** The message a picked Pine alertcondition declared, for a rule with no custom text. */
function pineMessage(conds: Cond[], p: Picks): string {
  for (const c of conds) {
    if (c.a.t !== 'pine') continue
    const a = c.a
    const m = p.pine.find((s) => s.uid === a.uid)?.conds.find((x) => x.idx === a.idx)?.message
    if (m) return m
  }
  return ''
}
