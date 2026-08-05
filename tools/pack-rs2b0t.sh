#!/bin/sh
# Package the rs2b0t client as a self-contained /rs2b0t/ subtree under a target
# engine's public/. Both pages load their assets relatively (./bot/…), so they
# resolve under /rs2b0t/ with no path rewrites.
#
# Stages the single client (index.html) AND the multibox wall (multibox.html).
# bot.html is staged too, under its own name: DomSlotOps resolves every wall slot
# to bot.html relative to baseURI, so the wall asks for /rs2b0t/bot.html.
#
# Usage: PROD_RSAN=<login-modulus> ENGINE=<engine-root-with-public> sh tools/pack-rs2b0t.sh
#
# Builds TARGET=prod (same-origin resolution + the given modulus baked in). ops/
# scripts/build.sh (in ~/code/rs2b2t) calls this while staging the engine image,
# passing the modulus it extracted from the served client.js.
set -e

: "${PROD_RSAN:?set PROD_RSAN (the prod login modulus)}"
: "${ENGINE:?set ENGINE (engine root containing public/)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -d "$ENGINE/public" ] || { echo "engine public/ not found at $ENGINE" >&2; exit 1; }

TARGET=prod PROD_RSAN="$PROD_RSAN" bun run build
TARGET=prod PROD_RSAN="$PROD_RSAN" bun run build:bot

# the nav worker needs the baked collision pack; build it once if absent
[ -f out/collision.lcnav.gz ] || bun tools/nav/build-collision.ts --engine "$ENGINE"
# classic basemap for the map picker (graceful if bake fails later — copy when present)
[ -f out/worldmap-basemap.manifest.json ] || bun tools/map/build-basemap.ts --engine "$ENGINE"

DEST="$ENGINE/public/rs2b0t"
mkdir -p "$DEST/bot"
cp out/botclient.js out/botclient.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/navworker.js out/navworker.js.map out/multibox.js out/multibox.js.map \
   out/collision.lcnav.gz out/tinymidipcm.wasm "$DEST/bot/"
if [ -f out/worldmap-basemap.manifest.json ]; then
    cp out/worldmap-basemap.manifest.json "$DEST/bot/"
    for f in out/worldmap-basemap.*.png; do
        [ -f "$f" ] && cp "$f" "$DEST/bot/"
    done
fi
if [ -f out/worldmap.jag ]; then
    cp out/worldmap.jag "$DEST/bot/"
elif [ -f "$ENGINE/data/pack/mapview/worldmap.jag" ]; then
    cp "$ENGINE/data/pack/mapview/worldmap.jag" "$DEST/bot/"
fi
cp public-bot/bot.html "$DEST/index.html"
cp public-bot/bot.html "$DEST/bot.html"
cp public-bot/multibox.html "$DEST/multibox.html"

# Cache-bust the bundles: the served pages are dynamic (not edge-cached), but
# botclient.js and multibox.js are static assets Cloudflare caches for hours.
# Stamp each <script src> with a content hash so a new build goes live
# immediately, without a manual cache purge.
V="$(shasum out/botclient.js | cut -c1-10)"
M="$(shasum out/multibox.js | cut -c1-10)"

stamp() {
    sed -i '' "$2" "$1" 2>/dev/null || sed -i "$2" "$1"
}

stamp "$DEST/index.html" "s#\./bot/botclient\.js#./bot/botclient.js?v=$V#g"
stamp "$DEST/bot.html" "s#\./bot/botclient\.js#./bot/botclient.js?v=$V#g"
stamp "$DEST/multibox.html" "s#\./bot/multibox\.js#./bot/multibox.js?v=$M#g"

# soundfont lives in the engine repo; the bot bundle resolves it relative to itself
if [ -f "$ENGINE/public/client/SCC1_Florestan.sf2" ]; then
    cp "$ENGINE/public/client/SCC1_Florestan.sf2" "$DEST/bot/"
fi

echo "packed: $DEST/index.html + multibox.html (+ /rs2b0t/bot, botclient.js?v=$V, multibox.js?v=$M)"
