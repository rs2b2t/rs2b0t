#!/bin/sh
# Build the stock client + bot client and deploy both into a local Engine's
# public/ (see docs/RUNNING.md#deploying-the-client). Players: /rs2.cgi
# untouched; bot: /bot.html.
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

# classic worldmap basemap + Key overlays (schema ≥2: terrain + key/multi/free)
need_basemap=0
if [ ! -f out/worldmap-basemap.manifest.json ]; then
    need_basemap=1
elif ! grep -q '"schema": 2' out/worldmap-basemap.manifest.json 2>/dev/null; then
    need_basemap=1
elif ! ls out/worldmap-key.*.png >/dev/null 2>&1; then
    need_basemap=1
fi
if [ "$need_basemap" = 1 ]; then
    bun tools/map/build-basemap.ts --engine "$ENGINE"
fi

cp out/client.js out/client.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/tinymidipcm.wasm "$ENGINE/public/client/"

mkdir -p "$ENGINE/public/bot"
cp out/botclient.js out/botclient.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/navworker.js out/navworker.js.map out/collision.lcnav.gz \
   out/tinymidipcm.wasm "$ENGINE/public/bot/"
# basemap + pre-baked overlays (fingerprinted names from the manifest)
if [ -f out/worldmap-basemap.manifest.json ]; then
    cp out/worldmap-basemap.manifest.json "$ENGINE/public/bot/"
    for f in out/worldmap-basemap.*.png out/worldmap-key.*.png out/worldmap-key-type-*.png \
             out/worldmap-labels.*.png out/worldmap-player-marker.*.png \
             out/worldmap-multi.*.png out/worldmap-free.*.png out/worldmap-key-index.*.json; do
        [ -f "$f" ] && cp "$f" "$ENGINE/public/bot/"
    done
fi
# worldmap.jag so the picker can optionally rebuild the basemap live
if [ -f out/worldmap.jag ]; then
    cp out/worldmap.jag "$ENGINE/public/bot/"
elif [ -f "$ENGINE/data/pack/mapview/worldmap.jag" ]; then
    cp "$ENGINE/data/pack/mapview/worldmap.jag" "$ENGINE/public/bot/"
fi
# Bust browser / Playwright cache of the ES module (otherwise tele path edges
# never appear live while the pack probe offline is already green).
BUST=$(date +%s)
sed "s|botclient.js?v=nav-v2|botclient.js?v=${BUST}|g; s|botclient.js\"|botclient.js?v=${BUST}\"|g" \
    public-bot/bot.html > "$ENGINE/public/bot.html"
cp out/multibox.js out/multibox.js.map "$ENGINE/public/bot/"
cp public-bot/multibox.html "$ENGINE/public/multibox.html"

# soundfont lives in the engine repo, not ours; the bot bundle resolves it
# relative to itself
if [ -f "$ENGINE/public/client/SCC1_Florestan.sf2" ]; then
    cp "$ENGINE/public/client/SCC1_Florestan.sf2" "$ENGINE/public/bot/"
fi

echo "deployed: $ENGINE/public/bot.html (+ /bot, /client refreshed)"
