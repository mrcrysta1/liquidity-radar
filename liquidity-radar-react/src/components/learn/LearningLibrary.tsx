// Settings → Learning: how every model and technique in the app works, a
// glossary, pattern diagrams, and a downloadable PDF of all of it.
//
// The PDF uses the browser's own print-to-PDF: the whole library is rendered
// expanded into a print-only container and window.print() is called, so there
// is no PDF library in the bundle and the file always matches the page.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LEARN_SECTIONS, LEARN_UPDATED, WHATS_NEW, entryCount, searchLearn } from '../../features/learn/content'
import { Diagram } from '../../features/learn/diagrams'
import type { Block, LearnEntry, LearnSection } from '../../features/learn/types'

/** **bold** and `code` only; everything else is plain text. */
function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`(.+?)`/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(m[1] ? <b key={k++}>{m[1]}</b> : <code key={k++}>{m[2]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function BlockView({ b }: { b: Block }) {
  if ('p' in b) return <p><Rich text={b.p} /></p>
  if ('list' in b)
    return (
      <ul>
        {b.list.map((li, i) => (
          <li key={i}><Rich text={li} /></li>
        ))}
      </ul>
    )
  if ('formula' in b) return <pre className="lg-formula">{b.formula}</pre>
  if ('tip' in b) return <p className="lg-tip"><b>Tip · </b><Rich text={b.tip} /></p>
  if ('warn' in b) return <p className="lg-warn"><b>Careful · </b><Rich text={b.warn} /></p>
  if ('diagram' in b) return <Diagram id={b.diagram} caption={b.caption} />
  return null
}

function EntryBody({ e }: { e: LearnEntry }) {
  return (
    <>
      <p className="lg-summary"><Rich text={e.summary} /></p>
      {e.body.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
      {e.inApp && <p className="lg-inapp">In the app: {e.inApp}</p>}
    </>
  )
}

function WhatsNew() {
  return (
    <div className="lg-new">
      {WHATS_NEW.map((w) => (
        <div key={w.date}>
          <b>{w.date}</b>
          <ul>
            {w.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The whole library, expanded, for printing to PDF. */
function PrintView() {
  return (
    <div className="lg-print">
      <header>
        <h1>Liquidity Radar — Learning Guide</h1>
        <p>How the app's models and tools work, with a glossary of every indicator and concept. Updated {LEARN_UPDATED}. Educational only — not financial advice.</p>
      </header>
      <h2>Contents</h2>
      <ol className="lg-toc">
        {LEARN_SECTIONS.map((s) => (
          <li key={s.id}>{s.title} <small>({s.entries.length})</small></li>
        ))}
      </ol>
      {LEARN_SECTIONS.map((s) => (
        <section key={s.id} className="lg-print-sec">
          <h2>{s.title}</h2>
          <p className="lg-intro">{s.intro}</p>
          {s.entries.map((e) => (
            <article key={e.id} className="lg-print-entry">
              <h3>{e.title}</h3>
              <EntryBody e={e} />
            </article>
          ))}
        </section>
      ))}
      <section className="lg-print-sec">
        <h2>What's new</h2>
        <WhatsNew />
      </section>
    </div>
  )
}

export function LearningLibrary() {
  const [q, setQ] = useState('')
  const [sec, setSec] = useState<string>('all')
  const [printing, setPrinting] = useState(false)
  const found = useMemo(() => searchLearn(q), [q])
  const [focus, setFocus] = useState<string | null>(null)

  // The assistant can open a topic ("teach me RSI" → [[learn:rsi]]); the event
  // may arrive before this lazy component mounted, so the last one is kept.
  useEffect(() => {
    const go = (d: { id?: string; q?: string } | undefined) => {
      if (!d) return
      setSec('all')
      if (d.id) {
        setQ('')
        setFocus(d.id)
      } else if (d.q) setQ(d.q)
    }
    // A request made before this lazily loaded page existed (chat.ts runAction).
    const w = window as unknown as { __lrLearnOpen?: { id?: string; q?: string } }
    go(w.__lrLearnOpen)
    w.__lrLearnOpen = undefined
    const on = (e: Event) => {
      w.__lrLearnOpen = undefined
      go((e as CustomEvent).detail)
    }
    window.addEventListener('lr:learn-open', on)
    return () => window.removeEventListener('lr:learn-open', on)
  }, [])
  useEffect(() => {
    if (!focus) return
    const t = window.setTimeout(() => {
      const el = document.getElementById('learn-' + focus) as HTMLDetailsElement | null
      if (el) {
        el.open = true
        el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
      setFocus(null)
    }, 60)
    return () => window.clearTimeout(t)
  }, [focus])
  const shown: LearnSection[] = sec === 'all' || q ? found : found.filter((s) => s.id === sec)

  useEffect(() => {
    if (!printing) return
    const root = document.documentElement
    const title = document.title
    const done = () => {
      root.classList.remove('lg-printing')
      document.title = title
      setPrinting(false)
    }
    root.classList.add('lg-printing')
    // The browser suggests the page title as the PDF's file name.
    document.title = 'Liquidity-Radar-Learning-Guide-' + LEARN_UPDATED
    window.addEventListener('afterprint', done, { once: true })
    // Let the print view mount (and its SVGs lay out) before the dialog opens.
    const t = window.setTimeout(() => window.print(), 150)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  return (
    <div className="lg">
      <div className="card lg-head">
        <div className="sec-head">
          <div className="sec-title">Learning</div>
          <span className="badge b-cyan">{entryCount()} TOPICS · UPDATED {LEARN_UPDATED}</span>
        </div>
        <p className="lg-lede">
          How every model, indicator and order-flow tool in Liquidity Radar works, explained for new traders. Educational only: nothing here is financial advice, and no model can promise profit.
        </p>
        <div className="lg-bar">
          <label className="dt-search lg-search">
            <input type="search" placeholder="Search topics (e.g. RSI, CVD, fair value gap, neural)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the Learning library" />
          </label>
          <button type="button" className="lg-pdf" onClick={() => setPrinting(true)}>
            Download PDF
          </button>
        </div>
        <div className="lg-chips" role="tablist" aria-label="Sections">
          {[{ id: 'all', title: 'All' }, ...LEARN_SECTIONS].map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={sec === s.id} className={'sig-chip' + (sec === s.id ? ' on' : '')} onClick={() => setSec(s.id)}>
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {!shown.length && <div className="card lg-empty">Nothing matches "{q}". Try a shorter word, or ask the AI assistant.</div>}

      {shown.map((s) => (
        <section key={s.id} className="card lg-sec" aria-label={s.title}>
          <div className="sec-head">
            <div className="sec-title">{s.title}</div>
            <span className="badge b-purple">{s.entries.length}</span>
          </div>
          <p className="lg-intro">{s.intro}</p>
          <div className="lg-list">
            {s.entries.map((e) => (
              <details key={e.id} className="lg-entry" id={'learn-' + e.id} open={!!q && s.entries.length <= 3}>
                <summary>
                  <b>{e.title}</b>
                  <span>{e.summary.replace(/\*\*|`/g, '')}</span>
                </summary>
                <div className="lg-body">
                  <EntryBody e={e} />
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      {!q && (sec === 'all') && (
        <section className="card lg-sec" aria-label="What's new">
          <div className="sec-head">
            <div className="sec-title">What's new</div>
          </div>
          <WhatsNew />
        </section>
      )}

      {printing && createPortal(<PrintView />, document.body)}
    </div>
  )
}
