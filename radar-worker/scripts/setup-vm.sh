#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu VM (Oracle Cloud Always Free, or any VPS):
# installs Node 22, fetches the code, and runs BOTH services under systemd so
# they start on boot and restart if they crash:
#   radar-worker  — whale-order history collector  (npm start)
#   radar-bot     — Binance Futures testnet bot    (npm run bot)
#
# Usage, on the VM:
#   curl -fsSL https://raw.githubusercontent.com/mrcrysta1/liquidity-radar/master/radar-worker/scripts/setup-vm.sh | bash
# It stops before starting anything if radar-worker/.env is missing, and tells
# you how to create it. Run it again after editing .env; it is safe to re-run.
set -euo pipefail

REPO="${REPO:-https://github.com/mrcrysta1/liquidity-radar.git}"
DIR="${DIR:-$HOME/liquidity-radar}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Checking region: Binance blocks US IP addresses"
country="$(curl -fsS --max-time 8 https://ipinfo.io/country 2>/dev/null || true)"
if [ "${country:-}" = "US" ]; then
  echo "This VM appears to be in the US ($country). Binance will refuse it. Use a non-US region." >&2
  exit 1
fi
echo "Region: ${country:-unknown}"

say "Installing Node.js 22 and git"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
command -v git >/dev/null || sudo apt-get install -y git
node -v

say "Fetching the code into $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR/radar-worker"
npm ci --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  cat <<'MSG'

  Created radar-worker/.env from the example. Fill it in, then run this script again:

    nano ~/liquidity-radar/radar-worker/.env

  Needed: DATABASE_URL (Supabase), BINANCE_API_KEY and BINANCE_API_SECRET
  (Binance Futures Demo Trading / testnet keys), and BOT_MODE=explore if you
  want it to trade without a proven edge (testnet only).
MSG
  exit 0
fi
chmod 600 .env

say "Installing the services"
NODE="$(command -v node)"
unit() {
  sudo tee "/etc/systemd/system/$1.service" >/dev/null <<EOF
[Unit]
Description=$2
After=network-online.target
Wants=network-online.target
[Service]
WorkingDirectory=$DIR/radar-worker
ExecStart=$NODE $3
Restart=always
RestartSec=10
User=$USER
[Install]
WantedBy=multi-user.target
EOF
}
unit radar-worker "Liquidity Radar whale collector" "src/index.ts"
unit radar-bot "Liquidity Radar testnet trading bot" "src/bot.ts"
sudo systemctl daemon-reload
sudo systemctl enable --now radar-worker radar-bot
sudo systemctl restart radar-worker radar-bot

say "Done. Both services are running."
cat <<'MSG'
  Watch the bot:        journalctl -u radar-bot -f
  Watch the collector:  journalctl -u radar-worker -f
  Stop the bot:         sudo systemctl stop radar-bot
  Update later:         re-run this script (it pulls the latest code and restarts)
MSG
