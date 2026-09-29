// The round coin icon used across the app: the coin's logo when CoinGecko has
// one, else its glyph on a tint of its brand colour. Non-crypto instruments
// (gold, indices...) always use their own glyph and colour.
import { state } from '../../services/store'
import { baseOf, coinMeta } from '../../utils/coins'
import { instrumentOf } from '../../constants/instruments'

export function CoinBadge({ sym, size = 22 }: { sym: string; size?: number }) {
  const meta = coinMeta(sym)
  const inst = instrumentOf(sym)
  const img = (state.marketCaps as Record<string, { image?: string }> | undefined)?.[baseOf(sym)]
    ?.image
  const color = inst?.color ?? meta.color
  return (
    <span
      className="coin-badge"
      style={{
        width: size,
        height: size,
        color,
        borderColor: color + '66',
        background: color + '1f',
        fontSize: size * 0.5,
      }}
    >
      {img && !inst ? (
        <img src={img} alt="" width={size} height={size} loading="lazy" decoding="async" />
      ) : (
        (inst?.icon ?? meta.icon)
      )}
    </span>
  )
}
