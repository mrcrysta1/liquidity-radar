// Footer — Phase 3 componentization slice (CR-P3-006).
// P0 isolated static component extracted verbatim from Shell.tsx. The engine
// never writes into <footer> (no ids, no classes, no innerHTML/textContent
// swaps), so React can own it safely. Markup is byte-identical to the original
// vanilla index.html footer; no hooks, no imports, no engine coupling.
export function Footer() {
  return <footer>&copy; 2027 Liquidity Radar. All rights reserved.</footer>
}
