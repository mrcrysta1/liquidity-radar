// Pine drawing objects — label.*, line.*, box.* and table.* — for the
// runtime (./runtime). Pure: no chart, no DOM, so Node runs it in the
// engine tests.
//
// Objects are references, as in Pine: `label.new` returns an id the script
// keeps (`var label lb = na`, then `label.set_xy(lb, …)` or `lb.set_xy(…)`),
// and an object lives until it is deleted. Past max_labels_count /
// max_lines_count / max_boxes_count (50 by default, 500 at most) the oldest
// go, as Pine's garbage collection does. X positions are bar indexes
// (xloc.bar_index, the default) or times (xloc.bar_time); at the end of a
// run they are turned into times, so the renderer can place them on any
// chart carrying those bars — and past the last bar, into the future.

/** A drawing id, as the script holds it. */
export class DrawRef {
  kind: DrawKind
  id: number
  constructor(kind: DrawKind, id: number) {
    this.kind = kind
    this.id = id
  }
}
export type DrawKind = 'label' | 'line' | 'box' | 'table'
type XLoc = 'bar_index' | 'bar_time'
type Extend = 'none' | 'left' | 'right' | 'both'

interface LabelObj {
  x: number
  y: number
  xloc: XLoc
  yloc: 'price' | 'abovebar' | 'belowbar'
  text: string
  color: string
  textcolor: string
  style: string
  size: string
  textalign: string
  tooltip: string
}
interface LineObj {
  x1: number
  y1: number
  x2: number
  y2: number
  xloc: XLoc
  extend: Extend
  color: string
  style: string
  width: number
}
interface BoxObj {
  left: number
  top: number
  right: number
  bottom: number
  xloc: XLoc
  extend: Extend
  border_color: string
  border_width: number
  border_style: string
  bgcolor: string
  text: string
  text_color: string
  text_size: string
  text_halign: string
  text_valign: string
}
export interface PineTableCell {
  text: string
  bgcolor: string
  text_color: string
  text_size: string
  text_halign: string
  text_valign: string
  tooltip: string
}
interface TableObj {
  position: string
  columns: number
  rows: number
  bgcolor: string
  frame_color: string
  frame_width: number
  border_color: string
  border_width: number
  cells: Map<string, PineTableCell>
}

// ---- what a run hands the renderer (times in ms) ----
export interface PineLabelOut {
  t: number
  y: number
  yloc: LabelObj['yloc']
  text: string
  color: string
  textcolor: string
  style: string
  size: string
  textalign: string
  tooltip: string
}
export interface PineLineOut {
  t1: number
  y1: number
  t2: number
  y2: number
  extend: Extend
  color: string
  style: string
  width: number
}
export interface PineBoxOut {
  t1: number
  t2: number
  top: number
  bottom: number
  extend: Extend
  border_color: string
  border_width: number
  border_style: string
  bgcolor: string
  text: string
  text_color: string
  text_size: string
  text_halign: string
  text_valign: string
}
export interface PineTableOut {
  position: string
  columns: number
  rows: number
  bgcolor: string
  frame_color: string
  frame_width: number
  border_color: string
  border_width: number
  /** rows × columns; null = an empty cell. */
  cells: Array<Array<PineTableCell | null>>
}
export interface PineDrawingsOut {
  labels: PineLabelOut[]
  lines: PineLineOut[]
  boxes: PineBoxOut[]
  tables: PineTableOut[]
}

/** How the runtime reads a call's arguments: positional index, then name. */
export type ArgFn = (i: number, name: string) => unknown
interface Helpers {
  /** A colour value, normalised; '' for na / not a colour. */
  color(v: unknown): string
  num(v: unknown): number
  fail(msg: string): never
}
interface Bar {
  t: number
  h: number
  l: number
}

export const MAX_TABLES = 20
export const DEFAULT_DRAW_LIMIT = 50
export const MAX_DRAW_LIMIT = 500

/** Not a drawing call: the runtime carries on looking. */
export const NOT_DRAWING = Symbol('not-drawing')

