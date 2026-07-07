#!/bin/sh
# `bun run b0t` — build the rs2b0t LIVE client and open the Electron WALL against
# w1.rs2b2t.com, fully local. Mirrors LCBuddy2's `wall`: fetch rs2b2t's current
# login key, build TARGET=live with it, start the local reverse proxy (serves your
# client from disk + forwards /crc and the cache WebSocket to live), then open the
# multibox wall in Electron (background throttling OFF, so minimized bots keep full
# speed). Your client is never hosted on rs2b2t; only game traffic leaves this box.
#
# In the wall: add bots with REGISTERED rs2b2t accounts (prod registration is on —
# no auto-create). A single bot is just a focused 1-cell wall.
# Env: PORT (8081), RS2B2T_WS (wss://w1.rs2b2t.com), B0T_NO_OPEN=1 (proxy only, no Electron).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -d node_modules ] || { echo "→ installing deps…"; bun install; }
[ -d desktop/node_modules/electron ] || { echo "→ installing the Electron wall (first run downloads Electron)…"; ( cd desktop && bun install ); }

PORT="${PORT:-8081}"
WS="${RS2B2T_WS:-wss://w1.rs2b2t.com}"
HTTP="$(printf '%s' "$WS" | sed -E 's,^ws,http,')"
HOST="$(printf '%s' "$WS" | sed -E 's,^wss?://,,')"

# Fetch the live login modulus from rs2b2t's served client (PUBLIC key), so a key
# rotation never leaves us stale — the one very long digit run in the minified JS.
echo "→ fetching rs2b2t login key + building live client…"
MOD=$(curl -s --max-time 15 "$HTTP/client/client.js" | grep -oE '[0-9]+' | awk 'length($0) >= 250 { print; exit }')
[ -n "$MOD" ] || { echo "ERROR: could not fetch the rs2b2t login modulus from $HTTP/client/client.js" >&2; exit 1; }
TARGET=live LIVE_RSAN="$MOD" bun run build:bot >/dev/null
echo "  built live client (login key fetched from $HOST)."

echo "→ starting local proxy on :$PORT → $HOST …"
pkill -f live-proxy 2>/dev/null || true
sleep 0.4
PORT="$PORT" LIVE_HOST="$HOST" bun tools/live-proxy.ts &
PROXY_PID=$!
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT INT TERM

i=0
while [ "$i" -lt 40 ]; do
    curl -sf "http://localhost:$PORT/multibox.html" >/dev/null 2>&1 && break
    i=$((i + 1))
    sleep 0.3
done
[ "$i" -lt 40 ] || { echo "ERROR: proxy did not come up on :$PORT" >&2; exit 1; }

URL="http://localhost:$PORT/multibox.html"
if [ "${B0T_NO_OPEN:-0}" = "1" ]; then
    echo "→ proxy up at $URL  (B0T_NO_OPEN=1: not launching Electron)"
    wait "$PROXY_PID"
else
    echo "→ opening the Electron wall against LIVE rs2b2t: $URL"
    echo "  Add bots with REGISTERED rs2b2t accounts; they play on the live server."
    ( cd desktop && ./node_modules/.bin/electron . --server="$URL" )
    # Electron exited (wall closed) → the EXIT trap stops the proxy.
fi
