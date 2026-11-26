#!/bin/sh
# Build the stock client and the bot client and deploy both into a local engine's public/ (see docs/how-to/run-locally.md#deploy-the-client).
# Players keep /rs2.cgi; the bot lands at /bot.html.
set -e

ENGINE="${ENGINE_DIR:-$HOME/code/rs2b2t-engine}"

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

bun tools/map/build-basemap.ts --if-needed --engine "$ENGINE" --publish-to "$ENGINE/public/bot"
cp out/client.js out/client.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/tinymidipcm.wasm "$ENGINE/public/client/"

mkdir -p "$ENGINE/public/bot"
cp out/botclient.js out/botclient.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/navworker.js out/navworker.js.map out/collision.lcnav.gz \
   out/tinymidipcm.wasm "$ENGINE/public/bot/"
# Change the module URL so browsers and Playwright load the new build.
BUST=$(date +%s)
sed "s|botclient.js?v=nav-v2|botclient.js?v=${BUST}|g; s|botclient.js\"|botclient.js?v=${BUST}\"|g" \
    public-bot/bot.html > "$ENGINE/public/bot.html"
cp out/multibox.js out/multibox.js.map "$ENGINE/public/bot/"
cp public-bot/multibox.html "$ENGINE/public/multibox.html"
if [ -f out/version.json ]; then
    cp out/version.json "$ENGINE/public/bot/version.json"
fi

# the soundfont lives in the engine repo; the bot bundle resolves it relative to itself
if [ -f "$ENGINE/public/client/SCC1_Florestan.sf2" ]; then
    cp "$ENGINE/public/client/SCC1_Florestan.sf2" "$ENGINE/public/bot/"
fi

echo "deployed: $ENGINE/public/bot.html (+ /bot, /client refreshed)"
