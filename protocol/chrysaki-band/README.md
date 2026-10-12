# Chrysaki band protocol

The chrysaki-statusline mod draws a band above the Claude Code prompt. Other mods and processes add segments to its header through this protocol. A contributor needs no dependency on chrysaki-statusline. Without that mod, nothing reads the file.

Version 1 carries header segments. The types are in [`band.d.ts`](band.d.ts).

## Write a file

Write one JSON file per source:

```
<band folder>/<source>.json
```

## The band folder

The rule is the same on every platform. The first variable that is set and not empty wins:

| Order | Variable | Band folder | Usual platform |
|:---|:---|:---|:---|
| 1 | `CHRYSAKI_BAND_DIR` | The value itself | Any, as an override |
| 2 | `XDG_RUNTIME_DIR` | `$XDG_RUNTIME_DIR/chrysaki-band` | Linux |
| 3 | `TMPDIR` | `$TMPDIR/chrysaki-band` | macOS |
| 4 | `TEMP` | `%TEMP%\chrysaki-band` | Windows |
| 5 | `TMP` | `%TMP%\chrysaki-band` | Windows |
| 6 | None | `/tmp/chrysaki-band` | A fallback |

A writer and the statusline must see the same variables. A process that starts outside the desktop session, such as a cron job or a service, can lack `XDG_RUNTIME_DIR`. Set `CHRYSAKI_BAND_DIR` for both sides in that case.

Do not use Node's `os.tmpdir()` alone. It skips `XDG_RUNTIME_DIR`, and on Windows it can fall back to a folder outside this rule.

```json
{
  "v": 1,
  "source": "tokin",
  "updatedAt": 4070966100000,
  "ttlMs": 30000,
  "items": [
    { "id": "era", "icon": "⚙", "text": "era 1 · 12k/s", "tone": "accent", "command": "tokin", "hotkey": "t" }
  ]
}
```

- `source` equals the file name without `.json`.
- Write the file again before `ttlMs` runs out, or its items leave the band. A crashed contributor leaves on its own this way.
- Write an empty `items` list to clear the source at once.
- The statusline lists the folder every 3 seconds.

## Rules

| Field | Rule |
|:---|:---|
| `source` | 1 to 32 of `a-z 0-9 -`, starting with a letter or a digit |
| `items` | At most 4 |
| `id` | 1 to 32 of `a-z 0-9 -`, unique in the file |
| `text` | 1 to 32 characters on one line |
| `icon` | At most 2 code points. On the desktop a Nerd Font glyph draws as `◆` |
| `tone` | `calm`, `info`, `accent`, `warn` or `alert`. Default `calm` |
| `command` | A slash command without the slash. A press on the segment runs it |
| `args` | Arguments for the command, up to 200 characters |
| `hotkey` | One lowercase letter. The statusline keeps `a e g h l n o p r s w x`. The first source by name wins a letter |
| `rank` | Order within the source, lowest first |
| `hint` | Up to 200 characters. Version 1 of the statusline stores it and draws no card yet |

A file that breaks a rule draws nothing at all. An unknown tone reads as `calm`, and a malformed command leaves the segment without a press.

## Tones

| Tone | Ground and lettering | Drops when the header is tight |
|:---|:---|:---|
| `calm` | Secondary on Raised | Yes, with the session clock |
| `info` | Teal on Raised | Yes |
| `accent` | A brand gradient on the Abyss | Yes |
| `warn` | Blonde on a dark amber ground | Never |
| `alert` | Primary text on the Error fill | Never |

The statusline guards every ground and lettering pair to a contrast of 4.5:1.

## From a Claude Code mod

Copy [`client.ts`](client.ts) and [`band.d.ts`](band.d.ts) into the mod. The validator follows `$` only in the module that registers the hooks. For that reason `client.ts` never touches `$`. The engine call `$.env.get` takes literal names only, so the register module reads the five variables itself. Build a `BandHost` from `$` there and pass it in:

