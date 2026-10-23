// "Save layout as…" and the saved-layouts list, inside the layout menu
// (LayoutPicker). Click a name to load it; rename and delete (with an inline
// confirm) sit beside it. The engine's global key handler never sees keys
// typed here: the menu stops their propagation.
import { useEffect, useRef, useState } from 'react'
import {
  deleteLayout,
  getSavedLayouts,
  loadSavedLayout,
  renameLayout,
  saveCurrentLayout,
  subscribeSavedLayouts,
} from '../../features/charts/savedLayouts'
import { MAX_LAYOUT_NAME } from '../../features/charts/savedLayoutsMath'

// Kept with the component so index.css (shared with other work) stays as is.
const CSS = `
.sl{border-top:1px solid var(--border);padding:6px 8px 8px}
.sl-head{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:2px 2px 6px;
  font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.sl-btn{background:transparent;border:1px solid transparent;border-radius:6px;color:var(--dim);cursor:pointer;
  font:inherit;font-size:var(--text-xs);padding:4px 7px;min-height:26px;line-height:1.2}
.sl-btn:hover{background:rgb(var(--pRGB)/.1);color:var(--txt)}
.sl-btn:focus-visible,.sl-input:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.sl-btn.pri{background:var(--primary);border-color:var(--primary);color:#fff}
.sl-btn.danger{color:var(--red)}
.sl-btn.danger.pri{background:var(--red);border-color:var(--red);color:#fff}
.sl-save{color:var(--primary);font-weight:600;text-transform:none;letter-spacing:0}
.sl-form{display:flex;gap:4px;align-items:center;padding:2px 0 6px}
.sl-input{flex:1;min-width:0;background:var(--bg,transparent);color:var(--txt);border:1px solid var(--border2);
  border-radius:6px;padding:4px 7px;font:inherit;font-size:12px;min-height:26px}
.sl-err{color:var(--red);font-size:var(--text-xs);padding:0 2px 6px}
.sl-list{list-style:none;margin:0;padding:0;max-height:200px;overflow-y:auto}
.sl-row{display:flex;align-items:center;gap:2px}
.sl-name{flex:1;min-width:0;text-align:left;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sl-meta{color:var(--dim);font-family:var(--mono);font-size:10px;margin-left:6px}
.sl-confirm{flex:1;min-width:0;font-size:var(--text-xs);color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:4px}
.sl-empty{color:var(--dim);font-size:var(--text-xs);padding:2px 2px 4px}
`

type Mode =
  | { kind: 'idle' }
  | { kind: 'save' }
  | { kind: 'rename'; id: string }
  | { kind: 'confirm'; id: string }

function PencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M11.5 2.5l2 2L6 12l-3 1 1-3z" strokeLinejoin="round" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" strokeLinejoin="round" />
    </svg>
  )
}

export interface SavedLayoutsProps {
  /** A layout was loaded: the menu closes. */
  onLoaded: () => void
  /** Lets the menu's Escape cancel an edit here before it closes the menu. */
  cancelRef: React.MutableRefObject<(() => boolean) | null>
}

export function SavedLayouts({ onLoaded, cancelRef }: SavedLayoutsProps) {
  const [items, setItems] = useState(getSavedLayouts)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const saveBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => subscribeSavedLayouts(() => setItems(getSavedLayouts())), [])
  useEffect(() => {
    if (mode.kind === 'save' || mode.kind === 'rename') inputRef.current?.select()
  }, [mode])

  const reset = () => {
    setMode({ kind: 'idle' })
    setError(null)
  }
  useEffect(() => {
    cancelRef.current = () => {
      if (mode.kind === 'idle') return false
      reset()
      saveBtnRef.current?.focus()
      return true
    }
    return () => {
      cancelRef.current = null
    }
  }, [mode, cancelRef])

  const submit = () => {
    const r = mode.kind === 'rename' ? renameLayout(mode.id, text) : saveCurrentLayout(text)
    if (r.error) {
      setError(r.error)
      return
    }
    reset()
  }

  const form = (label: string, submitLabel: string) => (
    <form
      className="sl-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        ref={inputRef}
        className="sl-input"
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? 'slErr' : undefined}
        maxLength={MAX_LAYOUT_NAME}
        placeholder="Layout name"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
      />
      <button type="submit" className="sl-btn pri">
        {submitLabel}
      </button>
      <button type="button" className="sl-btn" onClick={reset}>
        Cancel
      </button>
    </form>
  )

  return (
    <div className="sl" role="group" aria-label="Saved layouts">
      <style>{CSS}</style>
      <div className="sl-head">
        <span>Saved layouts</span>
        <button
          ref={saveBtnRef}
          type="button"
          className="sl-btn sl-save"
          aria-expanded={mode.kind === 'save'}
          onClick={() => {
            setText('')
            setError(null)
            setMode({ kind: 'save' })
          }}
        >
          Save layout as…
        </button>
      </div>
      {mode.kind === 'save' && form('Name for the new layout', 'Save')}
      {error && (
        <div id="slErr" className="sl-err" role="alert">
          {error}
        </div>
      )}
      {items.length === 0 ? (
        mode.kind !== 'save' && <div className="sl-empty">No saved layouts yet</div>
      ) : (
        <ul className="sl-list" aria-label="Saved layouts list">
          {items.map((e) => (
            <li key={e.id} className="sl-row" data-layout-id={e.id}>
              {mode.kind === 'rename' && mode.id === e.id ? (
                <div style={{ flex: 1, minWidth: 0 }}>
                  {form('New name for ' + e.name, 'Rename')}
                </div>
              ) : mode.kind === 'confirm' && mode.id === e.id ? (
                <>
                  <span className="sl-confirm" role="alert">
                    Delete “{e.name}”?
                  </span>
                  <button
                    type="button"
                    className="sl-btn danger pri"
                    autoFocus
                    onClick={() => {
                      deleteLayout(e.id)
                      reset()
                      saveBtnRef.current?.focus()
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="sl-btn" onClick={reset}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="sl-btn sl-name"
                    aria-label={'Load layout ' + e.name}
                    title={'Load "' + e.name + '"'}
                    onClick={() => {
                      reset()
                      if (loadSavedLayout(e.id)) onLoaded()
                    }}
                  >
                    {e.name}
                    <span className="sl-meta">{e.snapshot.n}×</span>
                  </button>
                  <button
                    type="button"
                    className="sl-btn"
                    aria-label={'Rename layout ' + e.name}
                    title="Rename"
                    onClick={() => {
                      setText(e.name)
                      setError(null)
                      setMode({ kind: 'rename', id: e.id })
                    }}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="sl-btn danger"
                    aria-label={'Delete layout ' + e.name}
                    title="Delete"
                    onClick={() => {
                      setError(null)
                      setMode({ kind: 'confirm', id: e.id })
                    }}
                  >
                    <TrashIcon />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
