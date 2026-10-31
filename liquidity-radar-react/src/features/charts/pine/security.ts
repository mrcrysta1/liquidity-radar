// request.security() support — the pure half (Node runs it in the tests).
//
// How a call is served:
//  1. The runtime meets `request.security(sym, tf, expr)` and, when that
//     symbol/interval is not the chart's own and no bars were supplied for
//     it, returns na and reports the key (securityNeeds).
//  2. The page (./indicator, main thread) fetches those bars through the
//     app's market services and runs the script again with them.
//  3. The runtime then runs the same script once more over the requested
//     bars, capturing `expr` at every call site, and lines those values up
//     with the chart's bars by time — without lookahead by default: a
//     higher-timeframe value appears on the chart bar where its bar closes,
//     and only the last (live) chart bar sees the still-forming one.
//
// Limits: symbols are Binance (or whatever the app's market services load
// for a symbol name; an exchange prefix like "BINANCE:" is dropped). Bars
// come from one fetch of at most 5000, so a much lower timeframe than the
// chart's covers only the recent part of it. Nested request.security inside
// the requested expression returns na. request.security_lower_tf is not
// supported.

export interface SecBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** "BINANCE:ethusdt" → "ETHUSDT". */
export function normSymbol(s: string): string {
  return String(s || '')
    .split(':')
    .pop()!
    .trim()
    .toUpperCase()
}

/**
 * A Pine timeframe in canonical spelling: minutes as a number ("60"), then
 * "30S", "D" / "3D", "W", "M" / "3M". null when it cannot be read.
 */
export function normTf(tf: string): string | null {
  const s = String(tf || '').trim()
  const m = /^(\d*)([SDWMH]?)$/i.exec(s)
  if (!m || (!m[1] && !m[2])) return null
  const n = m[1] ? Number(m[1]) : 1
  if (!(n >= 1)) return null
  const u = m[2].toUpperCase()
  if (!u) return String(n)
  if (u === 'H') return String(n * 60)
  if (u === 'S') return n + 'S'
  return n === 1 ? u : n + u
}

/** Milliseconds per bar of a canonical timeframe (months nominal, 30 days). */
export function tfMs(tf: string): number {
  const m = /^(\d*)([SDWM]?)$/.exec(tf)
  if (!m) return 0
  const n = m[1] ? Number(m[1]) : 1
  switch (m[2]) {
    case 'S':
      return n * 1000
    case 'D':
      return n * 86400000
    case 'W':
      return n * 7 * 86400000
    case 'M':
      return n * 30 * 86400000
    default:
      return n * 60000
  }
}

/** The app's interval id for a canonical Pine timeframe ("240" → "4h"). */
export function appTf(tf: string): string {
  const m = /^(\d*)([SDWM]?)$/.exec(tf)
  if (!m) return ''
  const n = m[1] ? Number(m[1]) : 1
  switch (m[2]) {
    case 'S':
      return n + 's'
    case 'D':
      return n + 'd'
    case 'W':
      return n + 'w'
    case 'M':
      return n + 'M'
  }
  if (n % 1440 === 0) return n / 1440 + 'd'
  if (n % 60 === 0) return n / 60 + 'h'
  return n + 'm'
}

export const securityKey = (symbol: string, tf: string) => normSymbol(symbol) + '|' + tf

/**
 * For each chart bar, the index of the requested bar whose value it shows
 * (-1: none yet).
 *
 * - lookahead off (default): the newest requested bar that has closed by
 *   the chart bar's close; on the last chart bar, the requested bar it sits
 *   in (the live, still-forming value — what TradingView shows in realtime).
 * - lookahead on: the requested bar the chart bar opens in.
 * - gaps on: a value only on the chart bar where it first appears.
 */
export function alignSecurity(
  chart: Array<{ t: number }>,
  req: Array<{ t: number }>,
  reqStepMs: number,
  lookahead = false,
  gaps = false,
): Int32Array {
  const n = chart.length
  const m = req.length
  const out = new Int32Array(n).fill(-1)
  if (!n || !m) return out
  const chartStep = n > 1 ? chart[n - 1].t - chart[n - 2].t : reqStepMs
  const closeOf = (j: number) => (j + 1 < m ? req[j + 1].t : req[j].t + reqStepMs)
  let j = -1
  let prev = -1
  for (let i = 0; i < n; i++) {
    const t = chart[i].t
    let k: number
    if (lookahead) {
      while (j + 1 < m && req[j + 1].t <= t) j++
      k = j
    } else {
      const close = i + 1 < n ? chart[i + 1].t : t + chartStep
      while (j + 1 < m && closeOf(j + 1) <= close) j++
      k = j
      if (i === n - 1 && j + 1 < m && req[j + 1].t <= t) k = j + 1
    }
    if (gaps && k === prev) out[i] = -1
    else out[i] = k
    prev = k
  }
  return out
}
