# chrysaki-statusline

This mod draws the Chrysaki four-line statusline in the band above the prompt. It shows the same data with the same thresholds as `statusline-command.sh`.

## What changes from the bash statusline

- The band is one more ruled section of the prompt box. Its rules and column dividers take the engine's `promptBorder` theme colour, the colour of the prompt's own rules.
- The header rule carries the model, version and folder as zigzag-alt segments, and the cost, session clock and account on the right.
- Below the header, a grid of cells spans the full width: usage, context and git at 150 columns and up, two columns from 100. Under 100 columns the band folds to one line.
- Each cell puts its label on the left and its figures flush right. A bar or a dotted leader fills the space between them, so the figures line up down each column.
- Bars default to the static `line` style: `━` for the filled part, `─` in the rule colour for the rest.
- Each segment shows a card with details on hover. The `ctx` control shows the context breakdown as a toast.
- The band yields to surveys and stacks with the band of any other mod.

The engine sends rate limits, context and cost to the mod. Git, GitHub and vault data come from `git`, `gh` and the file system. The mod caches GitHub data for 5 minutes.

## Prompt cache warning

Claude Code caches the conversation prefix. The cache lives for 1 hour on a subscription within plan usage, and for 5 minutes on an API key, a cloud provider, or in overage. Each request resets the timer. When the cache expires, the next turn writes the whole prefix again at 1.25x (5m) or 2x (1h) the input price.

The segment on the ctx line shows the time left. It is Emerald Lt while warm, Blonde inside the warning lead, and Error Lt when cold. The hover card shows the TTL, the expiry time, the tokens a cold turn writes, the hit ratio and the last miss cause.

`statusline-command.sh` writes its stdin JSON to `${XDG_RUNTIME_DIR:-/tmp}/chrysaki-statusline/<session id>.json`. The mod reads `prompt_cache` from that file. Without the file, the mod times its own requests and infers the TTL from the environment and the rate limits.

Once per warm period, inside the warning lead, the mod shows a toast and a desktop notification through `notify-send`. It warns only while no turn runs and only when a cold turn writes at least `cacheMinTokens` tokens. It sends one more notice when the cache goes cold.

## Git key

The git line carries a `g` key when the `git-pane` mod is loaded. Press `ctrl+x tab`, then `g`, to open the git pane.

## Fallback

When the mod loads, it sets `CHRYSAKI_STATUSLINE_MOD=1` for the Claude Code process. Claude Code passes the variable to the `statusLine` command, and `statusline-command.sh` then prints nothing. Without the mod, the bash statusline works as before.

Set `CHRYSAKI_STATUSLINE_BOTH=1` to keep both.

If you turn the mod off during a session, the variable stays set until the session restarts. The bash statusline stays blank until then.

## Not ported

The plugin API has no source for these fields of the bash statusline:

- tokens per second
- the cumulative input and output token totals
- the newer-version arrow

The mod also does not draw OSC 8 links.

## Options

| Option | Default | Meaning |
|:---|:---|:---|
| `barStyle` | `line` | Bar glyphs: `line`, `wave`, `hex`, `diamond`, `circle` or `block` |
| `animate` | `off` | Scroll the wave bars and pulse the badge every 2 seconds |
| `usdToSgd` | `1.35` | Multiplier for the cost segment |
| `cacheWarnLead` | `auto` | Seconds before expiry to warn: `auto` (60 for 5m, 300 for 1h), `60`, `120`, `300` or `600` |
| `cacheMinTokens` | `20000` | Warn only when a cold turn writes at least this many tokens |
| `desktopNotify` | `on` | Send the warning to the desktop through `notify-send` |
