# Chrysaki band protocol

The chrysaki-statusline mod draws a band above the Claude Code prompt. Other mods and processes add segments to its header through this protocol. A contributor needs no dependency on chrysaki-statusline. Without that mod, nothing reads the file.

Version 1 carries header segments. The types are in [`band.d.ts`](band.d.ts).

## Write a file

Write one JSON file per source:

```
$XDG_RUNTIME_DIR/chrysaki-band/<source>.json
```

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

Copy [`client.ts`](client.ts) and [`band.d.ts`](band.d.ts) into the mod. The validator follows `$` only in the module that registers the hooks, so `client.ts` never touches `$`. Build a `BandHost` from `$` in the register module and pass it in:

```ts
import { publishBand } from './chrysaki-band/client'
import type { BandHost } from './chrysaki-band/client'

const bandHost = ($: EngineInterface): BandHost => ({
  runtimeDir: async () => (await $.env.get('XDG_RUNTIME_DIR')) ?? '/tmp',
  now: async () => $.clock.now(),
  write: async (path, text) => $.fs.write(path, text),
  run: async argv => { await $.process.run(argv, { timeoutMs: 5000 }) },
})

$.clock.every(10000, () => {
  void publishBand(bandHost($), 'tokin', [{ id: 'era', icon: '⚙', text: 'era 1 · 12k/s', tone: 'accent', command: 'tokin' }])
})
```

`publishBand` writes a temporary file, then renames it, so the statusline never reads half a file. `bandText` gives the file's text alone, for a test.

## From any process

Any process on the same machine can write the file, for example a daemon or a shell script:

```bash
dir="${XDG_RUNTIME_DIR:-/tmp}/chrysaki-band"
mkdir -p "$dir"
printf '{"v":1,"source":"backup","updatedAt":%s,"items":[{"id":"run","icon":"⟳","text":"backup 42%%","tone":"info"}]}' \
  "$(date +%s%3N)" > "$dir/backup.json.tmp" && mv "$dir/backup.json.tmp" "$dir/backup.json"
```

Write to a temporary file and rename it, so the statusline never reads half a file. A file that does not parse draws nothing until the next listing.
