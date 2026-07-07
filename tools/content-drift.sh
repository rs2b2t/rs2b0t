#!/usr/bin/env bash
# Diff tranche quest content between the dev engine content and rs2b2t-content.
# Usage: tools/content-drift.sh [dev-content-root] [prod-content-root]
set -u
DEV="${1:-$HOME/code/lostcity-dev/content}"
PROD="${2:-$HOME/code/rs2b2t-content}"
DIRS=(tutorial quests/quest_cook quests/quest_sheep quests/quest_priest \
  quests/quest_runemysteries quests/quest_romeojuliet quests/quest_waterfall \
  quests/quest_vampire quests/quest_haunted quests/quest_doric quests/quest_squire \
  quests/quest_gobdip quests/quest_blackknight quests/quest_hunt quests/quest_ball)
status=0
for d in "${DIRS[@]}"; do
  if ! diff -rq "$DEV/scripts/$d" "$PROD/scripts/$d" >/tmp/drift.$$ 2>&1; then
    echo "DRIFT: $d"; cat /tmp/drift.$$; status=1
  else
    echo "ok: $d"
  fi
done
rm -f /tmp/drift.$$
exit $status
