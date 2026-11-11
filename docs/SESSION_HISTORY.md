# Session history

Running log of what the owner asked for and what was done, so any new chat
(any laptop, any agent) can pick up where the last one stopped.

**Rule:** every new order gets an entry here (newest at the top) in the same PR
as the work. Read the latest entries before starting anything.

Entry format:

```
## YYYY-MM-DD — short title
- Asked: what the owner ordered (their words, short)
- Done: what shipped (PR numbers)
- Status/numbers: measured facts, not promises
- Open: what is left / waiting on the owner
```

---

## 2026-11-11 — bot audit (F1/C6, news, BTC correlation, regime, profit protection)
- Asked: two pasted specs — audit why the bot underperforms; F1 vs F1+C6;
  news signals; F1 exit mismatch; BTC correlation engine; regime detection;
  profit-protection exit experiments; dashboard; all paper-only, no live changes
  without evidence. Owner: "start pr 1 and continue all".
- Audit findings (read-only, replayed on real candles):
  - BUG B1: trailed stop never reached Binance (-4130: a second closePosition
    stop is refused); live trades kept their first stop. UNI #114 lost ~0.15R.
  - BUG B2: entry recorded as the bar close (testnet avgPrice 0); real fills
    differed −3..+37 bps; slippage always showed 0.
  - BUG B3: funding not in real-trade P&L. B4: ledger would double-count
    slippage on real trades.
  - F1 exits match the backtest exactly (no code mismatch): 4 of 5 early exits
    were close ≤ EMA(300) on entries 0.15–1.6 ATR above a flat EMA (chop).
  - C2 0/23: resolver correct; 23 trades ≈ 3 market events; edge negative
    every year since 2024 (2,696-trade backtest, +0.033R overall).
  - ML +0.21R: 1,020 outcomes on 53 candles / 9 days; per-day +0.17 ± 0.11R
    (not significant); shorts +0.54R, longs −0.42R in a falling week.
  - Existing: BTC correlations (23 coins, 3 TFs, not used in decisions, 4 days
    history); 3 different regime schemes; news = analytics + alerts only, no
    news signal engine; MFE/MAE stored; X1 = F1 + BTC filter (shadow).
- Plan (one PR each): 1 bug fixes → 2 comparison study (F1 / F1+C6 / F1+BTC /
  both, exit variants, giveback, per regime) → 3 one regime + correlation
  history → 4 news strategy N1 (paper) → 5 dashboard cards.
- Done: PR 1 #181 merged (B1–B4 fixes + tests). Testnet self-test 10/10,
  incl. "trailed stop replaces the old one" — the -4130 fix works on Binance.
- PR 2 (study, `npm run study`, docs/research/study-2026-11-11.md), 3,610 F1
  trades 2019–2026, conservative costs, day-clustered:
  - F1 alone +0.151R (95% +0.039..+0.262). F1+C6 +0.188 (rejected +0.118),
    F1+BTC +0.170 (rejected +0.053), F1+C6+BTC +0.196 (rejected +0.120).
    No filter proven: what each turns down is still positive on average.
    Holdout (Feb 2026+) is not independent for C6 / the BTC rule.
  - Exits vs current (A +0.155): trail 3 ATR −0.099 (sig. worse), trail 2
    −0.141, partial at 1.5R −0.064, at 2R −0.056, break-even at 1R −0.031,
    EMA(20) exit −0.086; EMA(50) exit +0.019 (not significant). A trend
    strategy's profit is in the rare long runs; protecting early cuts them.
    Under A, 321 of 1,371 trades that reached +1R closed at a loss.
  - Live since Nov 1: ml 1,087 paper trades on 59 candles, per-candle mean
    +0.078R (95% −0.171..+0.327) — not significant. Others too few.
- PR 2 #182 merged.
- PR 3 (regime + correlation): Corr gains downside beta, trend
  (strengthening / weakening at 99%), own-move test (6-bar residual z ≥ 2.58);
  regime gets a volume note (descriptive only); regimeSeries rebuilds the
  7-class regime at every past 4h bar (tested: equals the live rule, past
  data only). Study §4–5: F1 by regime — strong-bull +0.19, weak-bull +0.09,
  weak-bear +0.01, uncertain +0.40 (many cells, some will look good by
  chance); downside beta > beta for 22 of 23 coins; correlation changes
  significantly in 17–37% of 30-day windows (not a constant).
- PR 3 #183 merged.
- PR 4 (N1 news strategy, paper only): src/news/n1.ts, sql/011
  news_signals (applied by the bot workflow), recordN1 after each release's
  reactions (from 2026-11-11), `npm run news-study`. Pre-registered rule:
  60-min reaction |z| ≥ 2 → trade with it (continue) or against (fade), exit
  release + 24 h, 0.10%/leg. Mode chosen on 2019–2024 only: continue
  (+0.086%, n 127, 95% −0.91..+1.08); test 2025+: −0.227% (n 68, 95%
  −0.88..+0.43). Fade −0.49% design. Baseline (every release, long 24 h)
  −0.30%. No measurable information from the first-hour reaction. No
  consensus forecasts in free history → actual vs forecast untestable.
- Open: PR 5 (dashboard cards); publish study:latest / news:study.

## 2026-11-11 — history file + trading bot status
- Asked: keep a separate history file updated on every order; give the status
  of the self-learning bot and suggestions.
- Done: this file (docs/SESSION_HISTORY.md).
- Bot status (checked 11:08 UTC from Supabase + GitHub Actions):
  - Running: GitHub Actions chain healthy (5h30m runs back to back, watchdog
    green). Heartbeat fresh, mode `hybrid`, Binance Futures **testnet** only.
  - Demo account: 5,000 USDT start (2026-09-26) → 4,213.65 now. Last 7 days
    4,285.82 → 4,213.65 (−72). Risk guard not halted.
  - Old 5m/explore record: 112 trades, −711.92 USDT, 356.84 of it fees, 24% win.
  - F1 trend (the only live strategy since 2026-11-04): 6 closed, 1 win,
    avg −0.375R, −71.35 USDT; 1 open (INJUSDT long from 2026-11-11 04:00).
    5 of 6 exits were the "signal" exit after 1–4 bars, not the stop.
  - Shadow (paper) since 2026-11-04: ml 1,020 outcomes, +0.213R avg, 53% win
    (outcomes cluster on few 4h candles, so far fewer independent samples);
    C2 23 trades 0% win −0.63R; C6 4, F1X 7, X2 2 — all negative, too few to judge.
  - Walk-forward gate on 2026-11-10/11 failed every market checked
    (BTC PF 1.00, ETH 0.84, ETC best at 1.27 but failed another check).
- Open: see suggestions in the PR / chat of this date.

## Before 2026-11-11 — summary of earlier work
- UI polish A–H, F1–F3 shipped (PRs #70–#88). Pending: E4 spacing, F4 duplicate
  CSS rules, F5 split index.css. Details: remind.txt (local, not in git).
- Accuracy fixes, Settings → Learning + PDF, AI assistant (#89–#94).
- Trading bot on GitHub Actions, testnet, BTC/gold then 24 markets, multi-strategy
  hybrid (F1 live; C6/F1X/C2/ml/X1/X2 shadow) (#95–#153).
- Research P1–P7 (health stats, ledger, audit, market context, econ events,
  news intelligence, calibration study, daily/weekly report) (#155–#165).
- Website round (#166–#173), Discord /ask + Radar AI brain + model fallbacks
  (#174–#179).
- Standing rules: never real money; always branch → PR → merge after checks;
  every new feature gets a Settings → Learning entry + WHATS_NEW line.
