# chrysaki-lag

This mod says why the machine lags and stops a cause on request. It reads Linux pressure stall information (PSI): the share of time some task waited on the disk, on memory or on the CPU. That share is the lag a person feels. A CPU percentage misses lag from the disk and from memory.

## What it shows

- **Header badge.** While the machine is busy or laggy, the statusline header shows `l: ▲ io 41%`: the bound resource and its 10-second share. The badge is Blonde for busy and Error for laggy. Press it, or `ctrl+x tab` then `l`, to open `/lag`. The badge needs `chrysaki-statusline`.
- **`/lag` pane.** The verdict, a bar for each resource, the swap use, and the top 8 causes for the bound resource. The pane samples every 3 seconds while it is open.
- **Desktop notice.** When the machine stays laggy over a minute, one notice names the top two causes. A click opens `/lag` in the session that sent it. The notice waits 15 minutes before the next one, across every session on the machine.

## How it ranks the causes

| Bound | Rank by |
|:---|:---|
| io | disk MB/s, a wait on the disk (D state), swapped memory |
| memory | resident plus swapped memory |
| cpu | CPU share over the last interval |

Helper processes take the name of the app above them, such as `zapzap (web)` or `firefox (tab)`. Docker containers rank by their block IO rate and CPU share.

`/proc/<pid>/io` is readable only for your own processes. A root process or a container shows its disk rate only through `docker stats`.

## Stop keys

Each cause has a stop key, `1` to `8`. The first press arms it and shows `confirm stop`. A second press within 5 seconds stops the cause.

- A process of yours gets SIGTERM. If it still runs after 5 seconds, it gets SIGKILL.
- A Docker container gets `docker stop -t 10`.
- Before each signal, the mod reads the pid again. If the pid now names another process, the mod leaves it alone.
- Some causes show as `system`, with no key: root processes, other users' processes and kernel threads. The desktop (Hyprland, Xwayland, the terminal, PipeWire and similar) and this session's own process tree show the same way.

## Shared state

One session at a time samples. Each session looks at `$XDG_RUNTIME_DIR/chrysaki-lag/state.json` every 10 seconds, and samples only when the file is over 8 seconds old. The statusline reads the same file for the badge. A file over 60 seconds old draws no badge.

`bin/lag-snapshot` reads every process in one run, because the plugin API reads one file per call. It needs `python3`.

## Options

| Option | Default | Meaning |
|:---|:---|:---|
| `busyAt` | `10` | The 10-second share, in percent, at which any resource makes the machine busy |
| `ioLaggyAt` | `25` | The IO share at which the machine is laggy |
| `memoryLaggyAt` | `15` | The memory share at which the machine is laggy |
| `cpuLaggyAt` | `40` | The CPU share at which the machine is laggy |
| `desktopNotify` | `on` | Send the notice through `notify-send` |