```ts
import { publishBand } from './chrysaki-band/client'
import type { BandHost } from './chrysaki-band/client'

const bandHost = ($: EngineInterface): BandHost => ({
  env: async () => ({
    CHRYSAKI_BAND_DIR: await $.env.get('CHRYSAKI_BAND_DIR'),
    XDG_RUNTIME_DIR: await $.env.get('XDG_RUNTIME_DIR'),
    TMPDIR: await $.env.get('TMPDIR'),
    TEMP: await $.env.get('TEMP'),
    TMP: await $.env.get('TMP'),
  }),
  now: async () => $.clock.now(),
  write: async (path, text) => $.fs.write(path, text),
})

$.clock.every(10000, () => {
  void publishBand(bandHost($), 'tokin', [{ id: 'era', icon: '⚙', text: 'era 1 · 12k/s', tone: 'accent', command: 'tokin' }])
})
```

The client runs no shell command, so it works on Linux, macOS and Windows. The engine call `$.fs.write` makes the folder. The engine has no rename, so the client writes the file in place. The function `bandText` gives the file's text alone, for a test. Run the client's own tests with `node --test protocol/chrysaki-band/client.test.ts`.

## Half a file

A read can meet a file that a writer has not finished, or a file that Windows holds locked. The statusline then keeps the last good items of that source until their `ttlMs` runs out. The band does not flicker, and a file that stays broken still leaves on time. A file that parses but breaks a rule is different: it draws nothing at once.

A process that can rename should still write a temporary file and rename it over the target. The temporary name must not end in `.json`, because the statusline lists only `*.json`. On Windows a rename can fail while the statusline reads the target. Write again on the next tick.

## From any process

Any process on the same machine can write the file, for example a daemon or a shell script.

zsh or bash, on Linux or macOS:

```bash
base="${XDG_RUNTIME_DIR:-${TMPDIR:-${TEMP:-${TMP:-/tmp}}}}"
dir="${CHRYSAKI_BAND_DIR:-${base%/}/chrysaki-band}"
mkdir -p "$dir"
printf '{"v":1,"source":"backup","updatedAt":%s,"items":[{"id":"run","icon":"⟳","text":"backup 42%%","tone":"info"}]}' \
  "$(($(date +%s) * 1000))" > "$dir/backup.json.tmp" && mv -f "$dir/backup.json.tmp" "$dir/backup.json"
```

PowerShell, on Windows:

```powershell
$base = @($env:XDG_RUNTIME_DIR, $env:TMPDIR, $env:TEMP, $env:TMP, '/tmp') | Where-Object { $_ } | Select-Object -First 1
$dir = if ($env:CHRYSAKI_BAND_DIR) { $env:CHRYSAKI_BAND_DIR } else { Join-Path $base 'chrysaki-band' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = @{ v = 1; source = 'backup'; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  items = @(@{ id = 'run'; icon = '⟳'; text = 'backup 42%'; tone = 'info' }) }
$tmp = Join-Path $dir 'backup.json.tmp'
[IO.File]::WriteAllText($tmp, ($file | ConvertTo-Json -Depth 4 -Compress))
Move-Item -Force $tmp (Join-Path $dir 'backup.json')
```

`[IO.File]::WriteAllText` writes UTF-8 with no byte order mark. Windows PowerShell 5 `Set-Content` adds one, and the statusline then cannot parse the file.

Node:

```js
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env
const dir = env.CHRYSAKI_BAND_DIR || join(env.XDG_RUNTIME_DIR || env.TMPDIR || env.TEMP || env.TMP || '/tmp', 'chrysaki-band')
mkdirSync(dir, { recursive: true })
const target = join(dir, 'backup.json')
writeFileSync(`${target}.${process.pid}.tmp`, JSON.stringify({ v: 1, source: 'backup', updatedAt: Date.now(), items: [] }))
renameSync(`${target}.${process.pid}.tmp`, target)
```
