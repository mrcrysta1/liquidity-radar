// The alerts modal: create price / technical / watchlist rules, list them and
// show the recent-trigger log. Opened by the bell (openModal('alModal')); the
// rule list and log are rendered by features/alerts renderAlerts() into
// #alList / #alLog, as before, so every existing opener keeps working.
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
import { CONDS_BY_KIND, condLabel } from '../../features/alerts/rules'

const TECH_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d']
const COOLDOWNS = [1, 5, 15, 60, 240]

function valueHint(c: AlertCond): string {
  if (c.startsWith('ema')) return 'Fast EMA (9)'
  if (c.includes('sma')) return 'SMA length (50)'
  if (c.startsWith('macd')) return '—'
  if (c.startsWith('rsi')) return 'RSI level (70)'
  if (c.includes('pct')) return '% change (5)'
  return 'Price'
}

export function AlertsModal() {
  useFavorites() // re-render the watchlist hint when favourites change
  const [kind, setKind] = useState<AlertKind>('price')
  const [cond, setCond] = useState<AlertCond>('crosses_above')
  const [sym, setSym] = useState(state.symbol)
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [tf, setTf] = useState('15m')
  const [once, setOnce] = useState(true)
  const [cooldown, setCooldown] = useState(15)
  const boxRef = useRef<HTMLDivElement>(null)

  // Prefill the charted symbol each time the modal opens.
  useEffect(() => {
    const el = boxRef.current?.parentElement
    if (!el) return
    const mo = new MutationObserver(() => {
      if (el.classList.contains('open')) {
        setSym(state.symbol)
        if (state.tf && TECH_TFS.includes(state.tf)) setTf(state.tf)
      }
    })
    mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  const needsValue = !cond.startsWith('macd')
  const hasValue2 = cond.startsWith('ema') || cond === 'count_above_pct'

  const pickKind = (k: AlertKind) => {
    setKind(k)
    setCond(CONDS_BY_KIND[k][0])
    setValue('')
    setValue2('')
  }

  const submit = () => {
    const v = needsValue ? Number(value) : 0
    if (needsValue && (value.trim() === '' || !Number.isFinite(v))) {
      showToast('Enter a numeric value')
      return
    }
    const err = addRule({
      kind,
      sym: kind === 'watchlist' ? undefined : sym,
      tf: kind === 'technical' ? tf : undefined,
      condition: cond,
      value: v,
      value2: hasValue2 && value2.trim() !== '' ? Number(value2) : undefined,
      once,
      cooldownMin: once ? undefined : cooldown,
    })
    if (err) {
      showToast(err)
      return
    }
    showToast(
      'Alert set: ' +
        (kind === 'watchlist' ? 'watchlist' : sym.toUpperCase()) +
        ' ' +
        condLabel(cond) +
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
      <div className="modal-box" style={{ maxWidth: '560px' }} ref={boxRef}>
        <div className="modal-head">
          <div>Alerts</div>
          <button className="modal-x" onClick={() => closeModal('alModal')}>
            X
          </button>
        </div>
        <div className="modal-body">
          <div className="al-kinds" role="tablist" aria-label="Alert type">
            {(['price', 'technical', 'watchlist'] as AlertKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={'al-kind' + (kind === k ? ' on' : '')}
                onClick={() => pickKind(k)}
              >
                {k === 'price' ? 'Price / %' : k === 'technical' ? 'Technical' : 'Watchlist'}
              </button>
            ))}
          </div>
          <div className="pf-field al-form">
            {kind === 'watchlist' ? (
              <span className="al-wl" title={watchList().join(', ')}>
                All favourites ({watchList().length})
              </span>
            ) : (
              <input
                id="alSym"
                className="pf-input"
                placeholder="Symbol (BTCUSDT)"
                value={sym}
                onChange={(e) => setSym(e.target.value)}
                style={{ flex: '1 1 110px' }}
                autoComplete="off"
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
                  {condLabel(c)}
                </option>
              ))}
            </select>
            {kind === 'technical' && (
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
                placeholder={valueHint(cond)}
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
                placeholder={cond.startsWith('ema') ? 'Slow EMA (21)' : 'Min coins (3)'}
                value={value2}
                onChange={(e) => setValue2(e.target.value)}
                style={{ flex: '1 1 90px' }}
              />
            )}
          </div>
          <div className="al-opts">
            <label>
              <input type="radio" name="alOnce" checked={once} onChange={() => setOnce(true)} /> Once
            </label>
            <label>
              <input type="radio" name="alOnce" checked={!once} onChange={() => setOnce(false)} /> Repeat
            </label>
            {!once && (
              <select
                className="pf-input"
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
                aria-label="Cooldown"
                style={{ width: 'auto', padding: '3px 6px' }}
              >
                {COOLDOWNS.map((m) => (
                  <option key={m} value={m}>
                    every {m >= 60 ? m / 60 + 'h' : m + 'm'} max
                  </option>
                ))}
              </select>
            )}
          </div>
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

