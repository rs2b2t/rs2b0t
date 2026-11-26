#!/bin/sh
set -eu

usage() { echo "Usage: sh tools/b0t-multi.sh [number-of-walls] (default 3)"; }
if [ "$#" -eq 1 ] && [ "$1" = "--help" ]; then usage; exit 0; fi
if [ "$#" -gt 1 ]; then usage >&2; exit 2; fi
B0T_WALL_COUNT=${1-3}
case "$B0T_WALL_COUNT" in ''|0*|*[!0-9]*) usage >&2; exit 2 ;; esac
if [ "$B0T_WALL_COUNT" -gt 9007199254740991 ] || ! [ "$B0T_WALL_COUNT" -gt 0 ]; then usage >&2; exit 2; fi
if [ "${B0T_VIEWER:-electron}" != electron ] || [ "${B0T_NO_OPEN:-0}" = 1 ]; then
    echo 'The multi-wall launcher requires the Electron viewer.' >&2
    exit 2
fi
export B0T_WALL_COUNT
exec sh "$(dirname "$0")/b0t.sh"
