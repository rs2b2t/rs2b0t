#!/bin/sh
# Build the stock client + bot client and deploy both into a local Engine's
# public/ (see docs/DEV.md). Players: /rs2.cgi untouched; bot: /bot.html.
set -e

SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Auto-extract RSA keys from engine's client.js
echo "→ Extracting RSA keys from engine..."
ENGINE_DIR="${ENGINE_DIR}" sh "$SCRIPT_DIR/extract-rsa.sh"

# Source .env for ENGINE_DIR
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

if [ -z "${ENGINE_DIR}" ]; then
    echo "ENGINE_DIR not set. Set it in .env (path to lostcity engine folder)" >&2
    exit 1
fi
ENGINE="${ENGINE_DIR}"
echo "deploying to $ENGINE/public/"
if [ ! -d "$ENGINE/public" ]; then
    echo "engine public/ not found at $ENGINE (set ENGINE_DIR)" >&2
    exit 1
fi

bun run build
bun run build:bot

# the nav worker needs the baked collision pack; build it once if absent
if [ ! -f out/collision.lcnav.gz ]; then
    bun tools/nav/build-collision.ts --engine "$ENGINE"
fi

cp out/client.js out/client.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/tinymidipcm.wasm "$ENGINE/public/client/"

mkdir -p "$ENGINE/public/bot"
cp out/botclient.js out/botclient.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/navworker.js out/navworker.js.map out/collision.lcnav.gz \
   out/tinymidipcm.wasm "$ENGINE/public/bot/"
cp public-bot/bot.html "$ENGINE/public/bot.html"
cp out/multibox.js out/multibox.js.map "$ENGINE/public/bot/"
cp public-bot/multibox.html "$ENGINE/public/multibox.html"

# soundfont lives in the engine repo, not ours; the bot bundle resolves it
# relative to itself
if [ -f "$ENGINE/public/client/SCC1_Florestan.sf2" ]; then
    cp "$ENGINE/public/client/SCC1_Florestan.sf2" "$ENGINE/public/bot/"
fi

echo "deployed: $ENGINE/public/bot.html (+ /bot, /client refreshed)"
