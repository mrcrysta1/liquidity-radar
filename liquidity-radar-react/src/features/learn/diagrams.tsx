// Small drawn illustrations for the Learning library. Plain SVG in theme
// colours, so they read in dark mode, light mode and the printed PDF.
import type { DiagramId } from './types'

const W = 240
const H = 120
type Pt = [number, number]

const path = (pts: Pt[]) => pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ')

function Price({ pts }: { pts: Pt[] }) {
  return <path d={path(pts)} className="lg-price" />
}
function Line({ a, b, kind = 'level' }: { a: Pt; b: Pt; kind?: 'level' | 'up' | 'dn' | 'muted' }) {
  return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={'lg-line lg-' + kind} />
}
function Label({ at, text, kind = 'muted' }: { at: Pt; text: string; kind?: 'muted' | 'up' | 'dn' }) {
  return (
    <text x={at[0]} y={at[1]} className={'lg-label lg-t-' + kind}>
      {text}
    </text>
  )
}
/** A candle: x centre, open, high, low, close (y grows downward). */
function Candle({ x, o, h, l, c, w = 14 }: { x: number; o: number; h: number; l: number; c: number; w?: number }) {
  const up = c < o
  return (
    <g className={up ? 'lg-up-c' : 'lg-dn-c'}>
      <line x1={x} x2={x} y1={h} y2={l} className="lg-wick" />
      <rect x={x - w / 2} y={Math.min(o, c)} width={w} height={Math.max(2, Math.abs(o - c))} rx="1.5" />
    </g>
  )
}

