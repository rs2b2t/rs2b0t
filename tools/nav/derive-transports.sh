#!/bin/sh
set -eu

engine_dir=${ENGINE_DIR:-}
content_dir=${CONTENT_DIR:-}
pack_path=${NAV_PACK_PATH:-out/collision.lcnav.gz}

if [ -z "$engine_dir" ] || [ -z "$content_dir" ]; then
    echo "Set ENGINE_DIR to Engine-TS and CONTENT_DIR to LostCity Content." >&2
    exit 2
fi

bun tools/nav/derive-stairs.ts \
    --engine "$engine_dir" \
    --content "$content_dir" \
    --pack "$pack_path"
python3 tools/nav/derive-ladders.py \
    --engine "$engine_dir" \
    --content "$content_dir" \
    --pack "$pack_path"
python3 tools/nav/enrich-transports.py \
    --content "$content_dir"
