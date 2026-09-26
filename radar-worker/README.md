# radar-worker

Always-on collector for Liquidity Radar. It reads **every** Binance spot trade
for the configured symbols (default `BTCUSDT`, `PAXGUSDT`), rebuilds whale
orders from them, and stores them in Postgres, so the chart's whale bubbles
cover its whole history instead of only what one browser session scanned.

- **Exact:** orders are rebuilt from aggTrades that share a transaction time
  and side (the same `groupAggTrades` the app uses). No estimates.
- **Complete:** a backfill walks REST pages back `BACKFILL_DAYS`, while the
  live websocket carries on forward. Reconnects and restarts are refilled.
  Coverage is only ever written after the orders inside it are stored.
- **Free:** Supabase free tier for storage, and a free always-on VM (or your
  own PC) for the worker.

The chart works without this: it falls back to scanning in the browser.

## 1. Database (Supabase, free)

1. Create a project at https://supabase.com. A region near you is fine.
2. **SQL Editor → New query**, paste `sql/001_whales.sql`, and click Run.
3. Note two values:
   - **Project Settings → Database → Connection string → Session pooler**
     (URI). This is `DATABASE_URL`, with your database password in it.
     It is secret: it goes only in the worker's `.env`.
   - **Project Settings → API**: the *Project URL* and the *anon public*
     key. These are public (read-only by RLS) and go in Vercel (step 4).

Size: BTC whale orders at the $50k floor are about 3k rows a day (~0.5 MB).
The 500 MB free tier holds years of BTC and PAXG.

## 2. Run it

```bash
cd radar-worker
npm install
cp .env.example .env      # then put your DATABASE_URL in .env
npm start
```

The first run backfills `BACKFILL_DAYS` (14 by default; about an hour for
BTC), then stays live. The logs show progress. Stop it with Ctrl+C; it saves
its place and resumes on the next start.

## 3. Keep it running 24/7 (free)

**Oracle Cloud Always Free** gives a small VM that never expires.

1. Sign up at https://www.oracle.com/cloud/free/. A card is needed for
   verification; Always Free resources are not charged.
2. Choose a **non-US home region** (e.g. Frankfurt, London or Mumbai).
   Binance blocks US IP addresses.
3. Create a VM using an *Always Free eligible* shape (Ampere A1 or
   E2.1.Micro) with Ubuntu, then SSH in.
4. Install Node 22+ and the worker:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
git clone <your repo url> liquidity-radar && cd liquidity-radar/radar-worker
npm install --omit=dev && cp .env.example .env && nano .env
```

5. Run it as a service, so it restarts on crashes and reboots:

```bash
sudo tee /etc/systemd/system/radar-worker.service >/dev/null <<EOF
[Unit]
Description=Liquidity Radar whale collector
After=network-online.target
[Service]
WorkingDirectory=$PWD
ExecStart=$(which node) src/index.ts
Restart=always
RestartSec=5
User=$USER
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now radar-worker
journalctl -u radar-worker -f      # watch the logs
```

**No VM?** Run `npm start` on your own PC. It collects while the PC is on,
and a restart backfills the hours it missed (up to `BACKFILL_DAYS`).

## 4. Point the site at it

In Vercel → Project → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| `VITE_WHALE_DB_URL` | Supabase *Project URL*, e.g. `https://abcd.supabase.co` |
| `VITE_WHALE_DB_KEY` | Supabase *anon public* key |

Then redeploy. The whale legend shows a green **SERVER** badge when history
comes from the collector, or **COLLECTOR OFFLINE** if its heartbeat is more
than two minutes old.

## Development

```bash
npm test                              # tape reader + real SQL on in-process Postgres
node test/mock-supabase.ts 4790 90    # local stand-in: real Binance data, Supabase-style API
```

To try the site against the mock, build it with
`VITE_WHALE_DB_URL=http://localhost:4790 VITE_WHALE_DB_KEY=dev`.
