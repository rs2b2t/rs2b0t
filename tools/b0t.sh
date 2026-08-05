#!/bin/sh
# `bun run b0t` — build the rs2b0t LIVE client and open the WALL against w1.rs2b2t.com,
# fully local. Mirrors the legacy `wall` command: fetch rs2b2t's current login key,
# build TARGET=live with it, start the local reverse proxy (serves your client from
# disk + forwards /crc and the cache WebSocket to live), then open a dedicated viewer.
# Your client is never hosted on rs2b2t; only game traffic leaves this box.
#
# In the wall: add bots with REGISTERED rs2b2t accounts (prod registration is on —
# no auto-create). A single bot is just a focused 1-cell wall.
# Viewer env:
#   B0T_VIEWER=electron|chrome|firefox|none (default electron)
#   B0T_NO_OPEN=1                         legacy alias for B0T_VIEWER=none
#   B0T_RESOURCE_PID=<pid>                monitor an already-dedicated external viewer
#   B0T_CDP_PORT=9223                     Chrome DevTools/MCP attachment port
#   B0T_PROFILE_DIR=<path>                managed browser profile override
# General env: PORT (8081), RS2B2T_WS (wss://w1.rs2b2t.com).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ "${B0T_NO_OPEN:-0}" = "1" ] && VIEWER=none || VIEWER="${B0T_VIEWER:-electron}"
case "$VIEWER" in
    electron|chrome|firefox|none) ;;
    *) echo "ERROR: unknown B0T_VIEWER '$VIEWER' (use electron, chrome, firefox, or none)." >&2; exit 1 ;;
esac

PORT="${PORT:-8081}"
WS="${RS2B2T_WS:-wss://w1.rs2b2t.com}"
HTTP="$(printf '%s' "$WS" | sed -E 's,^ws,http,')"
HOST="$(printf '%s' "$WS" | sed -E 's,^wss?://,,')"

LOCK_DIR="$ROOT/.b0t-launch.lock"
LOCK_OWNER_FILE="$LOCK_DIR/owner.pid"
LOCK_HELD=0
RUN_DIR=''
RESOURCE_PID_FILE=''
VIEWER_PID=''
PROXY_PID=''
VIEWER_SCOPE_UNIT=''

# Sets CHILD_STATE to running, zombie, gone, or not-owned. Checking the direct
# parent prevents cleanup from signalling a stale PID that has been reused by a
# process this launcher does not own. A zombie must be reaped, not signalled.
child_state() {
    CHILD_STATE=gone
    [ -n "$1" ] || return 0
    if CHILD_INFO=$(ps -o ppid= -o stat= -p "$1" 2>/dev/null); then
        set -- $CHILD_INFO
        [ "$#" -ge 2 ] || return 0
        if [ "$1" != "$$" ]; then
            CHILD_STATE=not-owned
            return 0
        fi
        case "$2" in
            Z*) CHILD_STATE=zombie ;;
            *) CHILD_STATE=running ;;
        esac
    fi
}

signal_owned_child() {
    SIGNAL_PID="$1"
    SIGNAL_NAME="$2"
    child_state "$SIGNAL_PID"
    if [ "$CHILD_STATE" = "running" ]; then
        kill -TERM "$SIGNAL_PID" 2>/dev/null || true
    elif [ "$CHILD_STATE" = "not-owned" ]; then
        echo "WARNING: refusing to signal stale $SIGNAL_NAME PID $SIGNAL_PID." >&2
    fi
}

reap_owned_child() {
    REAP_PID="$1"
    REAP_NAME="$2"
    REAP_TRIES=0
    child_state "$REAP_PID"
    while [ "$CHILD_STATE" = "running" ] && [ "$REAP_TRIES" -lt 50 ]; do
        sleep 0.1
        REAP_TRIES=$((REAP_TRIES + 1))
        child_state "$REAP_PID"
    done
    if [ "$CHILD_STATE" = "running" ]; then
        echo "WARNING: $REAP_NAME PID $REAP_PID did not stop; sending KILL." >&2
        # Re-check ownership immediately before escalation.
        child_state "$REAP_PID"
        [ "$CHILD_STATE" != "running" ] || kill -KILL "$REAP_PID" 2>/dev/null || true
    fi
    # wait either reaps the exact child or consumes the status already retained
    # by the shell. It never signals a process that reused the numeric PID.
    wait "$REAP_PID" 2>/dev/null || true
}

