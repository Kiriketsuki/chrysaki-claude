# chrysaki-statusline

This mod draws the Chrysaki four-line statusline in the band above the prompt. It shows the same data as `statusline-command.sh`, with the same thresholds except for context.

## What changes from the bash statusline

- The band is one more ruled section of the prompt box. Its rules and column dividers take the engine's `promptBorder` theme colour, the colour of the prompt's own rules.
- The header rule carries the model, version and folder as zigzag-alt segments, and the cost, session clock and account on the right. The segments step down through dark grounds, Abyss to Raised to Elevated. The type carries the colour: the model name, the folder and the account run a gradient letter by letter. A work account inks in Topaz. On the terminal a faint brand gradient drifts along the header rule. When the segments do not fit, the header drops the version first, then the session clock, the folder and the account. The model, the outage badge and the cost always stay.
- On a terminal band of 150 columns or more, the crest stands left of the header. It is the Chrysaki mark as a regular flat-top hexagon of three faces, fitted to the cell shape. Diagonal wedge glyphs draw it over the header row and the row under it. That row carries the caption: the `caption` option in gem type, then the repository. The crest starts folded, as the hexagon glyph. Click the brand segment to open it, and press `e: ◂ fold` on the caption row to fold it again. Folded, the band gives the row back. The mod keeps the choice in its plugin store. Under 150 columns, and on the desktop, the header keeps the `⬢` glyph. The `emblem` option picks the mark's colours, or `none`. `tools/emblem.py` builds `hooks/emblem.ts` from the mark's geometry.
- The row under the header holds the account dropdown while it is open. The ledger under it sets every figure on a grid of three columns: usage, context and git. Usage and context take the width their figures need. Git takes the rest, with the commit age at the right edge. A `│` with two cells of padding on each side parts the columns. The dashed rule crosses each separator as `┼`, or ends under it as `┴`.
- The bars are 16 cells wide, or 12 when the band is tight. Git shares the two rows from 153 columns. Below that, git takes two rows of its own. Under 100 columns the band folds to one line.
- Each ledger row opens with a hexagon gem badge. The badge ground runs across a facet, from a dim edge to a light catch. The badges are `5h` in Emerald, `7d` in Teal, `ctx` in Royal Blue, `cache` in Amethyst, and `git` and `diff` in Rhodolite. The badges and the bar tracks are the only fills. A dashed rule parts each ledger row from the next. A gradient of Emerald Lt, Teal Lt and Cerulean runs along it. One cycle takes 6 seconds: 40 steps of 150 ms. The `ruleAnimation` option turns the motion off. Inside the cache warning lead the rule turns Blonde.
- The context colour goes by tokens, not by percent: Teal under 250k, Blonde from 250k, Error from 500k. A 1M window and a 200k window warn at the same size.
- Bars default to the thin `line` style. The `smooth` style is an option. Each smooth cell fills in eighths (`▏▎▍▌▋▊▉█`), so a 16-cell bar shows 128 steps. The bar sits on a track in the Border colour, and the empty part of a partial cell shows as track. The context zones sit at 250k and 500k tokens. Across one and a half cells at each zone boundary, the colour mixes in OKLab into the next zone.
- The `line` bar fills in half cells: a full rule `━`, then a half cap `╸` when the percent ends inside a cell. The other bar styles draw one glyph a cell. Empty cells are dim sockets in the Border colour.
- A braille spark of 8 cells follows each usage bar. It splits the current window into 8 buckets, and each bucket shows the highest percent read in it. Dim dots mark the part of the window still ahead. Each saved rate-limit reading adds a sample to the plugin store under `history:<account email>`, so the spark holds readings from every session. The context spark shows the token count of the last 8 measures, at full height on the 250k amber line. The plan drops the sparks before it shortens the bars.
- The 5h and 7d bars follow one colour ramp. They stay Emerald Lt up to 50%. From 50% the colour mixes toward Peridot, a green-yellow, then reaches amber at 75% and Error Lt at 90%. Each filled cell takes the colour of its own place, so a bar past 50% shows the ramp along its length. Each percent takes the colour it reached.
- Each segment shows a card with details on hover. The `ctx` control opens the context tab of `/insight` when Claude Code loads the `chrysaki-insight` mod. Without it, the control shows the context breakdown as a toast.
- The band yields to surveys and stacks with the band of any other mod.

