// The Radar AI assistant, as a docked panel behind a launcher in the corner
// rather than a whole tab of its own.
//
// The panel keeps the chat markup's ids and classes, because the engine pushes
// its welcome message straight into #chatLog and the styling is shared. What it
// no longer keeps is the old id-based listener wiring: the chips and the form
// call sendChat directly, so React owns the events and nothing breaks silently
// if this subtree re-renders.
import { useEffect, useRef, useState } from 'react'
import {
  isDockOpen,
  sendChat,
  setDockOpen,
  subscribeDock,
  toggleDock,
} from '../../features/chat'

const CHIPS: Array<{ q: string; label: string }> = [
  { q: 'Analyze BTC', label: '📈 Analyze BTC' },
  { q: 'What is RSI?', label: '🧠 What is RSI?' },
  { q: 'Should I buy pepe?', label: 'Buy PEPE?' },
  { q: 'Show meme coins', label: '🐕 Meme coins' },
  { q: 'Show signals', label: '⚡ Show signals' },
  { q: 'Fear and greed now', label: 'Fear & Greed' },
  { q: 'Best performer today', label: 'Top gainer today' },
  { q: 'Whale activity?', label: 'Whale watch' },
  { q: 'What patterns do you see?', label: '🔍 Patterns' },
  { q: 'What can you do', label: 'Help' },
]

function SparkIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1.45-4.6A8.5 8.5 0 1 1 20.5 11.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M12 7.6l.85 2.3 2.3.85-2.3.85-.85 2.3-.85-2.3-2.3-.85 2.3-.85.85-2.3Z"
        fill="currentColor"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 7l10 10M17 7L7 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function AiAssistant() {
  const [open, setOpen] = useState(isDockOpen)
  const rootRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Close, handing focus back to the launcher.
   *
   * Without this the caret stays in an input that is now hidden, and the
   * single-key shortcuts stay swallowed — press Escape after typing and `T`
   * would no longer reopen the panel.
   */
  const dismiss = () => {
    const root = rootRef.current
    if (root && root.contains(document.activeElement)) fabRef.current?.focus()
    setDockOpen(false)
  }

  // The keyboard layer toggles the same store, so the button is not the only
  // thing that can open this.
  useEffect(() => subscribeDock(setOpen), [])

  // The button is fixed over the page, and on a phone it sits on top of the
  // market tables' price column. Fade it out while the page is actually
  // moving and bring it back once scrolling settles. Repeated setScrolling
  // (true) is free — React bails out when the value is unchanged — so this
  // costs one state flip per scroll gesture, not one per frame.
  const [scrolling, setScrolling] = useState(false)
  useEffect(() => {
    let idle = 0
    const onScroll = () => {
      setScrolling(true)
      clearTimeout(idle)
      idle = window.setTimeout(() => setScrolling(false), 450)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(idle)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    // A hidden log has no scroll height, so the position it held while closed
    // is meaningless — drop to the newest message on the way in.
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    // Anywhere outside the dock dismisses it — including the launcher's own
    // rail, which is inside the root and handles its own toggle. Capture phase,
    // so a handler that stops propagation cannot trap the panel open.
    const onDown = (e: Event) => {
      const root = rootRef.current
      if (!root || root.contains(e.target as Node)) return
      // The click itself decides where focus lands, so only let go of it here.
      if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
      setDockOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  return (
    <div
      className={'ai-dock-root' + (open ? ' open' : '') + (scrolling && !open ? ' scrolled-away' : '')}
      ref={rootRef}
    >
      <div className="ai-dock" id="aiDock" role="dialog" aria-label="Radar AI Assistant" hidden={!open}>
        <div className="chat-head">
          <div className="ai-avatar">🤖</div>
          <div className="ai-dock-id">
            <div className="ai-dock-name">Radar AI Assistant</div>
            <div className="ai-dock-sub">29 coins live · indicators · whales · sentiment</div>
          </div>
          <span className="badge b-green">ONLINE</span>
          <button
            type="button"
            className="ai-dock-x"
            onClick={dismiss}
            aria-label="Close assistant"
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="chat-log" id="chatLog" ref={logRef}></div>
        <div className="chips" id="chatChips">
          {CHIPS.map((c) => (
            <button key={c.q} type="button" className="chip" onClick={() => void sendChat(c.q)}>
              {c.label}
            </button>
          ))}
        </div>
        <form
          className="chat-input-row"
          id="chatForm"
          onSubmit={(e) => {
            e.preventDefault()
            void sendChat(inputRef.current?.value ?? '')
          }}
        >
          <input
            type="text"
            id="chatInput"
            ref={inputRef}
            placeholder="Ask about any coin, indicator, whale moves…"
            autoComplete="off"
            maxLength={300}
          />
          <button className="send-btn" type="submit" id="sendBtn">
            Send ➤
          </button>
        </form>
      </div>

      <button
        type="button"
        className="ai-fab"
        ref={fabRef}
        onClick={toggleDock}
        aria-expanded={open}
        aria-controls="aiDock"
        aria-label={open ? 'Close Radar AI' : 'Open Radar AI'}
        title={open ? 'Close Radar AI' : 'Radar AI  [T]'}
      >
        {open ? <CloseIcon /> : <SparkIcon />}
        {!open && <i className="ai-fab-dot" aria-hidden="true" />}
        <span className="ai-fab-tip">Radar AI</span>
      </button>
    </div>
  )
}
