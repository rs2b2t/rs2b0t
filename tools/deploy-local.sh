#!/bin/sh
# Build the stock client + bot client and deploy both into a local Engine's
# public/ (see docs/DEV.md). Players: /rs2.cgi untouched; bot: /bot.html.
set -e

ENGINE="${ENGINE_DIR:-$HOME/code/lostcity-dev/engine}"

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
