#!/bin/sh
set -eu
control="$E2E_SERVICE_GROUPS/$$"
command -p mkfifo "$control"
(
    trap '' TERM HUP
    # Why: the owner must outlive the service without holding its output or Playwright's pipes.
    /bin/sh -c 'IFS= read -r stop && kill -KILL 0' <&5 5>&- >/dev/null 2>&1 3>&- 4>&- &
) 5<>"$control"
exec "$E2E_SERVICE_EXECUTABLE" "$@"