The engine sends rate limits, context and cost to the mod, and the mod reads live usage itself. Git, GitHub and vault data come from `git`, `gh` and the file system. The mod caches GitHub data for 5 minutes.

## Terminal rasters

On the terminal, the band draws each smooth bar and each animated rule as a `Raster`. A Raster is a fixed grid of cells, and each cell has its own glyph, foreground and background. The sweep clock repaints the rule cells with `$.ui.blit` every 150 ms. The band does not draw again for a sweep step. A step costs no state reads and no tree build.

Other surfaces draw the same cells as runs of `Text`. There the rule keeps the frame of its last draw, and moves only when the band draws again.

## Rate limits

The engine pushes rate limits from API response headers after each turn. The mod also reads `GET https://api.anthropic.com/api/oauth/usage` at startup and every 5 minutes, so the band shows usage from other sessions without a request. The mod signs the read through `$.session.authorize()` and never sees the token.

- Press the reset time of either window to read usage now. The arrow turns to `◐` while the read runs. Each press reads again, unless a read is already running.
- The 7d hover card lists the model-scoped weekly limits from the same response.
- A window past its reset time shows as 0% within 60 seconds, with no request.
- The mod saves each new reading in its plugin store under `limits:<account email>`. A fresh session draws that reading, rolled over to the current time, until its first read returns.

## Outage badge

Every 5 minutes the mod reads `status.claude.com/api/v2/incidents/unresolved.json`. While an incident is open, the header shows `o: ⚠ <impact>`. The badge is Blonde for a minor incident and Error for a major one. `+N` counts the other open incidents. Press `ctrl+x tab`, then `o`, or click the badge to open the status page.

## Band protocol

Other mods and processes add segments to the band through the band protocol. A contributor writes `$XDG_RUNTIME_DIR/chrysaki-band/<source>.json`, and the mod lists that folder every 3 seconds. Each fresh item draws as a segment in the tone it asks for, in the mod row under the header. One empty row follows, before the ledger. A press runs the item's slash command. The spec, the types and a client for mods are in [`protocol/chrysaki-band/`](../../protocol/chrysaki-band/).

## clodeKs

clodeKs connects Claude Code and the Codex CLI. It publishes its status through the band protocol, as the `clodeks` and `clodeks-off` sources, so this mod has no code of its own for it. The segment shows the live Codex threads, and press `c` to open the clodeKs panel.

## Share key

The two work accounts, jlim@aurrigo.com and limj@aurrigo.com, share each new artifact with each other. Neither the Artifact tool nor the plugin API can share an artifact, so the mod opens the page and the person shares it.

- After an Artifact publish that makes a new artifact, the header shows `p: ↗ share` on Teal. A desktop notice with an `Open to share` button appears too.
- Press `ctrl+x tab`, then `p`, click the key, or click the notice. The artifact opens in the Firefox profile of the account that published it. Add the other account from the Share menu there.
- The mod offers each artifact once. A republish or an update gives no new offer. The mod keeps the offered links in its plugin store under `shareOffered`.
- The key and the notice leave after 30 minutes. The key also leaves after a press.
- The account list of the account switcher names each profile. The pairs live in `SHARE_PARTNERS` in `hooks/share.ts`.

## /clear

A `/clear` keeps the process, starts a new session id and fires no `session.start`. The mod reseeds its state on the next draw after a `/clear` or a resume, so the band draws in full at once.

## Prompt cache warning

Claude Code caches the conversation prefix. On a subscription within plan usage, the cache lives for 1 hour. On an API key, a cloud provider, or in overage, it lives for 5 minutes. Each request resets the timer. When the cache expires, the next turn writes the whole prefix again at 1.25x (5m) or 2x (1h) the input price.

The segment on the ctx line shows the time left. It is Emerald Lt while warm, Blonde inside the warning lead, and Error Lt when cold. The hover card shows the TTL, the expiry time, the tokens a cold turn writes, the hit ratio and the last miss cause.

