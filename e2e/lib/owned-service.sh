#!/bin/sh
set -eu
: > "$E2E_SERVICE_GROUPS/$$"
exec "$E2E_SERVICE_EXECUTABLE" "$@"
