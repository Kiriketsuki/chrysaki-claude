// Chrysaki band protocol, version 1: the file a contributor writes.
//
// A contributor writes one JSON file, `$XDG_RUNTIME_DIR/chrysaki-band/<source>.json`.
// The chrysaki-statusline mod lists that folder every few seconds and draws
// the items as segments of the band header. See README.md beside this file.

// How an item reads. The statusline picks the ground and the lettering.
// It holds the pair to a contrast of at least 4.5 to 1.
//
//   calm    Quiet status, on Raised.
//   info    Worth a look, Teal lettering on Raised.
//   accent  The source's own voice, a brand gradient on the Abyss.
//   warn    Needs attention soon. Blonde on a dark amber ground. Never drops.
//   alert   Needs attention now. On the Error fill. Never drops.
export type BandTone = 'calm' | 'info' | 'accent' | 'warn' | 'alert'

export type BandItem = {
  // Unique within the source: 1 to 32 of a-z 0-9 and -.
  id: string
  // One glyph before the text, at most 2 code points. On surfaces without a
  // Nerd Font the statusline draws a Private Use Area glyph as a diamond.
  icon?: string
  // The segment's words: 1 to 32 characters on one line.
  text: string
  // Default calm.
  tone?: BandTone
  // The hover card, up to 200 characters.
  hint?: string
  // A slash command, without the slash, that a press on the segment runs:
  // 1 to 64 of a-z 0-9 : _ and -. Absent, the segment does not press.
  command?: string
  // Arguments for that command, up to 200 characters.
  args?: string
  // One lowercase letter that presses the segment while the band holds the
  // focus. The statusline drops a letter that it or an earlier source already
  // uses. The segment still presses by click.
  hotkey?: string
  // Order among this source's items, lowest first. Default 0.
  rank?: number
}

export type BandFile = {
  // The protocol version. The statusline ignores files with any other value.
  v: 1
  // The source's name, equal to the file name without `.json`: 1 to 32 of
  // a-z 0-9 and -, starting with a letter or a digit.
  source: string
  // When the contributor wrote the file, in epoch milliseconds.
  updatedAt: number
  // How long the file stays fresh after updatedAt, in milliseconds. Default
  // 30000, at most 600000. A stale file draws nothing, so a crashed
  // contributor leaves the band on its own.
  ttlMs?: number
  // At most 4 items. An empty list clears the source.
  items: BandItem[]
}
