# chrysaki-statusline

This mod draws the Chrysaki four-line statusline in the band above the prompt. It shows the same data with the same thresholds as `statusline-command.sh`.

## What changes from the bash statusline

- Segment edges follow the tmux zigzag-alt preset `(|,\)`, with the same powerline glyphs as `chrysaki/tmux/chrysaki.conf`.
- On the terminal, a Raster draws the progress bars and the tri-primary brand gradient. The gradient mixes colours in OKLab. The desktop surface draws text bars.
- Each segment shows a card with details on hover.
- The `ctx` control shows the context breakdown as a toast.
- Under 100 columns the band folds to two lines.
- The band yields to surveys and stacks with the band of any other mod, such as `git-pane`.

The engine sends rate limits, context and cost to the mod. Git, GitHub and vault data come from `git`, `gh` and the file system. The mod caches GitHub data for 5 minutes.

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
| `barStyle` | `wave` | Bar glyphs: `wave`, `hex`, `diamond`, `circle` or `block` |
| `animate` | `on` | Scroll the bars and the gradient every 2 seconds |
| `usdToSgd` | `1.35` | Multiplier for the cost segment |
