// The indicators button in every multi-chart panel header.
//
// Panel headers are built by the chart modules (companionCharts for the
// layouts around the main chart, multiCharts for the Market workspace), each
// with an empty `[data-ind-slot]` placeholder. This finds those placeholders
// whenever either grid changes and portals the regular IndicatorPicker into
// each, bound to that panel's own indicator store.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IndicatorPicker } from './IndicatorPicker'
import { isPanelSlot, panelIndicatorStore } from '../../features/charts/indicators/panelStore'
import { subscribeLayout } from '../../features/charts/companionCharts'
import { onMcChange } from '../../features/charts/multiCharts'

interface Mount {
  el: HTMLElement
  slot: string
  key: string
}

// A placeholder keeps its React key for as long as it is in the page, so a
// scan that finds it again leaves its picker (and an open menu) alone.
const ids = new WeakMap<HTMLElement, number>()
let nextId = 0

function scan(): Mount[] {
  const out: Mount[] = []
  document.querySelectorAll<HTMLElement>('[data-ind-slot]').forEach((el) => {
    const slot = el.dataset.indSlot || ''
    if (!isPanelSlot(slot)) return
    let id = ids.get(el)
    if (id === undefined) {
      id = nextId++
      ids.set(el, id)
    }
    out.push({ el, slot, key: slot + ':' + id })
  })
  return out
}

const same = (a: Mount[], b: Mount[]) =>
  a.length === b.length && a.every((m, i) => m.key === b[i].key)

export function PanelIndicatorButtons() {
  const [mounts, setMounts] = useState<Mount[]>([])
  useEffect(() => {
    const update = () => {
      const next = scan()
      setMounts((prev) => (same(prev, next) ? prev : next))
    }
    update()
    const offLayout = subscribeLayout(update)
    const offMc = onMcChange(update)
    return () => {
      offLayout()
      offMc()
    }
  }, [])
  return (
    <>
      {mounts.map((m) =>
        createPortal(
          <IndicatorPicker
            store={panelIndicatorStore(m.slot)}
            variant="panel"
            chartLabel={m.el.dataset.indLabel}
          />,
          m.el,
          m.key,
        ),
      )}
    </>
  )
}
