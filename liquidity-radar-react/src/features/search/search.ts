// Coin search. Faithful extraction of the engine's initSearch block: preloads
// the Binance USDT trading list once, then wires the coinSearch / searchResults
// type-ahead panel (live price + 24h change from state.tickers, popular-coin
// highlight). Selecting a result navigates via the engine's setSymbol.
import { COIN_ALIASES, TOP16 } from '../../constants/market'
import { state } from '../../services/store'
import { setSymbol } from '../actions/userActions'
import { $ } from '../../utils/dom'
import { chgHtml, esc, pfmt } from '../../utils/format'

interface RawSymbol {
  symbol: string
  status: string
  baseAsset: string
  quoteAsset: string
  filters: Array<{ filterType: string; tickSize?: string }>
}

interface SearchSymbol {
  sym: string
  base: string
  quote: string
  prec: string | undefined
}

let allBinanceSymbols: SearchSymbol[] = []

export async function initSearch(): Promise<void> {
  try {
    const r = await fetch('https://api.binance.com/api/v3/exchangeInfo')
    const d = (await r.json()) as { symbols: RawSymbol[] }
    allBinanceSymbols = d.symbols
      .filter((s) => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
      .map((s) => {
        const pf = s.filters.find((f) => f.filterType === 'PRICE_FILTER')
        return { sym: s.symbol, base: s.baseAsset, quote: s.quoteAsset, prec: pf ? pf.tickSize : '0.01' }
      })
    allBinanceSymbols.sort((a, b) => a.base.localeCompare(b.base))
  } catch (e) { /* ignore */ }
  const input = $('coinSearch') as HTMLInputElement
  const results = $('searchResults')!
  input.addEventListener('input', function () {
    const q = input.value.trim().toLowerCase()
    if (q.length < 1) { results.classList.remove('show'); return }
    const matches = allBinanceSymbols.filter((s) => s.base.toLowerCase().indexOf(q) !== -1 || s.sym.toLowerCase().indexOf(q) !== -1).slice(0, 30)
    if (!matches.length) { results.innerHTML = '<div class="search-count">No matches for "' + esc(q) + '"</div>'; results.classList.add('show'); return }
    results.innerHTML = matches.map((s) => {
      const t = state.tickers[s.sym]
      const price = t ? '$' + pfmt(t.last) : '—'
      const chg = t ? chgHtml(t.pct) : '<span class="chg flat">—</span>'
      const known = COIN_ALIASES[s.base.toUpperCase()]
      const isPopular = known || TOP16.indexOf(s.base.toUpperCase()) !== -1
      return '<div class="search-item" data-sym="' + s.sym + '"><span class="si-sym" style="color:' + (isPopular ? 'var(--cyan)' : 'var(--muted)') + '">' + s.base + '</span><span class="si-name">' + s.base + '/USDT</span><span class="si-price">' + price + '</span><span class="si-chg">' + chg + '</span></div>'
    }).join('') + '<div class="search-count">' + matches.length + ' pairs found</div>'
    results.classList.add('show')
  })
  input.addEventListener('focus', function () { if (input.value.trim().length >= 1) results.classList.add('show') })
  results.addEventListener('click', function (e) {
    const item = (e.target as HTMLElement).closest('.search-item') as HTMLElement | null
    if (item) { setSymbol(item.dataset.sym as string); input.value = ''; results.classList.remove('show') }
  })
  document.addEventListener('click', function (e) { if (!(e.target as HTMLElement).closest('.search-wrap')) results.classList.remove('show') })
}