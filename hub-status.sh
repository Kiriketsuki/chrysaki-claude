#!/usr/bin/env bash
# Hub status helpers for statusline-command.sh. The script sources this file.
#
# A hub session runs Claude Code through a CLIProxyAPI hub. The session
# credential is the login of one seat, but a pool seat serves the request. So
# the usage API and the rate_limits in the statusline JSON do not describe the
# session. The statusline must not present them as the session usage. This file reads the hub status
# endpoint instead, caches it, and fills the usage elements from the cache.
#
# Files:
#   ~/.config/cliproxy/<pool>.key         hub access key. Never printed or logged.
#   ~/.config/cliproxy/<pool>.url         hub base URL. Gives the one host the key may reach.
#   ~/.config/cliproxy/<pool>.status-url  status endpoint URL, one line.
#   ~/.cache/cliproxy/<pool>.status.json  cache of the last good response.
#   ~/.cache/cliproxy/<pool>.status.try   stamp. Its mtime limits fetches to one per TTL.

HUB_TTL_S="${CHRYSAKI_HUB_TTL_S:-60}"
HUB_STALE_S="${CHRYSAKI_HUB_STALE_S:-600}"
HUB_CONF_DIR="${CLIPROXY_CONF_DIR:-$HOME/.config/cliproxy}"
HUB_CACHE_DIR="${CLIPROXY_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/cliproxy}"

# A session is a hub session when CLAUDE_HUB_POOL is set. Its value is the pool
# name. The claude shell function sets the variable, and Claude Code passes it
# to the statusline command. The function sets _hub_pool, or leaves it empty.
# The session keeps its normal config dir and its own OAuth login, so the
# config dir name says nothing about the hub.
hub_detect() {
  _hub_pool=""
  case "${CLAUDE_HUB_POOL:-}" in
    ''|*[!a-z0-9-]*) return 1 ;;
  esac
  _hub_pool="$CLAUDE_HUB_POOL"
  return 0
}

_hub_host_of() { printf '%s' "$1" | sed -n 's|^https://\([^/:]*\).*|\1|p'; }

_hub_mtime() { stat -c %Y "$1" 2>/dev/null || echo 0; }

# One fetch. It runs in the background. The key goes to curl on stdin, so it
# never appears in an argument list. The key goes only to the host in
# <pool>.url, and only over https without redirects. A failure leaves the old
# cache in place and prints nothing.
_hub_fetch() {
  local pool="$1" url base key_file tmp now
  url=$(head -n 1 "$HUB_CONF_DIR/$pool.status-url" 2>/dev/null)
  base=$(head -n 1 "$HUB_CONF_DIR/$pool.url" 2>/dev/null)
  key_file="$HUB_CONF_DIR/$pool.key"
  [ -n "$url" ] && [ -r "$key_file" ] || return 0
  [ -n "$(_hub_host_of "$url")" ] && [ "$(_hub_host_of "$url")" = "$(_hub_host_of "$base")" ] || return 0
  tmp=$(mktemp "$HUB_CACHE_DIR/.$pool.status.XXXXXX" 2>/dev/null) || return 0
  if ! { printf 'Authorization: Bearer %s\n' "$(head -n 1 "$key_file")" |
         curl -sS -f -m 2 --connect-timeout 2 --proto '=https' -H @- -o "$tmp" "$url"; } 2>/dev/null; then
    rm -f "$tmp"
    return 0
  fi
  now=$(date +%s)
  local merged="$tmp.m"
  if jq -c --argjson now "$now" 'select((.seats | type) == "array") | . + { fetched_at: $now }' "$tmp" > "$merged" 2>/dev/null &&
     [ -s "$merged" ]; then
    mv -f "$merged" "$HUB_CACHE_DIR/$pool.status.json"
    _hub_write_usaki "$HUB_CACHE_DIR/$pool.status.json"
  else
    rm -f "$merged"
  fi
  rm -f "$tmp"
}

