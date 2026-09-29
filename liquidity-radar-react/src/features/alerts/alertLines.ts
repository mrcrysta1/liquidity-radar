// Price alerts for the charted symbol, drawn as dashed horizontal lines on the
// Price Action chart (series.createPriceLine). Re-synced when the alerts
// change, the symbol changes (syncAlertLines from the klines hook) or the
// chart rebuilds its price series for a new style.
import { state } from '../../services/store'
import { getPriceSeries, onPriceSeriesChange } from '../charts/chartRender'
import { loadRules, onAlertsChange } from './alerts'
import { LEVEL_CONDS } from './rules'

type Any = any

let series: Any = null
let lines: Any[] = []
let lastKey = ''

function clear(): void {
  if (series) {
    lines.forEach((l) => {
      try {
        series.removePriceLine(l)
      } catch {
        /* series already gone */
      }
    })
  }
  lines = []
}

export function syncAlertLines(force = false): void {
  const s = getPriceSeries()
  const rules = loadRules().filter(
    (r) => r.enabled && r.kind === 'price' && r.sym === state.symbol && LEVEL_CONDS.includes(r.condition),
  )
  const key = state.symbol + '|' + rules.map((r) => r.id + ':' + r.condition + ':' + r.value).join(',')
  if (!force && s === series && key === lastKey) return
  if (s !== series) {
    lines = [] // the old series took its lines with it
    series = s
  } else clear()
  lastKey = key
  if (!series) return
  rules.forEach((r) => {
    const up = r.condition === 'above' || r.condition === 'crosses_above'
    try {
      lines.push(
        series.createPriceLine({
          price: r.value,
          color: '#f5a623',
          lineWidth: 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: 'Alert ' + (up ? '▲' : '▼'),
        }),
      )
    } catch {
      /* series without price lines — nothing to draw */
    }
  })
}

onAlertsChange(() => syncAlertLines())
onPriceSeriesChange(() => syncAlertLines(true))
