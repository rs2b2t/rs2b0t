#!/bin/sh
# Open the MultiBox wall against the LIVE rs2b2t world — fully local.
#
# Builds your client with rs2b2t's login key, starts a local relay that serves
# your client from disk and forwards game traffic to rs2b2t, then opens the wall
# against it. Your client is NEVER hosted on rs2b2t; only game-server traffic
# leaves this machine (already the whitelisted IP).
#
# Usage:  ./tools/wall-rs2b2t.sh        (env: RELAY_PORT, RS2B2T_WS, NODEID)
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# A fresh checkout may lack deps: the bundler needs the repo-root node_modules,
# and the window needs desktop/ (electron). Install whichever is missing.
[ -d node_modules ] || { echo "→ installing deps…"; bun install; }
[ -d desktop/node_modules/electron ] || { echo "→ installing the desktop window (electron)…"; ( cd desktop && bun install ); }

PORT="${RELAY_PORT:-8899}"
NODEID="${NODEID:-1}"
WS="${RS2B2T_WS:-wss://w1.rs2b2t.com}"
HTTP="$(printf '%s' "$WS" | sed -E 's,^ws,http,')"

echo "→ fetching rs2b2t login key + building your client…"
# the login modulus is the one very long digit run in the client (>=100 digits).
# grep the digit runs, pick the first long one in awk — no grep interval limit
# (BSD grep caps {n,} at 255, and the modulus is ~309 digits).
MOD=$(curl -s --max-time 15 "$HTTP/client/client.js" | grep -oE '[0-9]+' | awk 'length($0) >= 100 { print; exit }')
[ -n "$MOD" ] || { echo "ERROR: could not fetch the rs2b2t login modulus from $HTTP/client/client.js" >&2; exit 1; }
LOGIN_RSAN="$MOD" LOGIN_RSAE=65537 bun run build:bot >/dev/null
# optional: local soundfont so music works + no 404 (harmless if absent)
cp "$HOME/code/lostcity-dev/engine/public/client/SCC1_Florestan.sf2" out/ 2>/dev/null || true

echo "→ starting local relay on :$PORT → $WS …"
pkill -f rs2b2t-relay 2>/dev/null || true
sleep 0.4
RELAY_PORT="$PORT" RS2B2T_WS="$WS" bun tools/rs2b2t-relay.ts &
RELAY_PID=$!
trap 'kill "$RELAY_PID" 2>/dev/null || true' EXIT INT TERM

i=0
while [ "$i" -lt 30 ]; do
    if curl -sf "http://localhost:$PORT/multibox.html" >/dev/null 2>&1; then break; fi
    i=$((i + 1)); sleep 0.3
done
[ "$i" -lt 30 ] || { echo "ERROR: relay did not come up on :$PORT" >&2; exit 1; }

echo "→ opening the wall against LIVE rs2b2t (world $NODEID)…"
echo "  add bots with real rs2b2t accounts; they play on the live server."
cd desktop
exec ./node_modules/.bin/electron . --server="http://localhost:$PORT/multibox.html?nodeid=$NODEID"