cleanup() {
    CLEANUP_STATUS=$?
    # Cleanup must finish even if a second terminal signal arrives.
    trap - 0
    trap '' HUP INT QUIT TERM
    set +e

    CLEANUP_VIEWER_PID="$VIEWER_PID"
    CLEANUP_PROXY_PID="$PROXY_PID"
    VIEWER_PID=''
    PROXY_PID=''

    [ -z "$RESOURCE_PID_FILE" ] || rm -f "$RESOURCE_PID_FILE"

    # Signal both exact, currently-owned children before waiting on either one.
    [ -z "$CLEANUP_VIEWER_PID" ] || signal_owned_child "$CLEANUP_VIEWER_PID" viewer
    [ -z "$CLEANUP_PROXY_PID" ] || signal_owned_child "$CLEANUP_PROXY_PID" proxy
    [ -z "$CLEANUP_VIEWER_PID" ] || reap_owned_child "$CLEANUP_VIEWER_PID" viewer
    [ -z "$CLEANUP_PROXY_PID" ] || reap_owned_child "$CLEANUP_PROXY_PID" proxy

    if [ -n "$VIEWER_SCOPE_UNIT" ]; then
        # Stop only this launcher's exact transient scope. This catches browser
        # content children that can briefly outlive the registered root.
        systemctl --user stop "$VIEWER_SCOPE_UNIT" 2>/dev/null || true
        VIEWER_SCOPE_UNIT=''
    fi

    [ -z "$RUN_DIR" ] || rmdir "$RUN_DIR" 2>/dev/null || true
    if [ "$LOCK_HELD" = "1" ]; then
        rm -f "$LOCK_OWNER_FILE"
        rmdir "$LOCK_DIR" 2>/dev/null || true
        LOCK_HELD=0
    fi
    exit "$CLEANUP_STATUS"
}

prepare_viewer_scope() {
    [ "$(uname -s)" = "Linux" ] || return 0
    [ -r /sys/fs/cgroup/cgroup.controllers ] || {
        echo "ERROR: exact Linux browser telemetry requires cgroup v2." >&2
        return 1
    }
    command -v systemd-run >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 || {
        echo "ERROR: exact Linux browser telemetry requires systemd-run and systemctl." >&2
        return 1
    }
    systemctl --user show-environment >/dev/null 2>&1 || {
        echo "ERROR: exact Linux browser telemetry requires a running user systemd manager." >&2
        return 1
    }
    VIEWER_SCOPE_UNIT="rs2b0t-viewer-$$.scope"
    if systemctl --user is-active --quiet "$VIEWER_SCOPE_UNIT"; then
        echo "ERROR: dedicated browser scope $VIEWER_SCOPE_UNIT already exists." >&2
        VIEWER_SCOPE_UNIT=''
        return 1
    fi
}

launch_managed_viewer() {
    VIEWER_CWD_ARG="$1"
    shift
    if [ -n "$VIEWER_SCOPE_UNIT" ]; then
        /bin/sh -c '
            viewer_scope=$1
            viewer_cwd=$2
            shift 2
            cd "$viewer_cwd" || exit 126
            exec systemd-run --user --scope --quiet \
                --unit="$viewer_scope" \
                --property=MemoryAccounting=yes \
                -- "$@"
        ' rs2b0t-viewer "$VIEWER_SCOPE_UNIT" "$VIEWER_CWD_ARG" "$@" &
    else
        ( cd "$VIEWER_CWD_ARG" && exec "$@" ) &
    fi
    VIEWER_PID=$!
}

