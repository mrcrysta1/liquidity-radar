// The link-group chip in a chart's header (features/charts/linkGroups): a
// coloured dot naming the chart's group. Clicking it lays the choices out
// inline — none, red, blue, green — rather than in a popup, because layout
// cells clip their overflow. The HTML-built companion cells and the main
// chart get it through ./mountLinkChip.
import { useState, useSyncExternalStore } from 'react'
import {
  LINK_COLORS,
  LINK_GROUP_IDS,
  LINK_NAMES,
  getLinkGroup,
  setLinkGroup,
  subscribeLinks,
} from '../../features/charts/linkGroups'
import type { LinkGroup } from '../../features/charts/linkGroups'

const nameOf = (g: LinkGroup) => (g ? LINK_NAMES[g] + ' group' : 'Not linked')

function Dot({ g }: { g: LinkGroup }) {
  return (
    <i
      className={'lk-dot' + (g ? '' : ' none')}
      style={g ? { background: LINK_COLORS[g] } : undefined}
      aria-hidden="true"
    >
      {g || ''}
    </i>
  )
}

export function LinkChip({ linkKey }: { linkKey: string }) {
  const group = useSyncExternalStore(subscribeLinks, () => getLinkGroup(linkKey))
  const [open, setOpen] = useState(false)
  // A layout cell is a button that activates its chart: the chip's clicks
  // and keys are its own.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  if (!open)
    return (
      <span className="lk-chip" onClick={stop} onKeyDown={stop} onPointerDown={stop}>
        <button
          type="button"
          className="lk-btn"
          title={'Link group: ' + nameOf(group) + '. Linked charts follow each other'}
          aria-label={'Link group: ' + nameOf(group)}
          onClick={() => setOpen(true)}
        >
          <Dot g={group} />
        </button>
      </span>
    )
  const pick = (g: LinkGroup) => {
    setLinkGroup(linkKey, g)
    setOpen(false)
  }
  return (
    <span
      className="lk-chip open"
      role="group"
      aria-label="Link group"
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') setOpen(false)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      {([null] as LinkGroup[]).concat(LINK_GROUP_IDS).map((g, i) => (
        <button
          key={g || 'none'}
          type="button"
          className={'lk-btn' + (g === group ? ' sel' : '')}
          title={nameOf(g)}
          aria-label={nameOf(g)}
          aria-pressed={g === group}
          autoFocus={i === 0}
          onClick={() => pick(g)}
        >
          <Dot g={g} />
        </button>
      ))}
    </span>
  )
}
