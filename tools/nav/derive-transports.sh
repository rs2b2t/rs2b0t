#!/bin/sh
set -eu

engine_dir=${ENGINE_DIR:-}
content_dir=${CONTENT_DIR:-}
pack_path=${NAV_PACK_PATH:-out/collision.lcnav.gz}

if [ -z "$engine_dir" ] || [ -z "$content_dir" ]; then
    echo "Set ENGINE_DIR to Engine-TS and CONTENT_DIR to LostCity Content." >&2
    exit 2
fi

data=src/bot/event/webwalk/data
stage=$(mktemp -d "$data/.derive-transports.XXXXXX")
trap 'rm -rf "$stage"' EXIT
trap 'exit 1' HUP INT TERM
staged_data="$stage/$data"
mkdir -p "$staged_data"
cp "$data/transports.json" "$staged_data/transports.json"

bun tools/nav/derive-stairs.ts \
    --engine "$engine_dir" \
    --content "$content_dir" \
    --pack "$pack_path" \
    --out "$staged_data/stairEdges.json"
python3 tools/nav/derive-ladders.py \
    --engine "$engine_dir" \
    --content "$content_dir" \
    --pack "$pack_path" \
    --rs2b0t "$stage"
python3 tools/nav/enrich-transports.py \
    --content "$content_dir" \
    --rs2b0t "$stage" \
    --transports-output "$staged_data/transports.json" \
    --stairs-output "$staged_data/stairEdges.json"

mv "$staged_data/transports.json" "$staged_data/stairEdges.json" "$data/"
