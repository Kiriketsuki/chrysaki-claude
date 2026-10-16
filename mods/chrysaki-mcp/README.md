# chrysaki-mcp

An MCP panel in the Chrysaki look, with on-demand servers that start off in every session.

Each connected MCP server adds its tool schemas to the context. Claude Code has no setting that turns a server off for every project, and `/mcp disable` turns a server off for one project only. This mod keeps the servers that you name off by default and puts each one a key away.

## Use

| Command | What it does |
|:---|:---|
| `/mcp-panel` | Open the panel |

The panel shows one row per server: its state, its name, where it is configured, and its tools with their tokens. The header adds up the servers that are on.

| State | Meaning |
|:---|:---|
| `on` | The session has the server's tools |
| `off` | `/mcp disable` turned the server off for this project |
| `waiting` | The server is on but has no tools yet: it connects, it failed, or it waits for a sign-in |
| `pending` | The panel sent `/mcp enable` or `/mcp disable` and waits for it |

`1` to `9` turn the server on that row on or off. A click works on every row. `r` reads the servers again, and `q` closes the panel.

## How it works

1. At session start, the mod sends `/mcp disable` for each on-demand server that is not off for this project yet. It does this once in each session. A reload of the mod does not turn a server off again.
2. A key in the panel sends `/mcp enable` or `/mcp disable` for that server. The panel reads the servers again at once. It reads them again 5 seconds later, when a server has had time to connect.
3. The server list comes from `.claude.json`: its user servers and the project entry. It also takes `.mcp.json` at the project root and the tools that the session has now. The tool counts and tokens come from `$.session.usage()`.
4. The tool list names a server in a cleaned form, for example `claude_ai_Gmail`. The panel maps it back to the name that `/mcp` takes, `claude.ai Gmail`, from the config file, the claude.ai connectors and the enabled plugins.

## Limits

- `/mcp` saves the switch in the project entry of `.claude.json`. When a new session starts in a project, it turns the on-demand servers off for that project again. That also reaches each open session in that project that had one turned on.
- In a git worktree, Claude Code keys the project entry by the main checkout. A switch in a worktree reaches the main checkout too.
- An on-demand server stays connected for a moment at session start, until `/mcp disable` runs.
- The panel shows what `/mcp` printed when the command returns text. `/mcp enable` and `/mcp disable` print in the transcript, so the panel says that the command ran.
- The mod finds `.claude.json` in `CLAUDE_CONFIG_DIR`, or in your home folder when that is unset.

## Options

| Option | Default | What it does |
|:---|:---|:---|
| `onDemand` | `mcp-atlassian` | MCP server names, separated by commas. The mod turns each one off at the start of every session. Use the name that `/mcp` lists, for example `claude.ai Atlassian` |

## Develop

```bash
claude plugin validate mods/chrysaki-mcp
claude plugin test mods/chrysaki-mcp
npx -p typescript tsc --noEmit -p mods/chrysaki-mcp
```
