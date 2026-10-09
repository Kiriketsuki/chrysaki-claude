#!/bin/sh
# Fetches open GitHub issue count for the current repo and writes to a per-repo cache.
# Cache file is keyed by repo slug so multiple Claude Code instances don't collide.
# Cross-platform: Windows Git Bash PATH additions are only applied when present.
if [ -n "${LOCALAPPDATA:-}" ]; then
  _links="$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || printf '%s' "$LOCALAPPDATA")/Microsoft/WinGet/Links"
  [ -d "$_links" ] && export PATH="$PATH:$_links"
fi
[ -d "/c/Program Files/GitHub CLI" ] && export PATH="$PATH:/c/Program Files/GitHub CLI"

remote=$(git remote get-url origin 2>/dev/null)
[ -z "$remote" ] && exit 0

# Handles HTTPS (https://github.com/owner/repo.git), SSH (git@github.com:owner/repo.git),
# and SSH aliases (git@github-work:owner/repo.git)
repo_path=$(echo "$remote" | sed 's|.*github\.com[:/]||' | sed 's|.*github-[a-z]*:||' | sed 's|\.git$||')
[ -z "$repo_path" ] && exit 0

repo_slug=$(echo "$repo_path" | tr '/' '_')
CACHE_FILE="/tmp/.claude_stats_cache_${repo_slug}"

# The personal config's githubAccounts map picks the gh account by repo owner.
# An owner it does not name uses gh's active login.
owner=$(echo "$repo_path" | cut -d'/' -f1)
PERSONAL="${CHRYSAKI_CLAUDE_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/chrysaki/claude.json}"
account=""
[ -f "$PERSONAL" ] && account=$(jq -r --arg o "$owner" '.githubAccounts[$o] // empty' "$PERSONAL" 2>/dev/null)
if [ -n "$account" ]; then
  GH_TOKEN=$(gh auth token --user "$account" 2>/dev/null)
  [ -z "$GH_TOKEN" ] && exit 0
  export GH_TOKEN
fi

issue_count=$(gh issue list --repo "$repo_path" --state open --json number 2>/dev/null | jq length 2>/dev/null)

# Detect PR for current branch
branch=$(git symbolic-ref --short HEAD 2>/dev/null)
pr_number=""
pr_title=""
if [ -n "$branch" ]; then
  _pr_json=$(gh pr list --repo "$repo_path" --head "$branch" --state open --json number,title 2>/dev/null)
  pr_number=$(echo "$_pr_json" | jq -r '.[0].number // empty' 2>/dev/null)
  pr_title=$(echo "$_pr_json" | jq -r '.[0].title // empty' 2>/dev/null)
fi

# Cache format: line 1 = issue count, line 2 = PR number, line 3 = PR title
if [ -n "$issue_count" ]; then
  printf '%s\n%s\n%s\n' "$issue_count" "$pr_number" "$pr_title" > "$CACHE_FILE"
fi
