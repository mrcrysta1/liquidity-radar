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