`statusline-command.sh` writes its stdin JSON to `${XDG_RUNTIME_DIR:-/tmp}/chrysaki-statusline/<session id>.json`. The mod reads `prompt_cache` from that file. Without the file, the mod times its own requests and infers the TTL from the environment and the rate limits.

Once per warm period, inside the warning lead, the mod shows a toast and a desktop notification through `notify-send`. It warns only while no turn runs and only when a cold turn writes at least `cacheMinTokens` tokens. It sends one more notice when the cache goes cold.

## Resume key

A session with no context yet reads the clipboard with `wl-paste` every 15 seconds. When the clipboard holds a handoff path, the empty ctx cell shows `r: resume` and the file name. The handoff key copies that path. The resume key accepts a bare path, a quoted path, a `~/` path or a whole `/context-resume` line.

Press `ctrl+x tab`, then `r`, or click the key. The mod puts `/context-resume <path>` in the prompt box. It never writes over a draft. With a draft in the box, it shows a toast.

## Account switcher

Click the account in the header, or press `ctrl+x tab`, then `a`. A panel under the header lists each Claude account on its own row. Each row has a number key, the Firefox profile and a work or personal chip. A gradient bar runs down the panel's left edge, and a tab names it. The account in use sits on a raised row with a gradient email.

Press an account's number, or click its row, to sign in to it. The mod sets `BROWSER` to `bin/open-in-profile` and `CHRYSAKI_LOGIN_PROFILE` to the account's profile folder, then runs `/login`. The login page opens in that Firefox profile, which holds the account's claude.ai session. The mod puts `BROWSER` back when the email in `.claude.json` changes, or after 10 minutes.

`n: new account` takes an email, then shows the Firefox profiles as chips. The chosen chip turns Emerald. `bin/firefox-profiles` lists the profiles from the Firefox profile group database. Firefox has no command-line flag that makes a profile, so the last option opens Firefox, where the profile menu makes one. The mod keeps the list in its plugin store under `accounts`.

Limits:

- `/login` takes no arguments, so the mod cannot pass the email to it.
- A running session keeps its `CLAUDE_CONFIG_DIR`. An account in another config folder needs a new session.
- Issue anthropics/claude-code#23906 reports that `/login` can keep the old account. Check `/status` after a switch.

## Theme

The mod ships `themes/chrysaki.json`. Pick it with `/theme`. It draws the prompt rules in Emerald Lt with a Teal Lt shimmer. The bash border and the Claude accent take Blonde, and text and surfaces take the Chrysaki colours. The band rules take the same `promptBorder` colour.

Claude Code draws 256 colours inside tmux unless `CLAUDE_CODE_TMUX_TRUECOLOR=1` is set.

## Hint drawer

The engine draws the permission mode under the prompt. The hint text after it, such as `(shift+tab to cycle)`, is a drawer. The chevron left of the model badge opens and closes it. Closed, the hint draws nothing. The mode label and the `·` after it stay, because the engine draws them outside any mod hook. The mod keeps the choice in its plugin store.

## Git key

The git line carries a `g` key when Claude Code loads the `git-pane` mod. Press `ctrl+x tab`, then `g`, to open the git pane.

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
| `emblem` | `hex-emerald` | The crest mark: `hex-emerald`, `hex-tri`, `hex-mono` or `none` |
| `caption` | empty | The name beside the crest, before the repository |
| `barStyle` | `line` | Bar glyphs: `line`, `smooth`, `wave`, `hex`, `diamond`, `circle` or `block` |
| `animate` | `off` | Scroll the wave bars and pulse the badge every 2 seconds |
| `usdToSgd` | `1.35` | Multiplier for the cost segment |
| `cacheWarnLead` | `auto` | Seconds before expiry to warn: `auto` (60 for 5m, 300 for 1h), `60`, `120`, `300` or `600` |
| `cacheMinTokens` | `20000` | Warn only when a cold turn writes at least this many tokens |
| `desktopNotify` | `on` | Send the warning to the desktop through `notify-send` |