# Writes one usaKi cache file per seat, in the same shape as usaki_write_cache.
# The seat name is the usaKi account id. Fraction fields become percent.
_hub_write_usaki() {
  local status="$1" cache_dir seat tmp
  cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/usaki"
  mkdir -p "$cache_dir" 2>/dev/null || return 0
  jq -r '.seats[]?.seat // empty' "$status" 2>/dev/null | while IFS= read -r seat; do
    case "$seat" in ''|*[!A-Za-z0-9_-]*) continue ;; esac
    tmp=$(mktemp "$cache_dir/.claude-$seat.XXXXXX" 2>/dev/null) || continue
    if jq -c --arg s "$seat" --argjson now "$(date +%s)" '
        (.updated_epoch // .fetched_at) as $base
        | .seats[] | select(.seat == $s)
        | def win(u; h): if u == null then null
            else { used_percentage: ((u * 100) | round),
                   resets_at: (if h == null then null else (($base + h * 3600) | floor) end) } end;
          { account: .seat,
            five_hour: win(.five_hour_used; .five_hour_hours_left),
            seven_day: win(.week_used; .week_hours_left),
            written_at: $now }' "$status" > "$tmp" 2>/dev/null &&
       [ -s "$tmp" ]; then
      mv -f "$tmp" "$cache_dir/claude-$seat.json"
    else
      rm -f "$tmp"
    fi
  done
}

# Starts a background fetch when the last try is older than the TTL. The stamp
# changes before the fetch, so a failed hub is not tried on each render. The
# call returns at once. Render never waits for the network.
hub_refresh() {
  [ -n "${_hub_pool:-}" ] || return 0
  mkdir -p "$HUB_CACHE_DIR" 2>/dev/null && chmod 700 "$HUB_CACHE_DIR" 2>/dev/null || return 0
  local stamp="$HUB_CACHE_DIR/$_hub_pool.status.try" now
  now=$(date +%s)
  [ $(( now - $(_hub_mtime "$stamp") )) -ge "$HUB_TTL_S" ] || return 0
  : > "$stamp" 2>/dev/null || return 0
  ( _hub_fetch "$_hub_pool" >/dev/null 2>&1 & ) >/dev/null 2>&1
}

