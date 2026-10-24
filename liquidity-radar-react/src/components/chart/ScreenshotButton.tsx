// Camera button on the price-chart toolbar: saves the main chart, overlays
// included, as a PNG — TradingView's "Take a snapshot".
import { chartScreenshot } from '../../features/charts/chartRender'
import { state } from '../../services/store'
import { baseOf } from '../../utils/coins'
import { showToast } from '../../utils/dom'

function savePng(canvas: HTMLCanvasElement, name: string) {
  canvas.toBlob((b) => {
    if (!b) return
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, 'image/png')
}

export function ScreenshotButton() {
  const shoot = () => {
    const c = chartScreenshot()
    if (!c) {
      showToast('Chart is not ready yet')
      return
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(':', '')
    savePng(c, baseOf(state.symbol) + '-' + state.tf + '-' + stamp + '.png')
  }
  return (
    <button
      type="button"
      className="chart-tool-btn tvb-icon shot-btn"
      aria-label="Take a snapshot (PNG)"
      onClick={shoot}
    >
      <svg viewBox="0 0 28 28" width="20" height="20" aria-hidden="true">
        <path
          d="M10.5 7.5 9 9.5H6.5A1.5 1.5 0 0 0 5 11v9a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 23 20v-9a1.5 1.5 0 0 0-1.5-1.5H19l-1.5-2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="14" cy="15.5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <span className="tvb-tip">Take a snapshot</span>
    </button>
  )
}
