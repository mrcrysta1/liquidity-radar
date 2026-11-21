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

## 2026-11-21 — ML2 research plan (design only)
- Asked: keep ml paper-only, C2 paper (verify the switch), keep all backups,
  plan ML2 (BTC trend, breadth, funding, fewer independent inputs), paper
  only, must beat the constant baseline and BTC EMA(200) on unseen data; no
  implementation until the design and criteria are approved.
- Done: docs/research/ml2-plan-2026-11-21.md — same target as ml; 12 inputs
  (4 coin, 3 BTC, 2 breadth, 2 relative-to-BTC, 1 funding); pooled models M0
  constant, M1 logistic, M2 small MLP, M3 GBDT; walk-forward with purge +
  embargo; design 2018-07…2024-12 picks one, holdout 2025-01…2026-11 once;
  6 pass criteria; stages A (inputs) and B (evaluation), then stop for review.
- Owner: "ok ... start the learning" → plan approved; stages A + B run.
- Stage A: src/research/ml2.ts (12 inputs, breadth only from coins trading
  then, funding settled by the close; logistic IRLS), 5 tests incl.
  "later bars never change an earlier input".
- Stage B: `npm run ml2-eval`, docs/research/ml2-eval-2026-11-21.md. 356k
  rows, 44 design blocks (2019-12 → 2024-12), 17 holdout blocks (2025-01 →
  2026-11), run once. No model beat the constant in design (M1 −0.0015,
  M2 −0.0005, M3 −0.0011); rule picked M2. Holdout: log loss −0.0024 vs
  constant, −0.061R/trade (−0.272 … +0.151), vs BTC EMA(200) −0.058, vs coin
  flip −0.026; 5 of 7 checks failed → NOT PASSED, ML2 stops (as planned).
- Open: owner decides what next (new question / horizon, or a filter on F1
  as C6 does, or stop ML for direction).
- C2 confirmed: 13:47:28 UTC (first run on the new code) strategy:c2 live →
  shadow, event logged. Open real shorts #122 BTC, #123 AAVE, #124 ADA each
  hold one Binance stop (checked read-only on the testnet); no new C2 real
  trades since #124.

## 2026-11-21 — C2 back to paper; plan steps 1–3 (backup, skill test, inputs)
- Asked: approved plan steps 1, 2, 3 only (no ML2, no PENDING_ENTRY, no
  changes to ML / F1 / C2 / C6 logic); move C2 back to paper safely, keep
  its records. "start one by one without asking me ... think about C2".
