#!/usr/bin/env bash
# Remove live-harness / smoke test player saves from a local Lost City engine.
#
# Adapted from LC-rs2-r377 scripts/cleanup-test-accounts.sh for the local engine.
#
# Player saves: $SERVER_ENGINE/data/players/<profile>/ or ../Server/engine/data/players/<profile>/.
# Override the engine with --engine, SERVER_ENGINE or LC_ENGINE.
#
# Default is dry-run. Pass --apply to delete.
#
# Usage:
#   bash tools/cleanup-test-accounts.sh
#   bash tools/cleanup-test-accounts.sh --apply
#   bash tools/cleanup-test-accounts.sh --prefix nvtr --prefix nv2r --apply
#   bash tools/cleanup-test-accounts.sh --all-saves --apply
#   SERVER_ENGINE=/path/to/engine bash tools/cleanup-test-accounts.sh --apply
#
# Log test accounts out before --apply; deleting a logged-in save can corrupt a running test.
# Stagger suite starts to avoid name collisions. KEEP protects accounts even with --all-saves.
#
# Compatible with macOS Bash 3.2 (no mapfile).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# SERVER_ENGINE or LC_ENGINE first, then the sibling Server checkout, then vendor/engine.
if [[ -n "${SERVER_ENGINE:-}" ]]; then
  ENGINE="$SERVER_ENGINE"
elif [[ -n "${LC_ENGINE:-}" ]]; then
  ENGINE="$LC_ENGINE"
elif [[ -d "$ROOT/../Server/engine" ]]; then
  ENGINE="$(cd "$ROOT/../Server/engine" && pwd)"
elif [[ -d "$ROOT/vendor/engine" ]]; then
  ENGINE="$ROOT/vendor/engine"
else
  ENGINE="${SERVER_ENGINE:-$ROOT/../Server/engine}"
fi
DB="${SERVER_SQLITE:-$ENGINE/db.sqlite}"
PROFILE="${PROFILE:-main}"
APPLY=0
ALL_SAVES=0
PREFIXES=""

# Harness username prefixes; nav fleets use nvtr, nv2r, nv2s, n2rg and gbrp.
# No 1-char prefixes, they match player accounts.
DEFAULT_PREFIXES="
  nvtr nv2r nv2s n2rg nvt
  gbrp gbs gbr gb
  vgl ths
  sk ds379 ds ext pw c371 i182b i182f lcs rcd scene in ks mp
  bx369 vw370 gt364 mc353
  pa sv df sbu sbp sbx re hp
  nw mz fg cs he d188w d188g th
  cln con coff
  wt rp hs hj dp fc d186t d186b d186f d186r d186n
  fu df mgd
  akd dt47 bx36 ew56
  mpsh
"

# Never delete these basenames (no .sav) even with --all-saves
KEEP="bot test test2 admin main player"

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --prefix) PREFIXES="${PREFIXES} $2"; shift 2 ;;
    --all-saves) ALL_SAVES=1; shift ;;
    --db) DB="$2"; shift 2 ;;
    --engine) ENGINE="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 1 ;;
  esac
done

if [[ -z "${PREFIXES// }" ]]; then
  PREFIXES="$DEFAULT_PREFIXES"
fi

PLAYERS_DIR="$ENGINE/data/players/$PROFILE"
if [[ ! -d "$PLAYERS_DIR" ]]; then
  echo "players dir missing: $PLAYERS_DIR" >&2
  echo "Set SERVER_ENGINE=/path/to/engine or --engine." >&2
  exit 1
fi

is_keep() {
  local base="$1" k
  for k in $KEEP; do
    [[ "$base" == "$k" ]] && return 0
  done
  return 1
}

matches_prefix() {
  local base="$1" p bl pl
  bl=$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')
  for p in $PREFIXES; do
    [[ -z "$p" ]] && continue
    pl=$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]')
    case "$bl" in
      "$pl"*) return 0 ;;
    esac
  done
  return 1
}

should_delete_save() {
  local base="$1"
  is_keep "$base" && return 1
  if [[ $ALL_SAVES -eq 1 ]]; then
    return 0
  fi
  matches_prefix "$base"
}

echo "=== rs2b0t / local engine test account cleanup ==="
echo "engine:  $ENGINE"
echo "profile: $PROFILE"
echo "sqlite:  $DB"
if [[ $APPLY -eq 1 ]]; then
  echo "mode:    APPLY"
else
  echo "mode:    DRY-RUN"
fi
if [[ $ALL_SAVES -eq 1 ]]; then
  echo "select:  all .sav except KEEP=($KEEP)"
else
  echo "select:  prefixes ($(echo $PREFIXES | tr -s '[:space:]' ' '))*"
fi
echo

# .sav files
TO_DELETE_SAV=""
n_sav=0
while IFS= read -r -d '' f; do
  bn=$(basename "$f")
  base="${bn%%.sav*}"
  if should_delete_save "$base"; then
    TO_DELETE_SAV="${TO_DELETE_SAV}${f}"$'\n'
    n_sav=$((n_sav + 1))
    echo "  sav: $bn"
  fi
done < <(find "$PLAYERS_DIR" -maxdepth 1 -type f \( -name '*.sav' -o -name '*.sav.*' \) -print0 | sort -z)

echo "player saves ($PLAYERS_DIR): $n_sav file(s) matched"
echo

# SQLite account rows (LOGIN_SERVER=true stacks)
n_sql=0
SQL_USERS=""
if [[ -f "$DB" ]] && command -v sqlite3 >/dev/null 2>&1; then
  while IFS= read -r u; do
    [[ -z "$u" ]] && continue
    if should_delete_save "$u"; then
      SQL_USERS="${SQL_USERS}${u}"$'\n'
      n_sql=$((n_sql + 1))
      echo "  sql: $u"
    fi
  done < <(sqlite3 "$DB" "SELECT username FROM account ORDER BY username;" 2>/dev/null || true)
  echo "sqlite account rows: $n_sql matched (LOGIN_SERVER=false often has 0)"
else
  echo "sqlite: skip (no db or no sqlite3)"
fi
echo

if [[ $APPLY -eq 0 ]]; then
  echo "Dry-run only. Re-run with --apply to delete."
  echo "Tip: stop live harness logins first (or wait for suites to exit)."
  exit 0
fi

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  rm -f -- "$f"
  echo "removed $f"
done <<< "$TO_DELETE_SAV"

while IFS= read -r u; do
  [[ -z "$u" ]] && continue
  ue=$(printf "%s" "$u" | sed "s/'/''/g")
  id=$(sqlite3 "$DB" "SELECT id FROM account WHERE username='$ue';")
  if [[ -z "$id" ]]; then
    continue
  fi
  sqlite3 "$DB" <<SQL
BEGIN;
DELETE FROM account_login WHERE account_id=$id;
DELETE FROM hiscore WHERE account_id=$id;
DELETE FROM hiscore_large WHERE account_id=$id;
DELETE FROM friendlist WHERE account_id=$id OR friend_account_id=$id;
DELETE FROM ignorelist WHERE account_id=$id;
DELETE FROM session WHERE account_id=$id;
DELETE FROM account WHERE id=$id;
COMMIT;
SQL
  echo "sqlite removed account id=$id user=$u"
done <<< "$SQL_USERS"

echo
echo "Done. Saves left: $(find "$PLAYERS_DIR" -maxdepth 1 -name '*.sav' | wc -l | tr -d ' ')"
