# kilint-gate

This mod checks each commit message that Claude writes against the STE house style before git runs.

## Behaviour

1. The mod hooks every Bash tool call.
2. When the command runs `git commit`, the mod extracts the message. It reads `-m`, `--message`, combined flags such as `-am`, and the `$(cat <<'EOF' ... EOF)` heredoc form. It drops git trailers such as `Co-Authored-By`.
3. The mod runs kilint on the message with the JSON format and reads the violations.
4. When a violation reaches the blocking severity, the mod denies the call. The model receives each rule id, position and fix, and it rewrites the message.

The mod skips a commit it cannot read: `-F`, `--no-edit`, an editor commit, or a message built by a command substitution other than a heredoc.

kilint reports no score for text under 40 words, and it exits 0. The mod therefore reads the violation list, not the exit code.

When kilint does not run, the mod lets the commit through and shows a toast that names the reason.

## Options

Change these in the `/config` menu or under `pluginConfigs.kilint-gate.options` in settings.

| Option | Default | Meaning |
|:---|:---|:---|
| `kilintPath` | the obKidian kilint script | Path to the kilint entry script |
| `python` | `python3` | The interpreter that runs kilint |
| `profile` | `flavored` | The kilint profile: `flavored`, `strict` or `prose` |
| `failOn` | `error` | The lowest severity that blocks: `error`, `warn` or `info` |
