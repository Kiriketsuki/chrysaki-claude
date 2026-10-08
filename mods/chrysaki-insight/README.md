# chrysaki-insight

A session insight pane for Claude Code, in the Chrysaki look. The header copies the tmux window list: a badge, then zigzag-alt tab islands on the Abyss ground. The panel uses the same double border as git-pane.

## Open it

| Command | Opens |
|:---|:---|
| `/insight` | the tab last shown (context at first) |
| `/insight context` | the context tab |
| `/insight turns` | the turns tab |
| `/insight activity` | the activity tab |

## Keys in the pane

| Key | Action |
|:---|:---|
| `1` / `2` / `3` | context, turns, activity |
| `r` | refresh the context breakdown |
| `q` or Esc | close |

## Tabs

- **context**: each category of the context window as a bar, largest first, with tokens and the share of the window. Free space, the compaction buffer and deferred tool schemas follow in muted colour. The tab reads the breakdown when it shows and after each main-thread turn while the pane is open.
- **turns**: one row per main-thread model request, newest first: time, input, output, cache read, cache write and cache hit percent. The API reports no price per request, so the footer shows the session total cost once.
- **activity**: tool calls and subagents together. Running items come first with a live elapsed time. A failed or denied call shows a cross. A subagent row shows its type, its task and its token total.

The pane keeps the last 200 turns, 200 tool calls and 200 subagents in `$.state`.

## Idle cost

No timer runs while the pane is closed. The one-second redraw runs only while the pane is open on the activity tab and an item runs. The context breakdown uses the token-count API, so it runs only for the context tab.
