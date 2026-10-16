# chrysaki-comms

A pane with the full log of messages between this session and other Claude sessions, in the Chrysaki look.

The transcript shows a message from another session as a one-line preview. This pane shows the whole exchange in two views. The compact view gives one line for each message, with a Haiku summary of each long one. The verbose view gives the exact words.

## Use

| Command | What it does |
|:---|:---|
| `/comms` | Open the pane with every peer |
| `/comms <peer>` | Open the pane with one peer, for example `/comms orchestrator` |

| Key | What it does |
|:---|:---|
| `0` | Show every peer |
| `1` to `9` | Show one peer each, the latest exchange first |
| `v` | Switch between the compact view and the verbose view |
| `f` | Pause the pane at its place, or follow the newest message again |
| `r` | Read the transcript again. Try each failed summary again |
| `q` | Close the pane |

## Views

| View | What each message shows |
|:---|:---|
| `compact` | One line: the time, the direction, the peer and the text. A message over 100 characters, or one with a line break, shows a summary marked `✦`. Until the summary arrives, it shows its first line |
| `verbose` | The exact words, with a coloured rule: blonde for a received message, teal for a sent one. A sent message is set in by four columns |

Both views put a line before each new day. A run of messages from one peer, each within 5 minutes of the one before, has one header.

The pane follows the newest message. It scrolls to the end when it opens and when a message arrives. When you scroll up yourself, the pane stays there until the next message arrives. `f` pauses it, so that a new message does not move it.

## How it works

1. A `session.send` hook logs each message that this session sends, with its time. A send that fails shows why.
2. A `session.receive` hook logs each message from another session or agent, with its time. A relay event, a trigger or a Remote Control prompt is not logged.
3. When the pane opens, and at the end of each turn while it shows, `hooks/transcript.py` reads the session's transcript file. The file keeps a time on each message and the messages from before a compaction. It also keeps each message delivered in the middle of a turn, and each message that you approved after a hold. The script reads a 78 MB transcript in about a quarter of a second.
4. Without `python3` or the transcript file, the mod reads the conversation in Messages API form instead, and the pane says so. That form starts at the last compaction summary and keeps no time on a message.
5. Each sender address takes the `from-name` of its envelope, so a reply sent to an address joins the thread of that name.
6. In the compact view, the mod sends each long message that the pane shows to the summary model through `$.model.complete`. That call uses the session's own client and credentials. It sends no tools and no conversation history. Its system prompt is the CLI's identity block and the mod's own instruction. One call takes up to 10 messages, the newest first. The mod keeps each summary for the rest of the session, so a message gets one call only.

## Limits

- The log covers the main conversation. A subagent's messages are not logged.
- The transcript script prints the last 2000 messages, to stay under the 4 MiB that a mod reads from a process.
- The mod finds the transcript under `CLAUDE_CONFIG_DIR`, or under `~/.claude` when that is unset.
- The header and the peer strip scroll with the log. A pane scrolls its whole tree.
- A summary call costs tokens on your account. Set `summaryModel` to `off` to send no message to a model.
- When a summary call fails, the pane says why and shows the first line of each message. `r` tries again.

## Options

| Option | Default | What it does |
|:---|:---|:---|
| `maxMessages` | `200` | How many of the latest messages the pane draws. The pane says how many earlier messages it leaves out |
| `view` | `compact` | The view that the pane opens in: `compact` or `verbose` |
| `summaryModel` | `claude-haiku-5-5` | The model that writes the compact summaries, as an alias or a full id. `off` sends no message to a model |

## Develop

```bash
claude plugin validate mods/chrysaki-comms
claude plugin test mods/chrysaki-comms
npx -p typescript tsc --noEmit -p mods/chrysaki-comms
```
