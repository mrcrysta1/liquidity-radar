// The server bot's open trade and live / paper plan for the charted symbol,
// drawn as dashed Entry / SL / TP price lines on the Price Action chart —
// the same hook as the alert lines (features/alerts/alertLines). Off by
// default (Panes menu, overlayToggles). Re-synced on each klines update
// (symbol change), when the price series is rebuilt, when the toggle flips,
// and on a slow poll while it is on.
import { state } from '../../services/store'
import { getPriceSeries, onPriceSeriesChange } from './chartRender'
import { getShowBotTrades, onOverlayTogglesChange } from './overlayToggles'
import { botLevels, botOverlayKey } from '../selflearn/botChart'
import { BOT_POLL_MS, loadBotChart, planFor, SERVER_BOT } from '../selflearn/botChartData'
import type { BotChartData } from '../selflearn/botChartData'

type Any = any

let series: Any = null
let lines: Any[] = []
let lastKey = ''
let data: BotChartData | null = null
let timer: ReturnType<typeof setInterval> | null = null

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

function pull(): void {
  loadBotChart()
    .then((d) => {
      data = d
      syncBotTradeLines()
    })
    .catch(() => {
      /* keep the last good read; the next poll retries */
    })
}

/** Start or stop polling with the toggle. */
function syncPolling(): void {
  const on = SERVER_BOT && getShowBotTrades()
  if (on && !timer) {
    pull()
    timer = setInterval(pull, BOT_POLL_MS)
  } else if (!on && timer) {
    clearInterval(timer)
    timer = null
  }
}

export function syncBotTradeLines(force = false): void {
  const s = getPriceSeries()
  const on = SERVER_BOT && getShowBotTrades() && !!data
  const sym = String(state.symbol || '')
  const key = on && data ? 'on|' + botOverlayKey(data.trades, planFor(data, sym), sym) : 'off'
  if (!force && s === series && key === lastKey) return
  if (s !== series) {
    lines = [] // the old series took its lines with it
    series = s
  } else clear()
  lastKey = key
  if (!series || !on || !data) return
  botLevels(data.trades, planFor(data, sym), sym).forEach((l) => {
    try {
      lines.push(
        series.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: 2, // dashed
          axisLabelVisible: true,
          title: l.title,
        }),
      )
    } catch {
      /* series without price lines — nothing to draw */
    }
  })
}

onOverlayTogglesChange(() => {
  syncPolling()
  syncBotTradeLines()
})
onPriceSeriesChange(() => syncBotTradeLines(true))
syncPolling()
