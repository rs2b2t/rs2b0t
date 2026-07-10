#!/bin/sh
# Package the single-instance rs2b0t client as a self-contained /rs2b0t/ subtree
# under a target engine's public/. bot.html loads its assets relatively
# (./bot/…), so index.html + bot/ under /rs2b0t/ resolve with no path rewrites.
# NOT the multibox wall — single instance only.
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

DEST="$ENGINE/public/rs2b0t"
mkdir -p "$DEST/bot"
cp out/botclient.js out/botclient.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/navworker.js out/navworker.js.map out/collision.lcnav.gz out/tinymidipcm.wasm "$DEST/bot/"
cp public-bot/bot.html "$DEST/index.html"

# Cache-bust the client bundle: the served page (/rs2b0t/) is dynamic (not edge-
# cached), but botclient.js is a static asset Cloudflare caches for hours. Stamp
# the <script src> with a content hash so each build gets a fresh URL and a new
# bot client goes live immediately, without a manual cache purge.
V="$(shasum out/botclient.js | cut -c1-10)"
sed -i '' "s#\./bot/botclient\.js#./bot/botclient.js?v=$V#g" "$DEST/index.html" 2>/dev/null \
  || sed -i "s#\./bot/botclient\.js#./bot/botclient.js?v=$V#g" "$DEST/index.html"

# soundfont lives in the engine repo; the bot bundle resolves it relative to itself
if [ -f "$ENGINE/public/client/SCC1_Florestan.sf2" ]; then
    cp "$ENGINE/public/client/SCC1_Florestan.sf2" "$DEST/bot/"
fi

echo "packed: $DEST/index.html (+ /rs2b0t/bot, botclient.js?v=$V) — single instance"
