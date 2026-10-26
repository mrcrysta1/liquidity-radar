// A search button in the header that opens the market search in a dropdown.
// The reference design has a full-width search row; the app keeps its one-row
// header and offers the same search behind this button instead. Opens with the
// cursor in the box, closes on a pick, Escape or a click outside. The "/" key
// opens it too (features/keyboard dispatches lr:open-search).
//
// The search itself is the shared CoinMenu (components/chart/CoinPicker), so
// it finds and shows markets exactly as every other picker does.
import { useEffect, useRef, useState } from 'react'
import { SearchIcon } from '../icons'
import { CoinMenu } from '../chart/CoinPicker'
import { setSymbol } from '../../features/actions/userActions'
import { state } from '../../services/store'

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
        title="Search markets (/)"
        aria-label="Search markets"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SearchIcon size={17} />
      </button>
      {open && (
        <div className="hsearch-pop" role="dialog" aria-label="Search markets">
          <CoinMenu
            inputId="coinSearch"
            className="cp-inline"
            value={state.symbol}
            onPick={(sym) => {
              setOpen(false)
              void setSymbol(sym)
            }}
            onClose={() => {
              setOpen(false)
              // Escape: put the caret back where it came from, not on <body>.
              document.getElementById('searchBtn')?.focus()
            }}
          />
        </div>
      )}
    </div>
  )
}