# Reads the cache and sets the hub variables. Arguments:
#   $1  reset epoch of the 5h window in the statusline JSON, or empty
#   $2  reset epoch of the 7d window in the statusline JSON, or empty
#   $3  1 when the statusline JSON carries rate_limits, else 0
# Variables:
#   _hub_ok          1 when the cache is fresh, else 0
#   _hub_seat        the seat that serves this session, or empty when unknown
#   _hub_label       text for the account slot
#   _hub_five, _hub_seven, _hub_five_reset, _hub_seven_reset
#                    usage of the seat that takes new sessions
# The statusline JSON rate_limits come from the seat that served the last
# request. The function finds that seat by its reset epochs, within 5 s. A pool
# with one seat is that seat. The function never prints.
hub_load() {
  local f_reset="${1:-}" w_reset="${2:-}" has_stdin="${3:-0}"
  _hub_ok=0; _hub_seat=""; _hub_label=""; _hub_five=""; _hub_seven=""; _hub_five_reset=""; _hub_seven_reset=""
  [ -n "${_hub_pool:-}" ] || return 0
  _hub_label="hub $_hub_pool ?"
  local file="$HUB_CACHE_DIR/$_hub_pool.status.json" now row
  [ -r "$file" ] || return 0
  now=$(date +%s)
  row=$(jq -r --argjson now "$now" --argjson stale "$HUB_STALE_S" --arg f "$f_reset" --arg w "$w_reset" '
      (.updated_epoch // .fetched_at // 0) as $upd
      | (.fetched_at // $upd) as $got
      | ([$upd, $got] | min) as $oldest
      | if ($now - $oldest) > $stale then "stale" else
        ((.seats // []) | map(select(.state == "open" or .state == "warm" or (.state == null and (.unavailable | not))))
         | length) as $open
        | ((.seats // []) | length) as $total
        | ((.next_seat // ((.seats // []) | sort_by(-(.priority // 0)) | .[0].seat // "")) // "") as $next
        | ((.seats // []) | map(select(.seat == $next)) | .[0]) as $s
        | def pct(u): if u == null then "" else ((u * 100) | round | tostring) end;
          def rst(e; h): if e != null then (e | tostring)
            elif h == null then "" else (($upd + h * 3600) | floor | tostring) end;
          def near(a; b): a != null and b != null and ((a - b) | fabs) <= 5;
          def pick: if length == 1 then .[0].seat else "" end;
          (.seats // []) as $seats
          | ($w | tonumber? // null) as $wn | ($f | tonumber? // null) as $fn
          | ($seats | map(select(near(.week_reset_epoch; $wn)))) as $wc
          | ($seats | map(select(near(.five_hour_reset_epoch; $fn)))) as $fc
          | ($wc | map(select(near(.five_hour_reset_epoch; $fn)))) as $both
          | (if $total == 1 then $seats[0].seat
             else ([($wc | pick), ($both | pick), ($fc | pick)] | map(select(. != "")) | .[0] // "") end) as $cur
          | [ $open, $total, $next, $cur, pct($s.five_hour_used), pct($s.week_used),
              rst($s.five_hour_reset_epoch; $s.five_hour_hours_left),
              rst($s.week_reset_epoch; $s.week_hours_left) ]
          | map(tostring) | join("|")
        end' "$file" 2>/dev/null)
  [ -n "$row" ] && [ "$row" != "stale" ] || return 0
  local open total next
  IFS='|' read -r open total next _hub_seat _hub_five _hub_seven _hub_five_reset _hub_seven_reset <<< "$row"
  _hub_ok=1
  # The label names the seat that serves the session. A ">" marks the next
  # seat, which the bars describe only when the JSON has no rate_limits.
  local count=""
  [ "$total" -gt 1 ] 2>/dev/null && count=" $open/$total"
  if [ -n "$_hub_seat" ]; then
    _hub_label="hub $_hub_pool $_hub_seat$count"
  elif [ "$has_stdin" = 1 ]; then
    _hub_label="hub $_hub_pool ?$count"
  else
    _hub_label="hub $_hub_pool${next:+ > $next}$count"
  fi
}

# Writes the live session file of one hub session. usaKi counts these files to
# show the live sessions of each seat. Argument: the session id.
#   <cache>/<pool>.live/<session id>.json   {"seat":"<seat>","written_at":<epoch s>}
# usaKi counts a file when written_at is at most 600 s old. A heartbeat each
# HUB_LIVE_HEARTBEAT_S keeps the file inside that window, and a young file
# with the same seat is not rewritten. A session with an unknown seat writes
# nothing and keeps its old file. The file then ages out through written_at, and
# the prune deletes it after one day. This keeps a second writer of the same file
# safe. The prune runs at most once each HUB_LIVE_PRUNE_EVERY_S. The function
# never prints and always returns 0, so it never fails the statusline.
HUB_LIVE_HEARTBEAT_S="${CHRYSAKI_HUB_LIVE_HEARTBEAT_S:-60}"
HUB_LIVE_PRUNE_MIN=1440
HUB_LIVE_PRUNE_EVERY_S=600

hub_live_write() {
  local sid="${1:-}" dir file tmp now
  case "${_hub_pool:-}" in ''|*[!a-z0-9-]*) return 0 ;; esac
  case "$sid" in ''|*[!A-Za-z0-9_-]*) return 0 ;; esac
  dir="$HUB_CACHE_DIR/$_hub_pool.live"
  file="$dir/$sid.json"
  case "${_hub_seat:-}" in ''|*[!A-Za-z0-9_-]*) return 0 ;; esac
  now=$(date +%s)
  if [ -f "$file" ] && [ $(( now - $(_hub_mtime "$file") )) -lt "$HUB_LIVE_HEARTBEAT_S" ] &&
     grep -qF "\"seat\":\"$_hub_seat\"" "$file" 2>/dev/null; then
    return 0
  fi
  mkdir -p "$dir" 2>/dev/null && chmod 700 "$dir" 2>/dev/null || return 0
  tmp=$(mktemp "$dir/.$sid.XXXXXX" 2>/dev/null) || return 0
  if printf '{"seat":"%s","written_at":%s}\n' "$_hub_seat" "$now" > "$tmp" 2>/dev/null; then
    mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
  else
    rm -f "$tmp"
  fi
  local stamp="$dir/.prune.stamp"
  if [ $(( now - $(_hub_mtime "$stamp") )) -ge "$HUB_LIVE_PRUNE_EVERY_S" ]; then
    : > "$stamp" 2>/dev/null
    find "$dir" -maxdepth 1 -type f -name '*.json' -mmin +"$HUB_LIVE_PRUNE_MIN" -delete 2>/dev/null
  fi
  return 0
}