wait_for_viewer_telemetry() {
    [ "$(uname -s)" = "Linux" ] || return 0
    VIEWER_TELEMETRY_TRIES=0
    while [ "$VIEWER_TELEMETRY_TRIES" -lt 50 ]; do
        child_state "$VIEWER_PID"
        [ "$CHILD_STATE" = "running" ] || break
        VIEWER_CGROUP_REL=$(awk -F: '$1 == "0" { print $3; exit }' "/proc/$VIEWER_PID/cgroup" 2>/dev/null || true)
        VIEWER_CGROUP_LEAF=${VIEWER_CGROUP_REL##*/}
        case "$VIEWER_CGROUP_LEAF" in
            rs2b0t-viewer-*.scope)
                VIEWER_CGROUP_DIR="/sys/fs/cgroup$VIEWER_CGROUP_REL"
                if [ -r "$VIEWER_CGROUP_DIR/cpu.stat" ] && [ -r "$VIEWER_CGROUP_DIR/memory.current" ]; then
                    return 0
                fi
                ;;
        esac
        sleep 0.1
        VIEWER_TELEMETRY_TRIES=$((VIEWER_TELEMETRY_TRIES + 1))
    done
    echo "ERROR: managed viewer did not enter a CPU+memory-accounted rs2b0t scope." >&2
    return 1
}

trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 131' QUIT
trap 'exit 143' TERM

# Deliberately omit curl -f: any valid HTTP response proves that the port is
# already serving something and must not be rebuilt over or interrupted.
if curl -s --max-time 1 -o /dev/null "http://localhost:$PORT/multibox.html" 2>/dev/null; then
    echo "ERROR: a wall is already running on :$PORT; refusing to rebuild or interrupt it." >&2
    exit 1
fi

# mkdir is the portable atomic lock primitive. The lock spans the build and the
# entire launcher lifetime, so another PORT cannot rebuild this checkout's out/.
if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_HELD=1
    printf '%s\n' "$$" > "$LOCK_OWNER_FILE"
else
    LOCK_OWNER='unknown'
    if [ -r "$LOCK_OWNER_FILE" ]; then
        IFS= read -r LOCK_OWNER < "$LOCK_OWNER_FILE" || true
        [ -n "$LOCK_OWNER" ] || LOCK_OWNER='unknown'
    fi
    echo "ERROR: another b0t launcher owns this checkout (PID $LOCK_OWNER); refusing to rebuild." >&2
    echo "       If that process was killed uncleanly, verify it is gone before removing $LOCK_DIR." >&2
    exit 1
fi

[ -d node_modules ] || { echo "→ installing deps…"; bun install; }
if [ "$VIEWER" = "electron" ]; then
    [ -d desktop/node_modules/electron ] || { echo "→ installing the Electron wall (first run downloads Electron)…"; ( cd desktop && bun install ); }
fi

# Fetch the live login modulus from rs2b2t's served client (PUBLIC key), so a key
# rotation never leaves us stale — the one very long digit run in the minified JS.
echo "→ fetching rs2b2t login key + building live client…"
MOD=$(curl -s --max-time 15 "$HTTP/client/client.js" | grep -oE '[0-9]+' | awk 'length($0) >= 250 { print; exit }')
[ -n "$MOD" ] || { echo "ERROR: could not fetch the rs2b2t login modulus from $HTTP/client/client.js" >&2; exit 1; }
TARGET=live LIVE_RSAN="$MOD" bun run build:bot >/dev/null
echo "  built live client (login key fetched from $HOST)."

# The nav worker needs the baked collision pack; `build:bot` does NOT produce it
# (it's generated from the engine's map cache). A fresh checkout/worktree without
# it would 404 the pack and every bot's navigator dies silently — build it here,
# like deploy-local.sh does.
if [ ! -f out/collision.lcnav.gz ]; then
    echo "→ collision pack missing — baking it from the engine map cache…"
    bun tools/nav/build-collision.ts --engine "${ENGINE_DIR:-$HOME/code/rs2b2t-engine}"
fi
if [ ! -f out/worldmap-basemap.manifest.json ]; then
    echo "→ worldmap basemap missing — baking from worldmap.jag…"
    bun tools/map/build-basemap.ts --engine "${ENGINE_DIR:-$HOME/code/rs2b2t-engine}"
