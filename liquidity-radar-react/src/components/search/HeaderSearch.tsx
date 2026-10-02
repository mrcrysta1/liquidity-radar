// A search button in the header that opens the coin search in a dropdown.
// The reference design has a full-width search row; the app keeps its one-row
// header and offers the same search behind this button instead. Opens with the
// cursor in the box, closes on a pick, Escape or a click outside. The "/" key
// opens it too (features/keyboard dispatches lr:open-search).
import { useEffect, useRef, useState } from 'react'
import { SearchIcon } from '../icons'
import { CoinSearchWidget } from './CoinSearchWidget'

export const OPEN_SEARCH_EVENT = 'lr:open-search'

export function HeaderSearch() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="hsearch" ref={root}>
      <button
        type="button"
        className="theme-btn icon-btn"
        id="searchBtn"
        title="Search coins (/)"
        aria-label="Search coins"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SearchIcon size={17} />
      </button>
      {open && (
        <div className="hsearch-pop" role="dialog" aria-label="Search coins">
          <CoinSearchWidget autoFocus onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
