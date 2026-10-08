# chrysaki-lag

This mod says why the machine lags, stops a cause on request, and warns about faults that build up slowly. It reads Linux pressure stall information (PSI): the share of time some task waited on the disk, on memory or on the CPU. That share is the lag a person feels. A CPU percentage misses lag from the disk and from memory.

## What it shows

- **Header badge.** While the machine is busy or laggy, the statusline header shows `l: ▲ io 41%`: the bound resource and its 10-second share. The badge is Blonde for busy and Error for laggy. Press it, or `ctrl+x tab` then `l`, to open `/lag`. The badge needs `chrysaki-statusline`.
- **`/lag` pane.** The verdict, a bar for each resource, the swap use, and the top 8 causes for the bound resource. The pane samples every 3 seconds while it is open.
- **Desktop notice.** When the machine stays laggy over a minute, one notice names the top two causes. A click opens `/lag` in the session that sent it. The notice waits 15 minutes before the next one, across every session on the machine.

## Health warnings

The sampler also runs a health check every 30 seconds. `bin/health-snapshot` reads the raw values, and the mod turns them into warnings. Each warning is `warn` (Blonde) or critical (Error).

| Group | Warn | Critical |
|:---|:---|:---|
| Disk | a disk 90% full, or a disk of 8 GB or more with under 5 GB free | 97% full, or under 2 GB free |
| Disk | `/tmp`, `/dev/shm` or `/run/user` 75% full (a tmpfs holds RAM) | 90% full |
| Disk | 90% of the inodes in use | 97% |
| Memory | 10% of memory available | 5% |
| Memory | swap 80% full | 95% |
| Memory | | a new OOM kill, for 10 minutes |
| Heat | CPU at 95 °C, two readings in a row | 99 °C |
| Heat | a drive at its own warn limit, two readings in a row | its critical limit |
| Power | battery at 20% while it discharges | 10% |
| System | failed system or user units, a kernel update that needs a reboot, 20 zombie processes, or a clock without NTP sync | |

- **Header badge.** The statusline shows `w: ⚠ /home 91% +1`: the worst warning and a count of the rest. Press it, or `w`, to open `/lag`.
- **`/lag` pane.** The warnings sit above the causes. Each row has a hide key, `a` to `f`. A hidden warning drops from the badge and shows again when its level changes. For failed units, it also shows again when the list of units changes.
- **Desktop notice.** A critical warning sends one notice, at most once per warning per hour, across every session.
- **Docker space.** A disk warning on the mount that holds the Docker root names the space `docker system df` can give back. That scan takes up to 30 seconds, so it runs at most every 30 minutes and never on a disk-bound machine.

The check reads local file systems only. A `statvfs` call on a network mount can hang when the server is gone.

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

`bin/lag-snapshot` reads every process in one run, because the plugin API reads one file per call. `bin/health-snapshot` does the same for the health check. Both need `python3`.

A hide writes `$XDG_RUNTIME_DIR/chrysaki-lag/hidden.json`. Only a press writes that file, so a sampler never overwrites a hide.

## Options

| Option | Default | Meaning |
|:---|:---|:---|
| `busyAt` | `10` | The 10-second share, in percent, at which any resource makes the machine busy |
| `ioLaggyAt` | `25` | The IO share at which the machine is laggy |
| `memoryLaggyAt` | `15` | The memory share at which the machine is laggy |
| `cpuLaggyAt` | `40` | The CPU share at which the machine is laggy |
| `desktopNotify` | `on` | Send the lag notice through `notify-send` |
| `diskWarnAt` | `90` | The share of a disk in use, in percent, at which a warning shows |
| `diskCritAt` | `97` | The share of a disk in use at which the warning turns critical |
| `cpuTempWarnAt` | `95` | The CPU temperature, in °C, at which a warning shows |
| `cpuTempCritAt` | `99` | The CPU temperature at which the warning turns critical |
| `warnNotify` | `on` | Send a notice for a critical warning |
