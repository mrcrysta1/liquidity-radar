// Footer — Phase 3 componentization slice (CR-P3-006).
// P0 isolated static component extracted verbatim from Shell.tsx. The engine
// never writes into <footer> (no ids, no classes, no innerHTML/textContent
// swaps), so React can own it safely. Markup is byte-identical to the original
// vanilla index.html footer; no hooks, no imports, no engine coupling.
export function Footer() {
  return (
    <footer>
      LIQUIDITY RADAR v5.0 &middot; Created by <b>Zain</b> &middot; microstructure terminal &middot; data: Binance Spot &amp; Futures WS/REST &middot; sentiment: alternative.me &middot; news: CoinDesk, Cointelegraph, CryptoSlate, Decrypt, The Block, CoinGape, BeInCrypto, Bitcoin Magazine (via RSS2JSON)<br />
      Everything on this page is informational tooling — not financial advice. Trade at your own risk.
    </footer>
  )
}