- C2: agreed, paper. Its 2,696-trade backtest earns +0.033R and has been
  negative every year since 2024; it went live on 35 paper trades. Cause:
  the health rule promoted any banded strategy after 30 good paper trades,
  including one configured shadow (C6 could have followed). Fix: only a
  strategy configured live is promoted; one configured shadow that went live
  is moved back ("configured shadow (BOT_STRATEGIES): paper only"). Open C2
  trades (#122 BTC, #123 AAVE, #124 ADA shorts) keep their exchange stop and
  C2 exit rules until they close (ruleBar manages by the trade's strategy,
  whatever its state). Takes effect at the next bot run after merge.
- Done: C2 fix PR #189 merged.
- Step 1 (backup): src/bot/backup.ts, sql/012 bot_backups (RLS, no anon
  read), `npm run backup-models` / `npm run restore-models` (dry run on a
  scratch DB by default; --apply only on the owner's go-ahead). Backup #1
  "original before ML research (2026-11-21)" at 12:01 UTC: 31 champion
  markets = 62 networks (24 bot coins × 2 = 48 on 4h, plus PAXG/XAU 4h and 5
  old 5m), 145 calibration rows, 64 learning state keys (incl. c6:model),
  digest 8e98679c…; local copy radar-worker/backups/ (not in git). Restore
  dry runs from the file and from the DB copy: every network and calibration
  row matches. Model rows are never deleted (3,446 kept); calibration is
  overwritten per trade, so the snapshot is its only copy. PR #190 merged.
- Step 2 (skill): `npm run ml-skill`, src/research/skill.ts,
  docs/research/ml-skill-2026-11-21.md. Walk-forward model 2018-07 → 2026-11,
  24 markets, 25,157 trades, own bracket, bot costs + real funding,
  clustered ranges: −0.022R/trade (−0.047 … +0.004), PF 0.96, 6 of 9 years
  negative. Same bars vs follow-BTC EMA(50) −0.017 (−0.064 … +0.030), vs
  coin flip +0.014 (−0.012 … +0.040): no measurable skill. Against BTC's
  trend (55% of trades) −0.051 (below zero); longs −0.041 (below zero). Last
  30 days +0.256 = the crash (vs BTC rule +0.076, range −0.16 … +0.31).
  Trend rules alone ≈ 0 with this bracket (BTC EMA200 +0.002). PR #191.
- Step 3 (inputs): `npm run ml-inputs`, src/research/inputs.ts,
  docs/research/ml-inputs-2026-11-21.md. 1,269 walk-forward test blocks
  (same folds/seeds as the gate), 628k labelled outcomes. Model log loss
  0.698 vs constant base rate 0.687 (−0.011, −0.013 … −0.009; better in 31%
  of blocks; every period and regime) → the net is worse than no inputs.
  24 input pairs |r| ≥ 0.7 → ~3 signals. Only steady signal: reversal (trend
  inputs IC long −0.08 … −0.11, 71–76% same sign). No use: hour_sin/cos,
  taker_buy_share (1 bar), atr_rank_200 since 2023. Last 30 days trend inputs
  −0.8 … −1.0 SD from history.
- Open: owner reviews steps 1–3; next steps (4–9, ML2) wait for approval.
  C2 → paper takes effect at the 13:46 UTC hand-over (check strategy:c2).

## 2026-11-21 — technical audit + plan (ML intelligence directive)
- Asked: Q&A on the ML (algorithm, training, target, timeframe); opinion on a
  "trade management engine" proposal; then a directive: keep execution, F1
  exits and the ML 1.5R bracket as they are; produce an audit and a plan
  before any structural change.
- Facts given: ML = 48 small MLPs (24 coins × long/short, 18 → 6 → 1),
  hourly challengers, online correction per trade, 4h. ML bracket is
  1.5 / 2.25 ATR = 1.5R (BOT_SL_ATR / BOT_TP_ATR), not 3R.
- Early-exit check on 2,533 ML paper trades: current +0.47R/candle (win
  65%), close at 1.2R +0.39 (67%), at 1R +0.34 (69%); 37 of 654 stopped
  trades had reached 1.2R.
- Done: docs/research/ml-audit-2026-11-21.md (no code changes). Since Nov 1:
  2,744 challengers, 245 promotions (~10 per coin), 5% passed the
  walk-forward gate.
- Open: owner reviews the plan (steps 1–9); C2 auto-promotion decision.

## 2026-11-21 — ML "ratio down" analysis (read-only)
- Asked: check status; owner thinks past breakouts/breakdowns made the ML
  noisy / distorted and its ratio is down; what to add or repair.
- Status: bot chain healthy (heartbeat 10:41 UTC, 5h30 runs, relay #186 in
  place). Testnet equity 4,291. F1: no entries since Nov 11 (coins below
  EMA300). C2 was auto-promoted shadow → live on ~Nov 17 by the health rule
  (35 shadow trades, +0.03R/trade): real #120 +1.91R, #121 +1.60R, 3 open shorts.
- ML paper record Nov 1–21 (2,533 closed, 118 candles, per-candle clustered):
  - Overall win 65%, +0.49R/trade; weekly win 53% → 66% → 81%.
  - 81% of trades short. Shorts +0.72R (win 75%), longs −0.45R (win 25%).
  - BTC fell 81.3k → 57.9k (−29%) in the same three weeks: the result is the
    crash, not proven skill. Per candle most coins take the same side
    (mean |net side| 0.64) → 24 trades ≈ one bet on market direction.
  - Losing days = bounce days: Nov 2–3 (win 28–30%), Nov 15–16 (40–51%);
    newest open trades (Nov 21 00:00/04:00) 32 of 45 underwater.
  - Trades with the last 12-bar move +0.47R/candle; against it +0.01 (no edge
    on reversals). Market moves before vs after: corr −0.22 (4h mean-reverts).
  - Shock candles (|mean ret12| > 3 ATR or ATR rank > 0.85): win 53% vs 66%
    (9 candles, weak evidence).
  - Calibration drifts with the trend: predicted p 0.49 → 0.65 by week, actual
    0.46 → 0.81 — learns "short wins" from its own recent shadow trades.
- Causes found in code: features are the coin's own chart only (no BTC,
  breadth, EMA200/300, funding, open interest); regime label is EMA20/50
  only; challengers train on bars plus the model's own shadow outcomes (the
  same recent weeks counted twice); no per-candle same-side cap.
- Open (owner to choose, nothing changed): BTC/breadth/long-trend/funding
  features; stop double-counting shadow outcomes; same-side cap per candle;
  skill-vs-"short everything" baseline; full-cycle walk-forward 2022–2026;
  keep or revert C2 auto-promotion.

## 2026-11-12 — "my bot is not running" diagnosis
- Asked: diagnose why the bot is not running.
- Found (04:41 UTC): the bot IS running (run 43151056475 since 03:52,
  heartbeat 04:43, decided every market at the 04:00 bar). No trades because
  every coin closes below its EMA(300): F1 has no entry in this market.
- Real outage 2026-11-11 23:51 → 2026-11-12 03:52 UTC (~4 h): run
  43078073557 failed with "The hosted runner lost communication with the
  server" (GitHub side) in the bot step, so its hand-over step never ran;
  the hourly safety-net cron then fired only at 03:52 (GitHub skips crons).
- Fix: `relay` job in trading-bot.yml — runs on a fresh runner when the bot
  job fails after ≥ 10 min and no run is going/queued, and starts the next
  run. Not after a cancel or a quick crash.
- Open: applies from the next run that starts after the merge.

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
- PR 4 #184 merged. Published bot_state study:latest and news:study
  (npm run study --publish / news-study --publish, 2026-11-11 12:43 UTC).
- PR 5 (dashboard): Strategy study card (Strategies tab), News reaction
  study card (Market tab), Market context: down beta, own-move, volume.
  Covers Part 7 items 1–10 (1–3 in Market context, 9 in News study, the
  rest in Strategy study).
- Follow-ups (not done): re-run `npm run study -- --publish` and
  `npm run news-study -- --publish` from time to time (not scheduled);
  N1 paper record needs months (≈8 releases/month); C6/X1/F1X live samples
  still tiny; no strategy settings were changed.

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