const LABEL_SET: Record<string, Array<keyof LabelObj>> = {
  set_x: ['x'],
  set_y: ['y'],
  set_xy: ['x', 'y'],
  set_text: ['text'],
  set_color: ['color'],
  set_textcolor: ['textcolor'],
  set_style: ['style'],
  set_size: ['size'],
  set_textalign: ['textalign'],
  set_tooltip: ['tooltip'],
  set_xloc: ['x', 'xloc'],
  set_yloc: ['yloc'],
  set_text_font_family: [],
}
const LINE_SET: Record<string, Array<keyof LineObj>> = {
  set_x1: ['x1'],
  set_y1: ['y1'],
  set_x2: ['x2'],
  set_y2: ['y2'],
  set_xy1: ['x1', 'y1'],
  set_xy2: ['x2', 'y2'],
  set_color: ['color'],
  set_width: ['width'],
  set_style: ['style'],
  set_extend: ['extend'],
  set_xloc: ['x1', 'x2', 'xloc'],
}
const BOX_SET: Record<string, Array<keyof BoxObj>> = {
  set_left: ['left'],
  set_top: ['top'],
  set_right: ['right'],
  set_bottom: ['bottom'],
  set_lefttop: ['left', 'top'],
  set_rightbottom: ['right', 'bottom'],
  set_border_color: ['border_color'],
  set_border_width: ['border_width'],
  set_border_style: ['border_style'],
  set_bgcolor: ['bgcolor'],
  set_extend: ['extend'],
  set_text: ['text'],
  set_text_color: ['text_color'],
  set_text_size: ['text_size'],
  set_text_halign: ['text_halign'],
  set_text_valign: ['text_valign'],
  set_text_wrap: [],
  set_text_font_family: [],
}
const TABLE_SET: Record<string, Array<keyof TableObj>> = {
  set_position: ['position'],
  set_bgcolor: ['bgcolor'],
  set_frame_color: ['frame_color'],
  set_frame_width: ['frame_width'],
  set_border_color: ['border_color'],
  set_border_width: ['border_width'],
}
const CELL_SET: Record<string, keyof PineTableCell> = {
  cell_set_text: 'text',
  cell_set_bgcolor: 'bgcolor',
  cell_set_text_color: 'text_color',
  cell_set_text_size: 'text_size',
  cell_set_text_halign: 'text_halign',
  cell_set_text_valign: 'text_valign',
  cell_set_tooltip: 'tooltip',
}

const isColorField = (k: string) => /color$/.test(k)
const NUM_FIELDS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'left', 'top', 'right', 'bottom', 'width', 'border_width', 'frame_width', 'columns', 'rows'])

