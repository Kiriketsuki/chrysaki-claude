# git-pane

A lazygit-style git pane for Claude Code, in the Chrysaki look. The header copies the tmux window list: a session badge, then zigzag-alt tab islands on the Abyss ground. Panels use lazygit's double border, Emerald Lt on the focused panel.

## Open it

| How | Keys |
|:---|:---|
| Slash command | `/git` (runs at once, also while a turn runs) |
| From the band | `ctrl+x tab`, then `g` |
| Your own chord | Bind `abovePrompt:focus` in `~/.claude/keybindings.json`, then press `g` |

The band above the prompt shows the branch, ahead and behind counts, and staged, unstaged and untracked counts. The badge turns Blonde while a git command runs, as the tmux badge does for the prefix.

## Keys in the pane

The pane takes the keyboard when it opens. Tab and the arrow keys move between rows. Enter acts on the row in focus. Esc closes the pane.

| Key | Tab | Action |
|:---|:---|:---|
| `1` to `5` | any | status, files, branches, log, stash |
| Enter | files | stage or unstage the file |
| Enter | branches | switch to the branch |
| Enter | log | copy the commit hash |
| Enter | stash | pop the entry |
| `a` | files | stage all, or unstage all when everything is staged |
| `c` | files, status, log | commit |
| `d` | files | discard the file in focus (press twice) |
| `s` | files, stash | stash all changes |
| `n` | branches | new branch |
| `p` / `l` / `f` | any | push, pull (fast-forward only), fetch |
| `r` | any | refresh |
| `q` | any | close |

Moving the focus onto a row shows its diff, commit, branch log or stash below the list.

## Commits and kilint-gate

The pane commits through the Bash tool, not through a direct git call. Tool hooks therefore see the commit. With `kilint-gate` loaded, a message that fails the STE check is refused, and the pane shows each rule id.

## Options

| Option | Default | Meaning |
|:---|:---|:---|
| `showBand` | `true` | Draw the git band above the prompt |
| `pollSeconds` | `15` | Seconds between status refreshes for the band. `0` turns polling off |

The band also refreshes after each turn and after each Bash call that runs git.
