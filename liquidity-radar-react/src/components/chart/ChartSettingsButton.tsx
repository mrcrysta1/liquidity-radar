// The gear in the chart's right rail: TradingView's "Chart settings", in its
// four sections — Symbol (candle colours, last-price line), Status line (what
// the legend shows), Scales (labels, countdown) and Canvas (background, grid,
// crosshair, watermark). Saved per browser (features/charts/chartSettings)
// and applied to the main chart and every layout cell.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  chartSettings,
  resetChartSettings,
  setChartSetting,
  subscribeChartSettings,
} from '../../features/charts/chartSettings'
import type { ChartSettings } from '../../features/charts/chartSettings'
import { chartPalette } from '../../features/charts/chartPalette'

type BoolKey = {
  [K in keyof ChartSettings]: ChartSettings[K] extends boolean ? K : never
}[keyof ChartSettings]
type ColorKey = 'bodyUp' | 'bodyDown' | 'borderUp' | 'borderDown' | 'wickUp' | 'wickDown'

const SECTIONS = ['Symbol', 'Status line', 'Scales', 'Canvas'] as const
type Section = (typeof SECTIONS)[number]

function Toggle({ k, label, hint }: { k: BoolKey; label: string; hint?: string }) {
  return (
    <li>
      <label>
        <input
          type="checkbox"
          checked={chartSettings()[k]}
          onChange={(e) => setChartSetting(k, e.target.checked)}
        />
        <span>
          <b>{label}</b>
          {hint && <small>{hint}</small>}
        </span>
      </label>
    </li>
  )
}

/** One row of up / down colour swatches; '' (palette colour) shows the palette's. */
function ColorPair({ label, up, down }: { label: string; up: ColorKey; down: ColorKey }) {
  const st = chartSettings()
  const pal = chartPalette()
  // <input type=color> only takes #rrggbb; the palette's may be rgba() or a
  // CSS variable's value, which then shows black until a colour is picked.
  const hex = (v: string, fb: string) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{6}$/i.test(fb) ? fb : '#000000')
  return (
    <li className="cset-row">
      <span className="cset-row-label">{label}</span>
      <input
        type="color"
        aria-label={label + ' up'}
        title="Up"
        value={hex(st[up], pal.up)}
        onChange={(e) => setChartSetting(up, e.target.value)}
      />
      <input
        type="color"
        aria-label={label + ' down'}
        title="Down"
        value={hex(st[down], pal.dn)}
        onChange={(e) => setChartSetting(down, e.target.value)}
      />
      {(st[up] || st[down]) && (
        <button
          type="button"
          className="cset-clear"
          onClick={() => {
            setChartSetting(up, '')
            setChartSetting(down, '')
          }}
        >
          Theme
        </button>
      )}
    </li>
  )
}

function Choice<K extends 'priceLabels' | 'background' | 'crosshair'>({
  k,
  label,
  options,
}: {
  k: K
  label: string
  options: Array<[ChartSettings[K], string]>
}) {
  return (
    <li className="cset-row">
      <span className="cset-row-label">{label}</span>
      <select
        aria-label={label}
        value={chartSettings()[k]}
        onChange={(e) => setChartSetting(k, e.target.value as ChartSettings[K])}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </li>
  )
}

function SectionBody({ section }: { section: Section }): ReactNode {
  const st = chartSettings()
  if (section === 'Symbol')
    return (
      <ul>
        <ColorPair label="Body" up="bodyUp" down="bodyDown" />
        <ColorPair label="Borders" up="borderUp" down="borderDown" />
        <ColorPair label="Wick" up="wickUp" down="wickDown" />
        <Toggle k="priceLine" label="Last price line" hint="Dotted line at the live price" />
        <li className="cset-note">Hollow candles keep their own body colours; line styles use the theme.</li>
      </ul>
    )
  if (section === 'Status line')
    return (
      <ul>
        <Toggle k="legendOhlc" label="OHLC values" hint="Open, high, low and close of the bar" />
        <Toggle k="legendChange" label="Bar change" hint="Change from the previous close, and %" />
        <Toggle k="legendVolume" label="Volume" />
        <Toggle k="legendIndicators" label="Indicator values" hint="Names stay; the numbers hide" />
      </ul>
    )
  if (section === 'Scales')
    return (
      <ul>
        <Choice
          k="priceLabels"
          label="Price labels"
          options={[
            ['aligned', 'Keep apart'],
            ['exact', 'At exact price'],
          ]}
        />
        <Toggle k="symbolLabel" label="Symbol last-price label" hint="The live price on the scale" />
        <Toggle k="indicatorLabels" label="Indicator labels" hint="Pane indicators’ values on their scale" />
        <Toggle k="countdown" label="Bar countdown" hint="Time left in the bar, under the price label" />
      </ul>
    )
  return (
    <ul>
      <Choice
        k="background"
        label="Background"
        options={[
          ['theme', 'Theme'],
          ['solid', 'Solid'],
          ['gradient', 'Gradient'],
        ]}
      />
      {st.background !== 'theme' && (
        <li className="cset-row">
          <span className="cset-row-label">{st.background === 'gradient' ? 'Top / bottom' : 'Colour'}</span>
          <input
            type="color"
            aria-label="Background colour"
            value={st.bgColor}
            onChange={(e) => setChartSetting('bgColor', e.target.value)}
          />
          {st.background === 'gradient' && (
            <input
              type="color"
              aria-label="Background bottom colour"
              value={st.bgColor2}
              onChange={(e) => setChartSetting('bgColor2', e.target.value)}
            />
          )}
        </li>
      )}
      <Toggle k="gridVert" label="Vertical grid lines" />
      <Toggle k="gridHorz" label="Horizontal grid lines" />
      <Choice
        k="crosshair"
        label="Crosshair"
        options={[
          ['dashed', 'Dashed'],
          ['dotted', 'Dotted'],
          ['solid', 'Solid'],
        ]}
      />
      <Toggle k="magnet" label="Magnet crosshair" hint="The crosshair snaps to the bar’s close" />
      <Toggle k="watermark" label="Symbol watermark" hint="Symbol and interval faintly behind the chart" />
    </ul>
  )
}

export function ChartSettingsButton() {
  const [, force] = useState(0)
  useEffect(() => subscribeChartSettings(() => force((n) => n + 1)), [])
  const [section, setSection] = useState<Section>('Symbol')
  const ref = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button
        type="button"
        className="cs-rail-btn"
        aria-label="Chart settings"
        aria-haspopup="dialog"
        onClick={() => ref.current?.showModal()}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span className="cs-rail-tip">Chart settings</span>
      </button>
      <dialog
        ref={ref}
        className="cset-dialog"
        aria-label="Chart settings"
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (e.target === ref.current) ref.current?.close()
        }}
      >
        <header>
          <b>Chart settings</b>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}>
            ×
          </button>
        </header>
        <div className="cset-body">
          <nav className="cset-nav" role="tablist" aria-label="Chart settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={s === section}
                className={s === section ? 'on' : ''}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </nav>
          <div className="cset-pane" role="tabpanel" aria-label={section}>
            <SectionBody section={section} />
          </div>
        </div>
        <footer>
          <button type="button" className="cset-reset" onClick={resetChartSettings}>
            Reset to defaults
          </button>
          <button type="button" className="cset-done" onClick={() => ref.current?.close()}>
            Done
          </button>
        </footer>
      </dialog>
    </>
  )
}