/** A run's drawing objects. */
export function createDrawings(h: Helpers) {
  let seq = 0
  const labels = new Map<number, LabelObj>()
  const lines = new Map<number, LineObj>()
  const boxes = new Map<number, BoxObj>()
  const tables = new Map<number, TableObj>()
  const limit = { label: DEFAULT_DRAW_LIMIT, line: DEFAULT_DRAW_LIMIT, box: DEFAULT_DRAW_LIMIT }
  const mapOf = (k: DrawKind): Map<number, object> =>
    k === 'label' ? labels : k === 'line' ? lines : k === 'box' ? boxes : tables

  const str = (v: unknown, def = '') => (v == null || (typeof v === 'number' && Number.isNaN(v)) ? def : String(v))
  const field = (k: string, v: unknown): unknown =>
    isColorField(k) ? h.color(v) : NUM_FIELDS.has(k) ? h.num(v) : str(v)

  function add<T extends object>(kind: DrawKind, m: Map<number, T>, o: T): DrawRef {
    const id = ++seq
    m.set(id, o)
    if (kind !== 'table') {
      // Pine's garbage collection: the oldest objects past the limit go.
      const max = limit[kind]
      while (m.size > max) m.delete(m.keys().next().value as number)
    } else if (m.size > MAX_TABLES) h.fail(`More than ${MAX_TABLES} tables`)
    return new DrawRef(kind, id)
  }
  /** The object behind a ref; null for na or a deleted object. */
  function obj<T>(ref: unknown, kind: DrawKind): T | null {
    if (!(ref instanceof DrawRef)) {
      if (ref == null || (typeof ref === 'number' && Number.isNaN(ref))) return null
      h.fail(`${kind}.* expects a ${kind} id`)
    }
    const r = ref as DrawRef
    if (r.kind !== kind) h.fail(`Expected a ${kind} id but got a ${r.kind}`)
    return (mapOf(kind).get(r.id) as T) ?? null
  }
  const xlocOf = (v: unknown): XLoc => (v === 'bar_time' ? 'bar_time' : 'bar_index')
  const extendOf = (v: unknown): Extend =>
    v === 'left' || v === 'right' || v === 'both' ? v : 'none'

  /** Handle one `label.*` / `line.*` / `box.*` / `table.*` call. */
  function call(f: string, a: ArgFn): unknown {
    const dot = f.indexOf('.')
    const kind = f.slice(0, dot) as DrawKind
    const fn = f.slice(dot + 1)
    if (!['label', 'line', 'box', 'table'].includes(kind)) return NOT_DRAWING
    if (fn === 'new') {
      if (kind === 'label') {
        const yloc = a(4, 'yloc')
        return add('label', labels, {
          x: h.num(a(0, 'x')),
          y: h.num(a(1, 'y')),
          text: str(a(2, 'text')),
          xloc: xlocOf(a(3, 'xloc')),
          yloc: yloc === 'abovebar' || yloc === 'belowbar' ? yloc : 'price',
          color: a(5, 'color') === undefined ? '#2962ff' : h.color(a(5, 'color')),
          style: str(a(6, 'style'), 'label_down'),
          textcolor: a(7, 'textcolor') === undefined ? '#ffffff' : h.color(a(7, 'textcolor')),
          size: str(a(8, 'size'), 'normal'),
          textalign: str(a(9, 'textalign'), 'center'),
          tooltip: str(a(10, 'tooltip')),
        })
      }
      if (kind === 'line')
        return add('line', lines, {
          x1: h.num(a(0, 'x1')),
          y1: h.num(a(1, 'y1')),
          x2: h.num(a(2, 'x2')),
          y2: h.num(a(3, 'y2')),
          xloc: xlocOf(a(4, 'xloc')),
          extend: extendOf(a(5, 'extend')),
          color: a(6, 'color') === undefined ? '#2962ff' : h.color(a(6, 'color')),
          style: str(a(7, 'style'), 'solid'),
          width: Math.max(1, h.num(a(8, 'width')) || 1),
        })
      if (kind === 'box')
        return add('box', boxes, {
          left: h.num(a(0, 'left')),
          top: h.num(a(1, 'top')),
          right: h.num(a(2, 'right')),
          bottom: h.num(a(3, 'bottom')),
          border_color: a(4, 'border_color') === undefined ? '#2962ff' : h.color(a(4, 'border_color')),
          border_width: a(5, 'border_width') === undefined ? 1 : h.num(a(5, 'border_width')) || 0,
          border_style: str(a(6, 'border_style'), 'solid'),
          extend: extendOf(a(7, 'extend')),
          xloc: xlocOf(a(8, 'xloc')),
          bgcolor: a(9, 'bgcolor') === undefined ? 'rgba(41,98,255,0.20)' : h.color(a(9, 'bgcolor')),
          text: str(a(10, 'text')),
          text_size: str(a(11, 'text_size'), 'auto'),
          text_color: a(12, 'text_color') === undefined ? '#000000' : h.color(a(12, 'text_color')),
          text_halign: str(a(13, 'text_halign'), 'center'),
          text_valign: str(a(14, 'text_valign'), 'center'),
        })
      return add('table', tables, {
        position: str(a(0, 'position'), 'top_right'),
        columns: Math.max(1, Math.min(100, Math.floor(h.num(a(1, 'columns'))) || 1)),
        rows: Math.max(1, Math.min(500, Math.floor(h.num(a(2, 'rows'))) || 1)),
        bgcolor: h.color(a(3, 'bgcolor')),
        frame_color: h.color(a(4, 'frame_color')),
        frame_width: h.num(a(5, 'frame_width')) || 0,
        border_color: h.color(a(6, 'border_color')),
        border_width: h.num(a(7, 'border_width')) || 0,
        cells: new Map(),
      })
    }
    const ref = a(0, 'id')
    if (fn === 'delete') {
      if (ref instanceof DrawRef && ref.kind === kind) mapOf(kind).delete(ref.id)
      return null
    }
    if (fn === 'copy') {
      const o = obj<object>(ref, kind)
      if (!o) return NaN
      const c = kind === 'table' ? { ...o, cells: new Map((o as TableObj).cells) } : { ...o }
      return add(kind, mapOf(kind) as Map<number, object>, c)
    }
    if (kind === 'table') return tableCall(fn, ref, a)
    const setters: Record<string, string[]> = kind === 'label' ? LABEL_SET : kind === 'line' ? LINE_SET : BOX_SET
    const fields = setters[fn]
    if (fields) {
      const o = obj<Record<string, unknown>>(ref, kind)
      if (!o) return null
      fields.forEach((k, i) => {
        // Named forms differ by setter (`box.set_bgcolor(id, color=…)`).
        let v = a(i + 1, k)
        if (v === undefined && isColorField(k)) v = a(-1, 'color')
        if (k === 'xloc') o.xloc = xlocOf(v)
        else if (k === 'extend') o.extend = extendOf(v)
        else o[k] = field(k, v)
      })
      return null
    }
    if (fn.startsWith('get_')) {
      const k = fn.slice(4)
      const o = obj<Record<string, unknown>>(ref, kind)
      if (kind === 'line' && k === 'price') {
        if (!o) return NaN
        const l = o as unknown as LineObj
        const x = h.num(a(1, 'x'))
        return l.x2 === l.x1 ? l.y1 : l.y1 + ((l.y2 - l.y1) * (x - l.x1)) / (l.x2 - l.x1)
      }
      if (!o || !(k in o)) return NaN
      return o[k]
    }
    return NOT_DRAWING
  }

  function tableCall(fn: string, ref: unknown, a: ArgFn): unknown {
    const t = obj<TableObj>(ref, 'table')
    if (fn === 'cell') {
      if (!t) return null
      const col = Math.floor(h.num(a(1, 'column')))
      const row = Math.floor(h.num(a(2, 'row')))
      if (!(col >= 0 && col < t.columns && row >= 0 && row < t.rows))
        h.fail(`table.cell: cell (${col}, ${row}) is outside the ${t.columns}×${t.rows} table`)
      t.cells.set(col + ',' + row, {
        text: str(a(3, 'text')),
        text_color: a(6, 'text_color') === undefined ? '#000000' : h.color(a(6, 'text_color')),
        text_halign: str(a(7, 'text_halign'), 'center'),
        text_valign: str(a(8, 'text_valign'), 'center'),
        text_size: str(a(9, 'text_size'), 'normal'),
        bgcolor: h.color(a(10, 'bgcolor')),
        tooltip: str(a(11, 'tooltip')),
      })
      return null
    }
    const cellField = CELL_SET[fn]
    if (cellField) {
      if (!t) return null
      const key = Math.floor(h.num(a(1, 'column'))) + ',' + Math.floor(h.num(a(2, 'row')))
      const cell = t.cells.get(key)
      const v = a(3, cellField)
      if (cell) cell[cellField] = (isColorField(cellField) ? h.color(v) : str(v)) as never
      return null
    }
    if (fn === 'clear') {
      if (!t) return null
      const c0 = Math.floor(h.num(a(1, 'start_column')) || 0)
      const r0 = Math.floor(h.num(a(2, 'start_row')) || 0)
      const c1v = a(3, 'end_column')
      const r1v = a(4, 'end_row')
      const c1 = c1v === undefined ? c0 : Math.floor(h.num(c1v))
      const r1 = r1v === undefined ? r0 : Math.floor(h.num(r1v))
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) t.cells.delete(c + ',' + r)
      return null
    }
    if (fn === 'merge_cells') return null
    const fields = TABLE_SET[fn]
    if (fields) {
      if (!t) return null
      const k = fields[0]
      ;(t as unknown as Record<string, unknown>)[k] = field(k, a(1, k))
      return null
    }
    return NOT_DRAWING
  }

  /** `label.all` & co: the live objects' ids, oldest first. */
  function all(kind: DrawKind): DrawRef[] {
    return [...mapOf(kind).keys()].map((id) => new DrawRef(kind, id))
  }

  function setLimits(l: { label?: number; line?: number; box?: number }): void {
    const clamp = (v: number | undefined, d: number) =>
      v == null || !isFinite(v) ? d : Math.max(1, Math.min(MAX_DRAW_LIMIT, Math.floor(v)))
    limit.label = clamp(l.label, limit.label)
    limit.line = clamp(l.line, limit.line)
    limit.box = clamp(l.box, limit.box)
  }

  /** Everything still alive, x positions as times over `bars`. */
  function output(bars: Bar[]): PineDrawingsOut | undefined {
    if (!labels.size && !lines.size && !boxes.size && !tables.size) return undefined
    const n = bars.length
    const step = n > 1 ? bars[n - 1].t - bars[n - 2].t : 60000
    const timeOf = (x: number, xloc: XLoc): number => {
      if (xloc === 'bar_time') return x
      const i = Math.round(x)
      if (i >= 0 && i < n) return bars[i].t
      return i >= n ? bars[n - 1].t + (i - n + 1) * step : bars[0].t + i * step
    }
    const barAt = (x: number, xloc: XLoc): Bar | undefined => {
      if (xloc === 'bar_index') return bars[Math.round(x)]
      let lo = 0
      let hi = n - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (bars[mid].t <= x) lo = mid
        else hi = mid - 1
      }
      return bars[lo]?.t === x ? bars[lo] : undefined
    }
    const ok = (...v: number[]) => v.every((x) => isFinite(x))
    const out: PineDrawingsOut = { labels: [], lines: [], boxes: [], tables: [] }
    for (const l of labels.values()) {
      let y = l.y
      if (l.yloc !== 'price') {
        const b = barAt(l.x, l.xloc)
        y = b ? (l.yloc === 'abovebar' ? b.h : b.l) : NaN
      }
      if (!ok(l.x, y)) continue
      out.labels.push({
        t: timeOf(l.x, l.xloc),
        y,
        yloc: l.yloc,
        text: l.text,
        color: l.color,
        textcolor: l.textcolor,
        style: l.style,
        size: l.size,
        textalign: l.textalign,
        tooltip: l.tooltip,
      })
    }
    for (const l of lines.values()) {
      if (!ok(l.x1, l.y1, l.x2, l.y2)) continue
      out.lines.push({
        t1: timeOf(l.x1, l.xloc),
        y1: l.y1,
        t2: timeOf(l.x2, l.xloc),
        y2: l.y2,
        extend: l.extend,
        color: l.color,
        style: l.style,
        width: l.width,
      })
    }
    for (const b of boxes.values()) {
      if (!ok(b.left, b.top, b.right, b.bottom)) continue
      out.boxes.push({
        t1: timeOf(b.left, b.xloc),
        t2: timeOf(b.right, b.xloc),
        top: b.top,
        bottom: b.bottom,
        extend: b.extend,
        border_color: b.border_color,
        border_width: b.border_width,
        border_style: b.border_style,
        bgcolor: b.bgcolor,
        text: b.text,
        text_color: b.text_color,
        text_size: b.text_size,
        text_halign: b.text_halign,
        text_valign: b.text_valign,
      })
    }
    for (const t of tables.values()) {
      const cells: Array<Array<PineTableCell | null>> = []
      for (let r = 0; r < t.rows; r++) {
        const row: Array<PineTableCell | null> = []
        for (let c = 0; c < t.columns; c++) row.push(t.cells.get(c + ',' + r) ?? null)
        cells.push(row)
      }
      // Trailing empty rows and columns take no room, as on TradingView.
      while (cells.length && cells[cells.length - 1].every((x) => !x)) cells.pop()
      let cols = t.columns
      while (cols > 0 && cells.every((row) => !row[cols - 1])) cols--
      if (!cells.length || !cols) continue
      out.tables.push({
        position: t.position,
        columns: cols,
        rows: cells.length,
        bgcolor: t.bgcolor,
        frame_color: t.frame_color,
        frame_width: t.frame_width,
        border_color: t.border_color,
        border_width: t.border_width,
        cells: cells.map((row) => row.slice(0, cols)),
      })
    }
    return out
  }

  return { call, all, setLimits, output }
}
export type Drawings = ReturnType<typeof createDrawings>
