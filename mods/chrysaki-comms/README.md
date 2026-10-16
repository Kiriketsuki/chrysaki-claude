# chrysaki-comms

A pane with the full log of messages between this session and other Claude sessions, in the Chrysaki look.

The transcript shows a message from another session as a one-line preview. This pane shows each message in full, with its direction, its peer and its time.

## Use

| Command | What it does |
|:---|:---|
| `/comms` | Open the pane with every peer |
| `/comms <peer>` | Open the pane with one peer, for example `/comms orchestrator` |

In the pane, `0` shows every peer, and `1` to `9` show one peer each, the latest exchange first. `r` reads the transcript again, and `q` closes the pane.

## How it works

1. A `session.send` hook logs each message that this session sends, with its time. A send that fails shows why.
2. A `session.receive` hook logs each message from another session or agent, with its time. A relay event, a trigger or a Remote Control prompt is not logged.
3. When the pane opens, and at the end of each turn while it shows, `hooks/transcript.py` reads the session's transcript file. The file keeps a time on each message, the messages from before a compaction, each message delivered in the middle of a turn, and each message that you approved after a hold. The script reads a 78 MB transcript in about a quarter of a second.
4. Without `python3` or the transcript file, the mod reads the conversation in Messages API form instead, and the pane says so. That form starts at the last compaction summary and keeps no time on a message.
5. Each sender address takes the `from-name` of its envelope, so a reply sent to an address joins the thread of that name.

## Limits

- The log covers the main conversation. A subagent's messages are not logged.
- The transcript script prints the last 2000 messages, to stay under the 4 MiB that a mod reads from a process.
- The mod finds the transcript under `CLAUDE_CONFIG_DIR`, or under `~/.claude` when that is unset.

## Options

| Option | Default | What it does |
|:---|:---|:---|
| `maxMessages` | `200` | How many of the latest messages the pane draws. The pane says how many earlier messages it leaves out |

## Develop

```bash
claude plugin validate mods/chrysaki-comms
claude plugin test mods/chrysaki-comms
npx -p typescript tsc --noEmit -p mods/chrysaki-comms
```
