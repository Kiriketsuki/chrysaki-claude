# Hub files

A hub session runs Claude Code through a CLIProxyAPI hub. The shell script `hub-status.sh` and the mod keep files in `${CLIPROXY_CACHE_DIR:-${XDG_CACHE_HOME:-~/.cache}/cliproxy}`.

| File | Content |
|:---|:---|
| `<pool>.status.json` | Cache of the last good hub status |
| `<pool>.live/<session id>.json` | One live session: `{"seat":"seat-a","written_at":<epoch s>}` |

usaKi reads the `<pool>.live/` folder to show the live sessions of each seat. It counts a file when `now - written_at` is 600 s or less.

## Live session file rules

- The shell script and the mod each write the file when they know the seat of the session. A session outside the hub writes nothing.
- A write goes to a temporary file, then `mv -f`. The folder has mode 700.
- A file with the same seat that is younger than 60 s stays as it is. A write each 60 s keeps the file inside the 600 s window.
- If the seat is unknown, the writer writes nothing and keeps the old file. The file ages out through `written_at`. This keeps one writer from removing a file that the other writer just wrote.
- A write also deletes `*.json` files in the folder that are older than one day. A stamp file `.prune.stamp` limits this to one run each 10 minutes.
- The session id, the pool name and the seat may hold only `A-Za-z0-9_-`. Any other value writes nothing.

## Tests

- `bash tests/hub-live.test.sh` tests the shell writer.
- `claude plugin test mods/chrysaki-statusline` tests the mod writer.
