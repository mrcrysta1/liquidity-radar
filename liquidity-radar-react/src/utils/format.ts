export const esc = (s: string): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export function fmt(n: number, d?: number): string {
  const digits = d == null ? 2 : d
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function pfmt(p: number): string {
  if (!isFinite(p)) return '—'
  const d = p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : p >= 0.0001 ? 6 : 8
  return fmt(p, d)
}

export function cfmt(n: number): string {
  if (!isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return '$' + fmt(n / 1e9, 2) + 'B'
  if (a >= 1e6) return '$' + fmt(n / 1e6, 2) + 'M'
  if (a >= 1e3) return '$' + fmt(n / 1e3, 1) + 'K'
  return '$' + fmt(n, 0)
}

export function nfmt(n: number): string {
  if (!isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return fmt(n / 1e9, 2) + 'B'
  if (a >= 1e6) return fmt(n / 1e6, 2) + 'M'
  if (a >= 1e3) return fmt(n / 1e3, 1) + 'K'
  return fmt(n, 2)
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return s + 's ago'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ' + (m % 60) + 'm ago'
  return Math.floor(h / 24) + 'd ago'
}

export type ChgClass = 'up' | 'down' | 'flat'
export type ChipClass = 'b-green' | 'b-gray' | 'b-red'

export function chgCls(p: number): ChgClass {
  return p > 0.005 ? 'up' : p < -0.005 ? 'down' : 'flat'
}

export function chgHtml(p: number): string {
  return '<span class="chg ' + chgCls(p) + '">' + (p > 0 ? '+' : '') + p.toFixed(2) + '%</span>'
}

export function sigOf(p: number): [string, ChipClass] {
  return p > 3
    ? ['STRONG BUY', 'b-green']
    : p > 0.8
      ? ['BUY', 'b-green']
      : p > -0.8
        ? ['NEUTRAL', 'b-gray']
        : p > -3
          ? ['SELL', 'b-red']
          : ['STRONG SELL', 'b-red']
}
