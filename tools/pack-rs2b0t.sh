#!/bin/sh
# Package the client under the engine's public/rs2b0t/; asset URLs are relative.
# Include index.html, multibox.html and bot.html; wall slots resolve bot.html against baseURI.
#
# Usage: PROD_RSAN=<login-modulus> ENGINE=<engine-root-with-public> sh tools/pack-rs2b0t.sh
#
# ops/scripts/build.sh builds TARGET=prod with the modulus from the served client.js.
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
# classic basemap for the map picker; copied below only when the bake produced one
[ -f out/worldmap-basemap.manifest.json ] || bun tools/map/build-basemap.ts --engine "$ENGINE"

DEST="$ENGINE/public/rs2b0t"
mkdir -p "$DEST/bot"
cp out/botclient.js out/botclient.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/navworker.js out/navworker.js.map out/multibox.js out/multibox.js.map \
   out/collision.lcnav.gz out/tinymidipcm.wasm "$DEST/bot/"
# deploy fingerprint: curl /rs2b0t/version.json (also under /rs2b0t/bot/)
if [ -f out/version.json ]; then
    cp out/version.json "$DEST/version.json"
    cp out/version.json "$DEST/bot/version.json"
fi
if [ -f out/worldmap-basemap.manifest.json ]; then
    cp out/worldmap-basemap.manifest.json "$DEST/bot/"
    for f in out/worldmap-basemap.*.png out/worldmap-key.*.png out/worldmap-key-type-*.png \
             out/worldmap-labels.*.png out/worldmap-player-marker.*.png \
             out/worldmap-multi.*.png out/worldmap-free.*.png out/worldmap-key-index.*.json; do
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

# Why: Cloudflare caches the bundles for hours; hash their script URLs to load a new build without a purge.
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

GIT_LABEL=''
if [ -f out/version.json ]; then
    GIT_LABEL=" git=$(sed -n 's/.*"label": "\([^"]*\)".*/\1/p' out/version.json | head -1)"
fi
echo "packed: $DEST/index.html + multibox.html (+ /rs2b0t/bot, botclient.js?v=$V, multibox.js?v=$M)$GIT_LABEL"
