// Catalogue of drawing tools for the price-action chart, grouped the way
// TradingView groups its drawing toolbar.
//
// `points` is how many clicks the shape takes. `0` means open-ended: click to
// add points and double-click (or press Enter) to finish. `-1` is freehand —
// press, drag, release.
export type DrawGroup =
  | 'Lines'
  | 'Channels'
  | 'Fibonacci'
  | 'Gann'
  | 'Shapes'
  | 'Patterns'
  | 'Projection'
  | 'Annotation'
  | 'Edit'

export interface DrawToolDef {
  id: string
  name: string
  group: DrawGroup
  hint: string
  points: number
  /** Default stroke, resolved against the palette at draw time. */
  color?: string
  /** Prompts for a caption when placed. */
  text?: boolean
}

const AMBER = '#FFD54F'
const CYAN = '#4FC3F7'
const PURPLE = '#B388FF'
const GREEN = '#34C38F'
const RED = '#FF5252'
const ORANGE = '#F0A04B'

export const DRAW_TOOLS: DrawToolDef[] = [
  // ---- Lines ----
  { id: 'trend', name: 'Trend line', group: 'Lines', hint: 'Two points', points: 2, color: CYAN },
  { id: 'ray', name: 'Ray', group: 'Lines', hint: 'Extends forward', points: 2, color: CYAN },
  {
    id: 'extended',
    name: 'Extended line',
    group: 'Lines',
    hint: 'Extends both ways',
    points: 2,
    color: CYAN,
  },
  {
    id: 'arrow',
    name: 'Arrow',
    group: 'Lines',
    hint: 'Trend line with a head',
    points: 2,
    color: CYAN,
  },
  {
    id: 'hline',
    name: 'Horizontal line',
    group: 'Lines',
    hint: 'A price level',
    points: 1,
    color: AMBER,
  },
  {
    id: 'hray',
    name: 'Horizontal ray',
    group: 'Lines',
    hint: 'Level, forward only',
    points: 1,
    color: AMBER,
  },
  {
    id: 'vline',
    name: 'Vertical line',
    group: 'Lines',
    hint: 'Mark a moment',
    points: 1,
    color: AMBER,
  },
  {
    id: 'cross',
    name: 'Cross line',
    group: 'Lines',
    hint: 'Price and time',
    points: 1,
    color: AMBER,
  },
  {
    id: 'infoline',
    name: 'Info line',
    group: 'Lines',
    hint: 'Shows move and bars',
    points: 2,
    color: CYAN,
  },

  // ---- Channels ----
  {
    id: 'parallel',
    name: 'Parallel channel',
    group: 'Channels',
    hint: 'Two points, then width',
    points: 3,
    color: PURPLE,
  },
  {
    id: 'flatchannel',
    name: 'Flat channel',
    group: 'Channels',
    hint: 'Two horizontal bounds',
    points: 2,
    color: PURPLE,
  },
  {
    id: 'regression',
    name: 'Regression trend',
    group: 'Channels',
    hint: 'Best fit with 2σ bands',
    points: 2,
    color: PURPLE,
  },
  {
    id: 'pitchfork',
    name: "Andrews' pitchfork",
    group: 'Channels',
    hint: 'Three pivots',
    points: 3,
    color: PURPLE,
  },

  // ---- Fibonacci ----
  {
    id: 'fibretr',
    name: 'Fib retracement',
    group: 'Fibonacci',
    hint: 'Swing high to low',
    points: 2,
    color: ORANGE,
  },
  {
    id: 'fibext',
    name: 'Fib extension',
    group: 'Fibonacci',
    hint: 'Three points',
    points: 3,
    color: ORANGE,
  },
  {
    id: 'fibfan',
    name: 'Fib fan',
    group: 'Fibonacci',
    hint: 'Rays at fib ratios',
    points: 2,
    color: ORANGE,
  },
  {
    id: 'fibtime',
    name: 'Fib time zones',
    group: 'Fibonacci',
    hint: 'Verticals at fib spacing',
    points: 2,
    color: ORANGE,
  },
  {
    id: 'fibcircle',
    name: 'Fib circles',
    group: 'Fibonacci',
    hint: 'Arcs at fib radii',
    points: 2,
    color: ORANGE,
  },

  // ---- Gann ----
  {
    id: 'gannfan',
    name: 'Gann fan',
    group: 'Gann',
    hint: '1/1, 2/1, 1/2 …',
    points: 2,
    color: GREEN,
  },
  {
    id: 'gannbox',
    name: 'Gann box',
    group: 'Gann',
    hint: 'Grid of fib divisions',
    points: 2,
    color: GREEN,
  },

  // ---- Shapes ----
  { id: 'rect', name: 'Rectangle', group: 'Shapes', hint: 'Zone or area', points: 2, color: CYAN },
  {
    id: 'ellipse',
    name: 'Ellipse',
    group: 'Shapes',
    hint: 'Circle a region',
    points: 2,
    color: CYAN,
  },
  {
    id: 'triangle',
    name: 'Triangle',
    group: 'Shapes',
    hint: 'Three corners',
    points: 3,
    color: CYAN,
  },
  {
    id: 'polyline',
    name: 'Polyline',
    group: 'Shapes',
    hint: 'Many points, dbl-click to end',
    points: 0,
    color: CYAN,
  },
  {
    id: 'brush',
    name: 'Brush',
    group: 'Shapes',
    hint: 'Freehand — drag to draw',
    points: -1,
    color: CYAN,
  },

  // ---- Patterns ----
  {
    id: 'abcd',
    name: 'ABCD pattern',
    group: 'Patterns',
    hint: 'Four pivots',
    points: 4,
    color: PURPLE,
  },
  {
    id: 'xabcd',
    name: 'XABCD pattern',
    group: 'Patterns',
    hint: 'Five pivots',
    points: 5,
    color: PURPLE,
  },
  {
    id: 'headshoulders',
    name: 'Head & shoulders',
    group: 'Patterns',
    hint: 'Seven pivots',
    points: 7,
    color: PURPLE,
  },
  {
    id: 'elliott5',
    name: 'Elliott impulse (1–5)',
    group: 'Patterns',
    hint: 'Six pivots',
    points: 6,
    color: PURPLE,
  },
  {
    id: 'elliottabc',
    name: 'Elliott correction (ABC)',
    group: 'Patterns',
    hint: 'Four pivots',
    points: 4,
    color: PURPLE,
  },

  // ---- Projection / measuring ----
  {
    id: 'long',
    name: 'Long position',
    group: 'Projection',
    hint: 'Entry then target',
    points: 2,
    color: GREEN,
  },
  {
    id: 'short',
    name: 'Short position',
    group: 'Projection',
    hint: 'Entry then target',
    points: 2,
    color: RED,
  },
  {
    id: 'measure',
    name: 'Measure',
    group: 'Projection',
    hint: 'Move, % and bars',
    points: 2,
    color: CYAN,
  },
  {
    id: 'pricerange',
    name: 'Price range',
    group: 'Projection',
    hint: 'Vertical span',
    points: 2,
    color: CYAN,
  },
  {
    id: 'daterange',
    name: 'Date range',
    group: 'Projection',
    hint: 'Horizontal span',
    points: 2,
    color: CYAN,
  },

  // ---- Annotation ----
  {
    id: 'text',
    name: 'Text',
    group: 'Annotation',
    hint: 'A note on the chart',
    points: 1,
    color: AMBER,
    text: true,
  },
  {
    id: 'callout',
    name: 'Callout',
    group: 'Annotation',
    hint: 'Note with a leader line',
    points: 2,
    color: AMBER,
    text: true,
  },
  {
    id: 'markerup',
    name: 'Arrow up',
    group: 'Annotation',
    hint: 'Mark a bar',
    points: 1,
    color: GREEN,
  },
  {
    id: 'markerdown',
    name: 'Arrow down',
    group: 'Annotation',
    hint: 'Mark a bar',
    points: 1,
    color: RED,
  },
  {
    id: 'pricelabel',
    name: 'Price label',
    group: 'Annotation',
    hint: 'Tag a price',
    points: 1,
    color: AMBER,
  },

  // ---- Edit ----
  { id: 'erase', name: 'Eraser', group: 'Edit', hint: 'Click a drawing to remove it', points: 1 },
]

export const DRAW_GROUPS: DrawGroup[] = [
  'Lines',
  'Channels',
  'Fibonacci',
  'Gann',
  'Shapes',
  'Patterns',
  'Projection',
  'Annotation',
  'Edit',
]

const BY_ID: Record<string, DrawToolDef> = {}
DRAW_TOOLS.forEach((t) => {
  BY_ID[t.id] = t
})
export function drawToolDef(id: unknown): DrawToolDef | null {
  return BY_ID[String(id ?? '')] || null
}
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
export const FIB_EXT_LEVELS = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.618]
