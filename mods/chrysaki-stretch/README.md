# chrysaki-stretch

Stretchtext replies for Claude Code, in the Chrysaki look. A reply arrives short. A click on a linked phrase grows it in place, and a click on `«` shrinks it back. Claude learns which parts you opened, so it does not assume that you read the rest.

This mod is my own version of [pro-vi/cc-stretch](https://github.com/pro-vi/cc-stretch), under the MIT license. `LICENSE` keeps the upstream notice.

## What changed from upstream

| Area | Upstream | chrysaki-stretch |
|:---|:---|:---|
| Link colour | Theme `suggestion` | Teal Lt, underlined |
| Code colour | Theme `permission` | Blonde Lt |
| Dim text | `dimColor` | Muted |
| Guide in the system prompt | Upstream prose | The same rules in STE |
| Tool call folding | Always on | The `foldTools` option, on by default |
| Bench and film | Included | Left out |

## How it works

1. A `prompt.compose` hook adds a guide to the system prompt. The guide tells Claude to write `{{short|long}}` stretches.
2. An `AssistantMessage` render hook draws each paragraph with a stretch through a client module, `hooks/reply.tsx`. The client takes the press and grows the long form around the short form, frame by frame.
3. A `prompt.submit` hook adds a note to your next prompt. The note names the stretches you opened and the stretches you did not open.
4. A `ToolGroup` render hook folds a finished group of tool calls to one line. A running group, or a group with an error, stays open.

## Limits

- Clicks need the fullscreen renderer. Run `/tui fullscreen`. On the classic renderer and in the desktop app, every stretch shows open.
- Claude writes every level up front. A reply costs about as many tokens as before.
- The `{{short|long}}` markup shows as raw text where the mod is not loaded.
- Where an organization manages Claude Code, the `prompt.compose` and `classic.MessageDisplay` hooks run only for a plugin that the managed settings list. Without the guide, Claude writes no stretches.

## Options

| Option | Default | What it does |
|:---|:---|:---|
| `foldTools` | `on` | Fold a finished group of tool calls to its one-line summary |

## Develop

```bash
claude plugin validate mods/chrysaki-stretch
claude plugin test mods/chrysaki-stretch
npx -p typescript tsc -p mods/chrysaki-stretch
```