const DIAGRAMS: Record<DiagramId, () => React.ReactNode> = {
  'double-top': () => (
    <>
      <Price pts={[[10, 100], [55, 30], [95, 70], [140, 30], [185, 72], [230, 100]]} />
      <Line a={[40, 30]} b={[160, 30]} kind="muted" />
      <Line a={[70, 70]} b={[230, 70]} kind="dn" />
      <Label at={[96, 84]} text="neckline" kind="dn" />
    </>
  ),
  'double-bottom': () => (
    <>
      <Price pts={[[10, 20], [55, 90], [95, 50], [140, 90], [185, 48], [230, 20]]} />
      <Line a={[40, 90]} b={[160, 90]} kind="muted" />
      <Line a={[70, 50]} b={[230, 50]} kind="up" />
      <Label at={[100, 43]} text="neckline" kind="up" />
    </>
  ),
  'head-shoulders': () => (
    <>
      <Price pts={[[8, 100], [45, 45], [75, 72], [115, 18], [155, 72], [190, 45], [232, 100]]} />
      <Line a={[60, 72]} b={[232, 72]} kind="dn" />
      <Label at={[32, 38]} text="L" />
      <Label at={[111, 12]} text="head" />
      <Label at={[186, 38]} text="R" />
    </>
  ),
  'inv-head-shoulders': () => (
    <>
      <Price pts={[[8, 20], [45, 75], [75, 48], [115, 102], [155, 48], [190, 75], [232, 20]]} />
      <Line a={[60, 48]} b={[232, 48]} kind="up" />
      <Label at={[103, 116]} text="head" />
    </>
  ),
  'bull-flag': () => (
    <>
      <Price pts={[[10, 108], [70, 30], [90, 46], [104, 36], [122, 54], [138, 44], [156, 60], [200, 14]]} />
      <Line a={[70, 28]} b={[160, 52]} kind="muted" />
      <Line a={[90, 48]} b={[160, 66]} kind="muted" />
      <Label at={[24, 66]} text="pole" />
    </>
  ),
  'bear-flag': () => (
    <>
      <Price pts={[[10, 12], [70, 90], [90, 74], [104, 84], [122, 66], [138, 76], [156, 60], [200, 108]]} />
      <Line a={[70, 92]} b={[160, 68]} kind="muted" />
      <Line a={[90, 72]} b={[160, 54]} kind="muted" />
    </>
  ),
  'asc-triangle': () => (
    <>
      <Price pts={[[10, 100], [50, 30], [75, 80], [110, 30], [135, 62], [165, 30], [180, 46], [225, 10]]} />
      <Line a={[40, 30]} b={[190, 30]} kind="level" />
      <Line a={[70, 84]} b={[185, 42]} kind="up" />
    </>
  ),
  'desc-triangle': () => (
    <>
      <Price pts={[[10, 20], [50, 90], [75, 40], [110, 90], [135, 58], [165, 90], [180, 74], [225, 112]]} />
      <Line a={[40, 90]} b={[190, 90]} kind="level" />
      <Line a={[70, 36]} b={[185, 78]} kind="dn" />
    </>
  ),
  'sym-triangle': () => (
    <>
      <Price pts={[[10, 60], [40, 18], [70, 96], [100, 32], [130, 82], [155, 46], [175, 70], [190, 58], [230, 20]]} />
      <Line a={[30, 14]} b={[200, 56]} kind="muted" />
      <Line a={[60, 100]} b={[200, 62]} kind="muted" />
    </>
  ),
  'rising-wedge': () => (
    <>
      <Price pts={[[10, 104], [50, 60], [70, 84], [110, 40], [130, 58], [165, 30], [180, 42], [225, 100]]} />
      <Line a={[40, 58]} b={[190, 24]} kind="muted" />
      <Line a={[60, 88]} b={[190, 40]} kind="muted" />
    </>
  ),
  'falling-wedge': () => (
    <>
      <Price pts={[[10, 16], [50, 60], [70, 36], [110, 80], [130, 62], [165, 90], [180, 78], [225, 20]]} />
      <Line a={[40, 62]} b={[190, 96]} kind="muted" />
      <Line a={[60, 32]} b={[190, 80]} kind="muted" />
    </>
  ),
  'cup-handle': () => (
    <>
      <path d="M10 30 C 40 30, 50 100, 100 100 S 160 30, 170 30 L 185 46 L 198 38 L 230 12" className="lg-price" />
      <Line a={[10, 30]} b={[200, 30]} kind="level" />
      <Label at={[80, 116]} text="cup" />
      <Label at={[176, 60]} text="handle" />
    </>
  ),
  'bull-engulfing': () => (
    <>
      <Candle x={95} o={50} h={44} l={82} c={76} />
      <Candle x={135} o={80} h={30} l={86} c={36} w={18} />
    </>
  ),
  'bear-engulfing': () => (
    <>
      <Candle x={95} o={76} h={40} l={82} c={50} />
      <Candle x={135} o={40} h={34} l={92} c={84} w={18} />
    </>
  ),
  hammer: () => (
    <>
      <Price pts={[[20, 20], [60, 40], [100, 60]]} />
      <Candle x={130} o={48} h={44} l={104} c={40} />
      <Price pts={[[150, 50], [220, 22]]} />
    </>
  ),
  'shooting-star': () => (
    <>
      <Price pts={[[20, 100], [60, 80], [100, 62]]} />
      <Candle x={130} o={72} h={14} l={80} c={80} />
      <Price pts={[[150, 70], [220, 100]]} />
    </>
  ),
  doji: () => <Candle x={120} o={60} h={22} l={98} c={61} />,
  'morning-star': () => (
    <>
      <Candle x={80} o={30} h={26} l={84} c={80} />
      <Candle x={120} o={92} h={86} l={104} c={96} />
      <Candle x={160} o={88} h={28} l={94} c={38} />
    </>
  ),
  'evening-star': () => (
    <>
      <Candle x={80} o={90} h={36} l={94} c={40} />
      <Candle x={120} o={28} h={16} l={34} c={24} />
      <Candle x={160} o={32} h={26} l={92} c={84} />
    </>
  ),
  'rsi-divergence': () => (
    <>
      <Price pts={[[10, 70], [60, 30], [90, 52], [150, 22], [180, 40]]} />
      <Line a={[60, 30]} b={[150, 22]} kind="up" />
      <Label at={[160, 16]} text="higher high" kind="up" />
      <path d="M10 112 L60 84 L90 104 L150 96 L180 108" className="lg-osc" />
      <Line a={[60, 84]} b={[150, 96]} kind="dn" />
      <Label at={[156, 92]} text="lower RSI high" kind="dn" />
    </>
  ),
  'macd-cross': () => (
    <>
      <Line a={[10, 70]} b={[230, 70]} kind="muted" />
      {[-14, -18, -16, -10, -5, -1, 4, 9, 14, 17, 15].map((v, i) => (
        <rect key={i} x={20 + i * 19} y={v > 0 ? 70 - v * 2.2 : 70} width="12" height={Math.abs(v) * 2.2} className={v > 0 ? 'lg-bar-up' : 'lg-bar-dn'} />
      ))}
      <Label at={[128, 112]} text="histogram crosses zero" />
    </>
  ),
  'bollinger-squeeze': () => (
    <>
      <path d="M10 20 C 60 22, 80 52, 120 54 S 170 30, 230 8" className="lg-band" />
      <path d="M10 100 C 60 98, 80 66, 120 64 S 170 92, 230 112" className="lg-band" />
      <Price pts={[[10, 62], [50, 54], [90, 62], [120, 58], [150, 60], [190, 34], [230, 16]]} />
      <Label at={[96, 40]} text="squeeze" />
    </>
  ),
  'support-resistance': () => (
    <>
      <Price pts={[[10, 90], [40, 30], [70, 88], [100, 32], [130, 90], [160, 30], [190, 86], [230, 60]]} />
      <Line a={[10, 30]} b={[230, 30]} kind="dn" />
      <Line a={[10, 90]} b={[230, 90]} kind="up" />
      <Label at={[176, 24]} text="resistance" kind="dn" />
      <Label at={[182, 104]} text="support" kind="up" />
    </>
  ),
  fvg: () => (
    <>
      <rect x="92" y="44" width="140" height="24" className="lg-zone" />
      <Candle x={70} o={86} h={68} l={96} c={70} />
      <Candle x={100} o={70} h={30} l={74} c={36} w={16} />
      <Candle x={130} o={38} h={26} l={44} c={30} />
      <Label at={[150, 60]} text="fair value gap" />
    </>
  ),
  'liquidity-sweep': () => (
    <>
      <Line a={[10, 80]} b={[230, 80]} kind="muted" />
      <Label at={[14, 76]} text="stops below the lows" />
      <Price pts={[[10, 40], [50, 80], [80, 56], [120, 80], [150, 104], [165, 72], [230, 22]]} />
      <Label at={[128, 116]} text="sweep" kind="dn" />
    </>
  ),
  'bos-choch': () => (
    <>
      <Price pts={[[10, 100], [40, 70], [60, 84], [95, 46], [115, 64], [150, 28], [175, 52], [195, 40], [230, 96]]} />
      <Line a={[95, 46]} b={[160, 46]} kind="up" />
      <Label at={[106, 40]} text="BOS" kind="up" />
      <Line a={[175, 64]} b={[230, 64]} kind="dn" />
      <Label at={[192, 78]} text="CHoCH" kind="dn" />
    </>
  ),
  'volume-profile': () => (
    <>
      {[8, 14, 22, 34, 52, 70, 48, 30, 18, 10, 6].map((v, i) => (
        <rect key={i} x={10} y={8 + i * 10} width={v * 2} height={8} className={i === 5 ? 'lg-bar-poc' : i >= 3 && i <= 7 ? 'lg-bar-va' : 'lg-bar-mu'} />
      ))}
      <Label at={[156, 66]} text="POC" />
      <Label at={[156, 42]} text="value area" />
    </>
  ),
  'r-multiple': () => (
    <>
      <Line a={[20, 64]} b={[220, 64]} kind="level" />
      <Line a={[20, 94]} b={[220, 94]} kind="dn" />
      <Line a={[20, 34]} b={[220, 34]} kind="up" />
      <Line a={[20, 4]} b={[220, 4]} kind="up" />
      <Label at={[168, 60]} text="entry" />
      <Label at={[160, 90]} text="stop  −1R" kind="dn" />
      <Label at={[160, 30]} text="target +1R" kind="up" />
      <Label at={[160, 16]} text="target +2R" kind="up" />
    </>
  ),
}

export function Diagram({ id, caption }: { id: DiagramId; caption?: string }) {
  const draw = DIAGRAMS[id]
  if (!draw) return null
  return (
    <figure className="lg-fig">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption || id}>
        {draw()}
      </svg>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
