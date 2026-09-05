export interface CoinMeta {
  sym: string
  name: string
  icon: string
  color: string
}

export interface MarketTicker {
  last: number
  pct: number
  qvol: number
}

export interface CandleLike {
  t: number
  o: number
  h: number
  l: number
  c: number
  v?: number
}

export interface MACD {
  macd: number
  signal: number
  hist: number
}

export interface BB {
  mid: number
  up: number
  lo: number
  pctB: number
}

export type VolTrend = 'RISING' | 'FALLING' | 'FLAT'

export interface AIScore {
  score: number
  label: string
  color: string
  badge: string
  rsi: number
  macd: MACD
  e20: number
  bb: BB
  vt: VolTrend
  last: number
}

export interface ForecastRow {
  label: string
  pred: number
  lo: number
  hi: number
  dp: number
  conf: number
}

export interface Forecast {
  rows: ForecastRow[]
  bias: string
}

export interface SupportResistance {
  res: number
  sup: number
}
