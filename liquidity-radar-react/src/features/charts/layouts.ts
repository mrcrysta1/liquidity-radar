// Multi-chart layouts for the price-action section.
//
// Same idea as the Pro terminal's chart grid (useCharts.setLayout): pick a
// count, get that many charts in a grid. Cell 1 is always the main
// price-action chart — it keeps its indicators, drawings, toolbar and
// full-screen wiring — and cells 2..n are companion charts with their own
// symbol and interval.
//
// A spec is a column count plus a per-cell column span, which is enough to
// describe every arrangement here and is also what draws the menu's glyphs, so
// a glyph can never disagree with the grid it produces.
export interface LayoutSpec {
  n: number
  cols: number
  /** Column span per cell; absent means every cell spans one. */
  spans?: number[]
}

export const LAYOUTS: LayoutSpec[] = [
  { n: 1, cols: 1 },
  { n: 2, cols: 2 },
  { n: 3, cols: 3 },
  { n: 4, cols: 2 },
  { n: 5, cols: 3, spans: [2, 1, 1, 1, 1] },
  { n: 6, cols: 3 },
  { n: 7, cols: 4, spans: [2, 1, 1, 1, 1, 1, 1] },
  { n: 8, cols: 4 },
  { n: 9, cols: 3 },
  { n: 10, cols: 5 },
  { n: 12, cols: 4 },
  { n: 14, cols: 4, spans: [2, 2] },
  { n: 16, cols: 4 },
]

export const MAX_CHARTS = 16
export const DEFAULT_LAYOUT = 1

const BY_N: Record<number, LayoutSpec> = {}
LAYOUTS.forEach((l) => {
  BY_N[l.n] = l
})

export function layoutSpec(n: unknown): LayoutSpec {
  return BY_N[Number(n)] || BY_N[DEFAULT_LAYOUT]
}

export function spanOf(spec: LayoutSpec, i: number): number {
  const s = spec.spans && spec.spans[i]
  return s && s > 0 ? Math.min(s, spec.cols) : 1
}

/** Cell rectangles in grid units, for laying out the grid and drawing glyphs. */
export interface Cell {
  col: number
  row: number
  span: number
}
export function cells(spec: LayoutSpec): Cell[] {
  const out: Cell[] = []
  let col = 0
  let row = 0
  for (let i = 0; i < spec.n; i++) {
    const span = spanOf(spec, i)
    if (col + span > spec.cols) {
      col = 0
      row++
    }
    out.push({ col, row, span })
    col += span
    if (col >= spec.cols) {
      col = 0
      row++
    }
  }
  return out
}

export function rowCount(spec: LayoutSpec): number {
  const c = cells(spec)
  return c.length ? Math.max(...c.map((x) => x.row)) + 1 : 1
}