fi

RUN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/rs2b0t.XXXXXX")
RESOURCE_PID_FILE="$RUN_DIR/viewer.pid"

reap_proxy() {
    REAPED_PROXY_PID="$PROXY_PID"
    PROXY_EXIT_STATUS=0
    if wait "$REAPED_PROXY_PID"; then
        PROXY_EXIT_STATUS=0
    else
        PROXY_EXIT_STATUS=$?
    fi
    # Clear only after wait has consumed this exact child's status.
    PROXY_PID=''
}

reap_viewer() {
    REAPED_VIEWER_PID="$VIEWER_PID"
    VIEWER_EXIT_STATUS=0
    if wait "$REAPED_VIEWER_PID"; then
        VIEWER_EXIT_STATUS=0
    else
        VIEWER_EXIT_STATUS=$?
    fi
    # External telemetry PIDs are never stored here and can never reach cleanup.
    VIEWER_PID=''
}

supervise_managed_viewer() {
    SUPERVISED_VIEWER_KIND="$1"
    while :; do
        # Check the proxy first: if both children exit between polls, loss of the
        # proxy is the failure that makes every connected wall unusable.
        child_state "$PROXY_PID"
        SUPERVISED_PROXY_STATE="$CHILD_STATE"
        if [ "$SUPERVISED_PROXY_STATE" != "running" ]; then
            reap_proxy
            echo "ERROR: proxy exited while the $SUPERVISED_VIEWER_KIND viewer was running (status $PROXY_EXIT_STATUS)." >&2
            echo "       The owned viewer will be closed; no external PID will be signalled." >&2
            [ "$PROXY_EXIT_STATUS" -ne 0 ] && return "$PROXY_EXIT_STATUS"
            return 1
        fi

        child_state "$VIEWER_PID"
        SUPERVISED_VIEWER_STATE="$CHILD_STATE"
        if [ "$SUPERVISED_VIEWER_STATE" != "running" ]; then
            reap_viewer
            rm -f "$RESOURCE_PID_FILE" || true
            echo "→ $SUPERVISED_VIEWER_KIND viewer exited (status $VIEWER_EXIT_STATUS); CPU/RAM telemetry is unavailable."
            echo "→ proxy remains up at $URL; waiting for Ctrl-C/TERM or proxy exit."

            # With no owned viewer left, blocking in wait reaps the proxy as soon
            # as it exits. Preserve a proxy failure, then a viewer failure.
            reap_proxy
            [ "$PROXY_EXIT_STATUS" -eq 0 ] || return "$PROXY_EXIT_STATUS"
            [ "$VIEWER_EXIT_STATUS" -eq 0 ] || return "$VIEWER_EXIT_STATUS"
            return 0
        fi

        sleep 0.25
    done
}

echo "→ starting local proxy on :$PORT → $HOST …"
PROXY_RESOURCE_PID=''
if [ "$VIEWER" = "none" ]; then
    PROXY_RESOURCE_PID="${B0T_RESOURCE_PID:-}"
fi
PORT="$PORT" LIVE_HOST="$HOST" B0T_RESOURCE_PID_FILE="$RESOURCE_PID_FILE" B0T_RESOURCE_PID="$PROXY_RESOURCE_PID" bun tools/live-proxy.ts &
PROXY_PID=$!

i=0
PROXY_READY=0
while [ "$i" -lt 40 ]; do
    child_state "$PROXY_PID"
    if [ "$CHILD_STATE" != "running" ]; then
        reap_proxy
        echo "ERROR: owned proxy exited during startup (status $PROXY_EXIT_STATUS)." >&2
        if [ "$PROXY_EXIT_STATUS" -eq 0 ]; then
            exit 1
        fi
        exit "$PROXY_EXIT_STATUS"
    fi
    if curl -s --max-time 1 -o /dev/null "http://localhost:$PORT/multibox.html" 2>/dev/null; then
        # Do not accept a response from a concurrently started/unrelated server
        # after our own child has already lost the bind race.
        child_state "$PROXY_PID"
        if [ "$CHILD_STATE" = "running" ]; then
            PROXY_READY=1
            break
        fi
    fi
    i=$((i + 1))
    sleep 0.3
