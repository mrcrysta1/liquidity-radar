// The "Objects" side panel: TradingView's object tree for the coin on screen.
// Every drawing, front-most first, with show / hide, lock and delete; a click
// selects it on the chart (and shows it again if it was hidden).
import { useEffect, useState } from 'react'
import { drawingCommand, drawingList, subscribeDrawTools } from '../../features/charts/drawTools'

const EYE = 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z'
const EYE_OFF =
  'M4 4l16 16M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.3M6.4 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9'
const LOCK = 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13Z'
const UNLOCK = 'M7 11V8a5 5 0 0 1 9.6-2M5.5 11h13v9h-13Z'
const DEL = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DrawingObjectsPanel() {
  const [, force] = useState(0)
  useEffect(() => subscribeDrawTools(() => force((n) => n + 1)), [])
  const list = drawingList()
  if (!list.length)
    return <div className="cs-empty">No drawings on this coin yet. Pick a tool from the left toolbar.</div>
  // Front-most first, as the object tree reads top to bottom; `i` stays the
  // index in the coin's (back-to-front) list the chart works with.
  const rows = list.map((d, i) => ({ d, i })).reverse()
  return (
    <>
      <ul className="obj-tree" aria-label="Drawings on this chart">
        {rows.map(({ d, i }) => (
          <li key={i} className={'obj-row' + (d.selected ? ' sel' : '') + (d.hidden ? ' off' : '')}>
            <button
              type="button"
              className="obj-name"
              aria-current={d.selected || undefined}
              onClick={() => drawingCommand({ kind: 'select', i })}
              title="Select on the chart"
            >
              <i style={{ background: d.color }} aria-hidden="true" />
              <span>{d.name}</span>
            </button>
            <button
              type="button"
              className="obj-act"
              aria-pressed={!d.hidden}
              aria-label={(d.hidden ? 'Show ' : 'Hide ') + d.name}
              title={d.hidden ? 'Show' : 'Hide'}
              onClick={() => drawingCommand({ kind: 'toggle', flag: 'hidden', i })}
            >
              <Icon d={d.hidden ? EYE_OFF : EYE} />
            </button>
            <button
              type="button"
              className={'obj-act' + (d.locked ? ' on' : '')}
              aria-pressed={d.locked}
              aria-label={(d.locked ? 'Unlock ' : 'Lock ') + d.name}
              title={d.locked ? 'Unlock' : 'Lock'}
              onClick={() => drawingCommand({ kind: 'toggle', flag: 'locked', i })}
            >
              <Icon d={d.locked ? LOCK : UNLOCK} />
            </button>
            <button
              type="button"
              className="obj-act obj-del"
              aria-label={'Delete ' + d.name}
              title="Delete"
              onClick={() => drawingCommand({ kind: 'delete', i })}
            >
              <Icon d={DEL} />
            </button>
          </li>
        ))}
      </ul>
      <p className="cs-note">
        {list.length} drawing{list.length === 1 ? '' : 's'} · locked ones cannot be moved or erased.
      </p>
    </>
  )
}
