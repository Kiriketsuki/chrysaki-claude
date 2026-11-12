#!/usr/bin/env bash
# Tests for hub_live_write in hub-status.sh. The repo has no shell test yet,
# so this script is self-contained. Run it with: bash tests/hub-live.test.sh
# Every test uses a temporary CLIPROXY_CACHE_DIR, never the real cache.

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export CLIPROXY_CACHE_DIR="$TMP/cache"
export HOME="$TMP/home"
. "$ROOT/hub-status.sh"

FAILS=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

DIR="$CLIPROXY_CACHE_DIR/work.live"
FILE="$DIR/sess-1.json"

reset() { rm -rf "$CLIPROXY_CACHE_DIR"; _hub_pool=work; _hub_seat=seat-a; }

reset
hub_live_write sess-1
check "writes the file" '[ -f "$FILE" ]'
check "content has the seat" 'jq -e ".seat == \"seat-a\"" "$FILE" >/dev/null'
check "content has written_at" 'jq -e ".written_at | type == \"number\"" "$FILE" >/dev/null'
check "folder mode is 700" '[ "$(stat -c %a "$DIR")" = 700 ]'
check "no temp file is left" '[ -z "$(find "$DIR" -name ".sess-1.*" -type f)" ]'

reset
hub_live_write sess-1
touch -d '30 seconds ago' "$FILE"
mark=$(stat -c %Y "$FILE")
hub_live_write sess-1
check "a young file with the same seat is not rewritten" '[ "$(stat -c %Y "$FILE")" = "$mark" ]'
touch -d '90 seconds ago' "$FILE"
mark=$(stat -c %Y "$FILE")
hub_live_write sess-1
check "an old file gets a heartbeat" '[ "$(stat -c %Y "$FILE")" != "$mark" ]'
touch -d '30 seconds ago' "$FILE"
_hub_seat=seat-b
hub_live_write sess-1
check "a seat change rewrites at once" 'jq -e ".seat == \"seat-b\"" "$FILE" >/dev/null'

reset
hub_live_write sess-1
_hub_seat=""
hub_live_write sess-1
check "an unknown seat keeps the old file" '[ -e "$FILE" ]'
rm -f "$FILE"
hub_live_write sess-1
check "an unknown seat writes no file" '[ ! -e "$FILE" ]'

reset
_hub_pool=""
hub_live_write sess-1
check "a session without the hub writes nothing" '[ ! -e "$CLIPROXY_CACHE_DIR" ]'

reset
hub_live_write "../evil"
hub_live_write ""
hub_live_write 'a b'
check "a bad session id writes nothing" '[ ! -e "$DIR" ] && [ ! -e "$CLIPROXY_CACHE_DIR/evil.json" ]'
_hub_seat='bad"seat'
hub_live_write sess-1
check "a bad seat name writes nothing" '[ ! -e "$FILE" ]'
_hub_seat=seat-a; _hub_pool='../x'
hub_live_write sess-1
check "a bad pool name writes nothing" '[ ! -e "$CLIPROXY_CACHE_DIR" ]'

reset
hub_live_write sess-1
printf '{}' > "$DIR/old.json"; touch -d '2 days ago' "$DIR/old.json"
printf '{}' > "$DIR/recent.json"; touch -d '2 hours ago' "$DIR/recent.json"
touch -d '90 seconds ago' "$FILE"
rm -f "$DIR/.prune.stamp"
hub_live_write sess-1
check "prune removes a file older than one day" '[ ! -e "$DIR/old.json" ]'
check "prune keeps a younger file" '[ -e "$DIR/recent.json" ]'
check "prune keeps the live file" '[ -e "$FILE" ]'

printf '{}' > "$DIR/old2.json"; touch -d '2 days ago' "$DIR/old2.json"
touch -d '90 seconds ago' "$FILE"
hub_live_write sess-1
check "prune runs at most once in 10 minutes" '[ -e "$DIR/old2.json" ]'
touch -d '11 minutes ago' "$DIR/.prune.stamp"
touch -d '90 seconds ago' "$FILE"
hub_live_write sess-1
check "prune runs again after the stamp is old" '[ ! -e "$DIR/old2.json" ]'

reset
mkdir -p "$CLIPROXY_CACHE_DIR" && chmod 500 "$CLIPROXY_CACHE_DIR"
hub_live_write sess-1; rc=$?
chmod 700 "$CLIPROXY_CACHE_DIR"
check "a write error returns 0" '[ "$rc" = 0 ]'

# Full script under the mod. The shell must still write the live file.
NOW=$(date +%s)
CACHE2="$TMP/cache2"; CONF2="$TMP/conf2"; mkdir -p "$CACHE2" "$CONF2"
cat > "$CACHE2/work.status.json" <<JSON
{"updated_epoch":$NOW,"fetched_at":$NOW,"next_seat":"seat-a","seats":[
 {"seat":"seat-a","state":"open","week_used":0.1,"five_hour_used":0.1,"week_reset_epoch":$((NOW+500000)),"five_hour_reset_epoch":$((NOW+10000))},
 {"seat":"seat-b","state":"open","week_used":0.2,"five_hour_used":0.2,"week_reset_epoch":$((NOW+300000)),"five_hour_reset_epoch":$((NOW+12000))}]}
JSON
: > "$CACHE2/work.status.try"
printf 'test-key\n' > "$CONF2/work.key"
printf 'https://hub.invalid/\n' > "$CONF2/work.url"
printf 'https://hub.invalid/status\n' > "$CONF2/work.status-url"
STDIN="{\"session_id\":\"sess-mod\",\"cwd\":\"$TMP\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":5,\"resets_at\":$((NOW+12000))},\"seven_day\":{\"used_percentage\":9,\"resets_at\":$((NOW+300000))}}}"
OUT=$(printf '%s' "$STDIN" | env -i PATH="$PATH" HOME="$TMP/home" XDG_RUNTIME_DIR="$TMP/run" \
  CLIPROXY_CACHE_DIR="$CACHE2" CLIPROXY_CONF_DIR="$CONF2" CLAUDE_HUB_POOL=work \
  CHRYSAKI_STATUSLINE_MOD=1 bash "$ROOT/statusline-command.sh" 2>&1)
check "mod mode writes the live file" 'jq -e ".seat == \"seat-b\"" "$CACHE2/work.live/sess-mod.json" >/dev/null'
check "mod mode prints nothing" '[ -z "$OUT" ]'

if [ "$FAILS" -gt 0 ]; then printf '%s test(s) failed\n' "$FAILS"; exit 1; fi
printf 'all tests passed\n'
