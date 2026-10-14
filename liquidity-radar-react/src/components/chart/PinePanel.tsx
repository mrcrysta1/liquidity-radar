// The Pine tab of the indicator menu: a small code editor (textarea with line
// numbers and tab indentation), Compile / Add to chart / Save, the built-in
// examples and "My scripts". Adapted from the Pro terminal's IndicatorMenu
// editor tab.
import { useEffect, useRef, useState } from 'react'
import { PINE_EXAMPLES, PINE_TEMPLATE } from '../../features/charts/pine/examples'
import {
  checkScript,
  pineStatus,
  scriptTitle,
  subscribePine,
} from '../../features/charts/pine/indicator'
import {
  deleteScript,
  saveScript,
  savedScripts,
  savedScriptsFull,
  subscribeSavedScripts,
} from '../../features/charts/pine/scripts'
import { mainIndicatorStore } from '../../features/charts/indicators/store'
import type { IndicatorStore } from '../../features/charts/indicators/store'
import { getDraft, setDraft } from '../../features/charts/pine/draft'

const IND = '    '

interface Msg {
  kind: 'ok' | 'err'
  text: string
  line?: number
}

/** `store` is the chart the scripts go onto (the main chart by default). */
export function PinePanel({ store = mainIndicatorStore }: { store?: IndicatorStore } = {}) {
  const { addPineIndicator, getIndicators, indicatorCount, maxIndicators, updatePineScript } = store
  const [code, setCodeState] = useState(() => getDraft().code)
  const [name, setNameState] = useState(() => getDraft().name)
  const [savedId, setSavedId] = useState(() => getDraft().savedId)
  const [uid, setUid] = useState(() => getDraft().uid)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [, force] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeSavedScripts(() => force((n) => n + 1)), [])
  useEffect(() => subscribePine(() => force((n) => n + 1)), [])

  const setCode = (v: string) => {
    setDraft({ code: v })
    setCodeState(v)
  }
  const setName = (v: string) => {
    setDraft({ name: v })
    setNameState(v)
  }
  const setTarget = (next: { savedId?: string; uid?: string }) => {
    setDraft(next)
    if ('savedId' in next) setSavedId(next.savedId)
    if ('uid' in next) setUid(next.uid)
  }
  const load = (script: string, title: string, target: { savedId?: string; uid?: string }) => {
    setDraft({ code: script, name: title, ...target }, true)
    setCodeState(script)
    setNameState(title)
    setSavedId(target.savedId)
    setUid(target.uid)
    setMsg(null)
  }

  // The instance being edited may have been removed from the chart meanwhile.
  const inst = uid ? getIndicators().find((i) => i.uid === uid) : undefined
  const live = inst ? pineStatus(inst) : null

  const compile = (): boolean => {
    const r = checkScript(code)
    if (r.error) {
      const m = /^Line (\d+)/.exec(r.error)
      setMsg({ kind: 'err', text: r.error, line: m ? Number(m[1]) : undefined })
      return false
    }
    const res = r.result!
    const parts = [
      res.plots.length + ' plot' + (res.plots.length === 1 ? '' : 's'),
      res.hlines.length ? res.hlines.length + ' hline' + (res.hlines.length === 1 ? '' : 's') : '',
      res.inputs.length ? res.inputs.length + ' input' + (res.inputs.length === 1 ? '' : 's') : '',
      res.overlay ? 'price overlay' : 'own pane',
    ].filter(Boolean)
    const ignored = res.warnings.length ? ' · ignored: ' + res.warnings.join(', ') : ''
    setMsg({ kind: 'ok', text: 'Compiled — ' + parts.join(' · ') + ignored })
    return true
  }
  const title = () => name.trim() || scriptTitle(code)
  const add = () => {
    if (!compile()) return
    if (indicatorCount() >= maxIndicators()) {
      setMsg({ kind: 'err', text: 'Indicator limit reached — remove one first.' })
      return
    }
    const id = addPineIndicator(code, title())
    if (id) {
      setTarget({ uid: id })
      setMsg({ kind: 'ok', text: 'Added "' + title() + '" to the chart.' })
    }
  }
  const update = () => {
    if (!inst || !compile()) return
    updatePineScript(inst.uid, code, title())
    setMsg({ kind: 'ok', text: 'Updated "' + title() + '" on the chart.' })
  }
  const save = () => {
    if (!compile()) return
    const it = saveScript(title(), code, savedId)
    if (!it) {
      setMsg({ kind: 'err', text: 'My scripts is full — delete one first.' })
      return
    }
    setTarget({ savedId: it.id })
    setMsg({ kind: 'ok', text: 'Saved "' + it.name + '" to My scripts.' })
  }

  // ---- editor keys: Tab / Shift+Tab indent, Enter keeps (and opens) indentation
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const { selectionStart: a, selectionEnd: b, value } = el
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (inst) update()
      else add()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ls = value.lastIndexOf('\n', a - 1) + 1
      if (a === b && !e.shiftKey) {
        el.setRangeText(IND, a, b, 'end')
      } else {
        // Indent / dedent every line the selection touches.
        const le = value.indexOf('\n', b - (b > a && value[b - 1] === '\n' ? 1 : 0))
        const end = le === -1 ? value.length : le
        const block = value.slice(ls, end)
        const next = block
          .split('\n')
          .map((l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : IND + l))
          .join('\n')
        el.setRangeText(next, ls, end, 'select')
      }
      setCode(el.value)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && a === b) {
      e.preventDefault()
      const ls = value.lastIndexOf('\n', a - 1) + 1
      const line = value.slice(ls, a)
      let lead = /^\s*/.exec(line)![0]
      const t = line.trim()
      if (/=>\s*$/.test(t) || /^(if|else|for|while)\b/.test(t)) lead += IND
      el.setRangeText('\n' + lead, a, b, 'end')
      setCode(el.value)
    }
  }
  const syncGutter = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop
  }
  const jumpTo = (line: number) => {
    const el = taRef.current
    if (!el) return
    const lines = el.value.split('\n')
    let pos = 0
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1
    el.focus()
    el.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0))
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 16
    el.scrollTop = Math.max(0, (line - 3) * lh)
    syncGutter()
  }

  const lineCount = code.split('\n').length
  const saved = savedScripts()
  const errLine = msg?.kind === 'err' ? msg.line : undefined

  return (
    <div className="pine-panel">
      <div className="pine-bar">
        <input
          className="ind-search pine-name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="Script name"
          aria-label="Script name"
        />
        <select
          className="pine-examples"
          value=""
          aria-label="Load an example"
          onChange={(e) => {
            const ex = PINE_EXAMPLES.find((x) => x.id === e.target.value)
            if (ex) load(ex.script, ex.name, {})
          }}
        >
          <option value="">Examples…</option>
          {PINE_EXAMPLES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ind-reset"
          onClick={() => load(PINE_TEMPLATE, 'My Indicator', {})}
        >
          New
        </button>
      </div>

      <div className="pine-editor">
        <div className="pine-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className={errLine === i + 1 ? 'err' : undefined}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={taRef}
          className="pine-code"
          value={code}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          aria-label="Pine Script source"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncGutter}
        />
      </div>

      <div className="pine-actions">
        <button type="button" className="pine-btn" onClick={compile}>
          Compile
        </button>
        {inst ? (
          <button type="button" className="pine-btn primary" onClick={update} title="Ctrl+Enter">
            Update on chart
          </button>
        ) : null}
        <button
          type="button"
          className={'pine-btn' + (inst ? '' : ' primary')}
          onClick={() => {
            setTarget({ uid: undefined })
            add()
          }}
          title={inst ? 'Add another copy' : 'Ctrl+Enter'}
        >
          Add to chart
        </button>
        <button type="button" className="pine-btn" onClick={save}>
          {savedId && saved.some((s) => s.id === savedId) ? 'Save' : 'Save to My scripts'}
        </button>
      </div>

      {msg ? (
        <div className={'pine-msg ' + msg.kind} role={msg.kind === 'err' ? 'alert' : 'status'}>
          {msg.text}
          {msg.line ? (
            <button type="button" className="pine-jump" onClick={() => jumpTo(msg.line!)}>
              Go to line {msg.line}
            </button>
          ) : null}
        </div>
      ) : live?.error ? (
        <div className="pine-msg err" role="alert">
          On chart: {live.error}
        </div>
      ) : (
        <div className="pine-msg">
          Pine v5 subset: indicator, input.*, plot, hline, plotshape/plotchar, var, :=, x[n],
          if/for/while, functions, tuples, ta.*, math.*, color.*. Not run: strategy orders, drawings
          (label/line/box/table), request.security.
        </div>
      )}

      <div className="ind-col-lbl pine-mine-lbl">
        My scripts <span>{saved.length}</span>
        {savedScriptsFull() && <em>full</em>}
      </div>
      {!saved.length && (
        <div className="ind-empty">Nothing saved yet — Save keeps the script here.</div>
      )}
      <div className="pine-mine">
        {saved.map((s) => (
          <div className={'ind-item' + (s.id === savedId ? ' pine-cur' : '')} key={s.id}>
            <div className="ind-item-row">
              <span className="ind-item-name" title={s.name}>
                {s.name}
              </span>
              <button
                type="button"
                className="pine-btn sm"
                onClick={() => load(s.script, s.name, { savedId: s.id })}
              >
                Open
              </button>
              <button
                type="button"
                className="pine-btn sm"
                disabled={indicatorCount() >= maxIndicators()}
                onClick={() => {
                  if (addPineIndicator(s.script, s.name))
                    setMsg({ kind: 'ok', text: 'Added "' + s.name + '" to the chart.' })
                }}
              >
                Add
              </button>
              <button
                type="button"
                className="ind-icon danger"
                title="Delete"
                aria-label={'Delete ' + s.name}
                onClick={() => {
                  if (!window.confirm('Delete "' + s.name + '" from My scripts?')) return
                  deleteScript(s.id)
                  if (s.id === savedId) setTarget({ savedId: undefined })
                }}
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
          </div>
        ))}
      </div>
    </div>
  )
}
