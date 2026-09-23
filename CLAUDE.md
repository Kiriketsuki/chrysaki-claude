# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**claude-statusline** is a four-line Claude Code status bar (Chrysaki Geometric Dashboard design). It renders model info, workspace context, API usage metrics, git state, and vault inbox depth inside the Claude Code UI via the `statusLine` command hook.

Installed as a git submodule at `~/.claude/statusline/` and wired up through `~/.claude/settings.json`.

## Scripts

| Script | Role |
|:---|:---|
| `statusline-command.sh` | Main renderer — reads JSON stdin + caches, emits the formatted 4-line status bar to stdout |
| `fetch-stats.sh` | Background fetcher — polls GitHub via `gh` CLI for open issue count; writes to `/tmp/.claude_stats_cache_{slug}` |

## Architecture

### Data flow

```
Stop hook        --> fetch-stats.sh (background) --> /tmp/.claude_stats_cache_{slug}
statusLine cmd   --> statusline-command.sh (reads JSON stdin + stats cache, renders 4 lines)
```

`statusline-command.sh` receives the Claude Code status JSON on stdin (piped by Claude Code) and reads all live data from it: model, context window, version, cost, and rate limits (`rate_limits.five_hour`, `rate_limits.seven_day`). Issue counts come from the stats cache written by `fetch-stats.sh`.

### Cache files

| File | Content (line-by-line) |
|:---|:---|
| `/tmp/.claude_stats_cache_{repo_slug}` | open issue count |

### Line layout

- **Line 1 (Brand Bar)**: Solid Emerald Lt model/badge; jewel-tone bridges from 9-colour pool (Emerald, Jade, Deep Teal, Royal Blue, Sapphire, Indigo, Amethyst, Twilight, Storm); version in Secondary; smart CWD; email with account colour.
- **Line 2 (Usage)**: 5h and 7d usage from native `rate_limits.*` JSON; 8-position progress bars; section marker morphs ▰→▱→◆ at thresholds; `(Xh Ym)` reset countdown from Unix epoch.
- **Line 3 (Context + Status)**: Context window bar; handoff warning at >=100k tokens; token group breakdown; vault inbox depth.
- **Line 4 (Git)**: Branch in bold jewel tone (clickable OSC 8 link); commit hash; `+N -M` changes (always shown, `+0 -0` in muted when clean); staged/unstaged counts; PR info; open issues.

### Colour thresholds

| Metric | Normal | Warning (>=50%) | Critical |
|:---|:---|:---|:---|
| 5h usage | Emerald Lt | Blonde | Ruby (>=75%) |
| 7d usage | Secondary | Blonde | Ruby (>=75%) |
| Context % | Teal | Orange | Ruby (>=80% bar) |
| Context tokens | Teal | Orange (>=50%) | Ruby (>=128k abs) |

### Column alignment

Lines 2-4 share column max variables (`mx1`..`mx5`) — each column's content is padded to the max width across all lines so bridges align vertically. All label fields are 3-char wide (`5h`, `7d`, `ctx`) and percentages use `%3d%%` format.

### Bar styles

Configurable via `CHRYSAKI_BAR_STYLE` env var. Default: `wave` (alternating ▲▼/△▽ triangles). Options: `hex`, `diamond`, `circle`, `block`.

`wave_shift` (0-3, 4-phase scroll every 2 seconds) scrolls the wave pattern for progress bars. `_jewel_seed` (from `date +%s`) drives the 9-colour jewel pool selection with prime-based per-line offsets so bridges shift colour on each render.

## Key Implementation Details

- **Jewel tone pool**: 9 colours interpolated around Emerald->Royal Blue->Amethyst. Full-brightness `JEWEL_COLORS` for text accents, dimmed `JEWEL_COLORS_DIM` for bridges. `_jewel_seed` with different prime divisors per line guarantees no two adjacent lines share a bridge colour.
- **Native rate limits**: `rate_limits.five_hour` and `rate_limits.seven_day` read directly from JSON stdin (Claude Code >= 2.1). No background fetcher or OAuth token caching needed. `compute_delta()` accepts Unix epoch directly.
- **Unicode output**: All non-ASCII chars are emitted as explicit UTF-8 byte sequences (`printf "\xe2\x96\xb2"`) for shell-locale independence.
- **Platform detection**: `uname -s` checks for `MINGW*|MSYS*|CYGWIN*` to add WinGet PATH on Windows Git Bash; no-ops on Linux/macOS.
- **Multi-account GitHub** (`fetch-stats.sh`): Selects `gh auth token --user` based on repo owner (`Jovian-Aurrigo` vs `Kiriketsuki`); exits silently for unknown owners.

## Dependencies

- `bash` >= 4.0, `jq`, `git`, `gh` (authenticated), `tput`
- On Windows: tools installed via WinGet; path `/c/Users/Kidriel/AppData/Local/Microsoft/WinGet/Links` auto-appended

**Quick test** (pipe minimal status JSON to renderer):
```bash
echo '{"model":{"display_name":"Sonnet 4.6"},"context_window":{"used_percentage":25,"context_window_size":200000,"current_usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":200,"cache_read_input_tokens":100}},"rate_limits":{"five_hour":{"used_percentage":42,"resets_at":1774520000},"seven_day":{"used_percentage":68,"resets_at":1774780000}},"cost":{"total_cost_usd":0.05,"total_duration_ms":60000,"total_api_duration_ms":5000},"workspace":{"current_dir":"'$PWD'"},"version":"2.1.84"}' \
  | bash statusline-command.sh
```
