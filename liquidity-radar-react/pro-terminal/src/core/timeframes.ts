/** Timeframe strings: native ("1m","4h","1d") or custom ("7m","45m","3d","90s"). */
export const NATIVE_SECONDS: Record<string, number> = { '1s':1,'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'3d':259200,'1w':604800,'1M':2592000 };
export const PRESET_TIMEFRAMES = ['1s','15s','30s','1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w','1M'];
const UNIT: Record<string, number> = { s:1, m:60, h:3600, d:86400, w:604800, M:2592000 };

export function parseTimeframe(tf: string): number | null {
  const m = /^(\d+)([smhdwM])$/.exec(tf.trim()); if (!m) return null;
  const sec = Number(m[1]) * UNIT[m[2]]; return sec > 0 ? sec : null;
}
export const isNative = (tf: string) => tf in NATIVE_SECONDS;
export const isSubMinute = (tf: string) => (parseTimeframe(tf) ?? 60) < 60;
/** Pick the largest native interval that evenly divides the target. */
export function baseFor(sec: number): { base: string; factor: number } {
  const c = Object.entries(NATIVE_SECONDS).filter(([, s]) => s <= sec && sec % s === 0 && s !== 2592000).sort((a, b) => b[1] - a[1]);
  const [base, bs] = c[0] ?? ['1s', 1]; return { base, factor: sec / bs };
}
export const fmtTf = (sec: number) => sec % 604800 === 0 ? `${sec / 604800}w` : sec % 86400 === 0 ? `${sec / 86400}d` : sec % 3600 === 0 ? `${sec / 3600}h` : sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`;
