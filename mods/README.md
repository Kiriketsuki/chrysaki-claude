# Chrysaki mods for Claude Code

Mods are Claude Code plugins made of function hooks. They run inside the session and draw panes, bands, toasts and status text, or block and rewrite tool calls. The API is early access in Claude Code 2.1.288 and can change between releases.

| Mod | What it does |
|:---|:---|
| [`chrysaki-statusline`](chrysaki-statusline/) | Draws the Chrysaki statusline as a band above the prompt, with a prompt cache warning, handoff and resume keys, and rate limits that hold between sessions |
| [`chrysaki-insight`](chrysaki-insight/) | Opens `/insight`, a pane with tabs for the context breakdown, the cost of each request, and running tools and subagents |
| [`chrysaki-lag`](chrysaki-lag/) | Shows why the machine lags, from pressure stall data, and warns about disk, memory, heat and system faults, with header badges, a `/lag` pane of warnings, causes and stop keys, and desktop notices |
| [`git-pane`](git-pane/) | Opens a lazygit style git pane with `/git` |
| [`kilint-gate`](kilint-gate/) | Denies a `git commit` when kilint finds an STE error in the message |

## Install

Load one mod for one session:

```bash
claude --plugin-dir ~/dev/Personal/chrysaki-claude/mods/kilint-gate
```

Load mods in every session, the desktop app included, with `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Separate several folders with `:`. Point it at a copy of the mods, not at this checkout. A branch switch in the checkout changes what every session loads.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/dev/Personal/chrysaki-claude/mods/kilint-gate"
  }
}
```

## Develop

Each mod folder holds `.claude-plugin/plugin.json`, `hooks/hooks.json`, the hooks module and its tests. Claude Code writes the API types into `.claude-plugin/types/` when it loads the mod. That folder is not committed.

```bash
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
npx -p typescript tsc -p mods/<mod>
```
