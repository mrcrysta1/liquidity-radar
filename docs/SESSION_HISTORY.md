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