done
[ "$PROXY_READY" = "1" ] || { echo "ERROR: proxy did not come up on :$PORT" >&2; exit 1; }

URL="http://localhost:$PORT/multibox.html"
echo "  Add bots with REGISTERED rs2b2t accounts; they play on the live server."

case "$VIEWER" in
    none)
        if [ -n "${B0T_RESOURCE_PID:-}" ]; then
            printf '%s\n' "$B0T_RESOURCE_PID" > "$RESOURCE_PID_FILE"
            echo "→ proxy up at $URL  (monitoring dedicated viewer PID $B0T_RESOURCE_PID)"
        else
            echo "→ proxy up at $URL  (viewer not launched; CPU/RAM telemetry unavailable)"
        fi
        reap_proxy
        exit "$PROXY_EXIT_STATUS"
        ;;
    electron)
        echo "→ opening the Electron wall against LIVE rs2b2t: $URL"
        prepare_viewer_scope
        launch_managed_viewer "$ROOT/desktop" ./node_modules/.bin/electron . --server="$URL"
        wait_for_viewer_telemetry
        printf '%s\n' "$VIEWER_PID" > "$RESOURCE_PID_FILE"
        supervise_managed_viewer electron
        ;;
    chrome)
        CHROME_BIN="${B0T_CHROME_BIN:-}"
        if [ -z "$CHROME_BIN" ]; then
            for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
                if command -v "$candidate" >/dev/null 2>&1; then
                    CHROME_BIN=$(command -v "$candidate")
                    break
                fi
            done
        fi
        [ -n "$CHROME_BIN" ] && [ -x "$CHROME_BIN" ] || { echo "ERROR: Chrome/Chromium not found; set B0T_CHROME_BIN." >&2; exit 1; }
        PROFILE_DIR="${B0T_PROFILE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/rs2b0t/chrome-profile}"
        CDP_PORT="${B0T_CDP_PORT:-9223}"
        mkdir -p "$PROFILE_DIR"
        echo "→ opening a dedicated Chrome wall (MCP/CDP: http://127.0.0.1:$CDP_PORT)"
        prepare_viewer_scope
        launch_managed_viewer "$ROOT" "$CHROME_BIN" \
            --user-data-dir="$PROFILE_DIR" \
            --remote-debugging-address=127.0.0.1 \
            --remote-debugging-port="$CDP_PORT" \
            --disable-background-timer-throttling \
            --disable-backgrounding-occluded-windows \
            --disable-renderer-backgrounding \
            --app="$URL"
        wait_for_viewer_telemetry
        printf '%s\n' "$VIEWER_PID" > "$RESOURCE_PID_FILE"
        supervise_managed_viewer chrome
        ;;
    firefox)
        FIREFOX_BIN="${B0T_FIREFOX_BIN:-}"
        if [ -z "$FIREFOX_BIN" ] && command -v firefox >/dev/null 2>&1; then
            FIREFOX_BIN=$(command -v firefox)
        fi
        [ -n "$FIREFOX_BIN" ] && [ -x "$FIREFOX_BIN" ] || { echo "ERROR: Firefox not found; set B0T_FIREFOX_BIN." >&2; exit 1; }
        PROFILE_DIR="${B0T_PROFILE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/rs2b0t/firefox-profile}"
        mkdir -p "$PROFILE_DIR"
        echo "→ opening a dedicated Firefox wall against LIVE rs2b2t: $URL"
        prepare_viewer_scope
        launch_managed_viewer "$ROOT" "$FIREFOX_BIN" --no-remote --profile "$PROFILE_DIR" "$URL"
        wait_for_viewer_telemetry
        printf '%s\n' "$VIEWER_PID" > "$RESOURCE_PID_FILE"
        supervise_managed_viewer firefox
        ;;
esac
