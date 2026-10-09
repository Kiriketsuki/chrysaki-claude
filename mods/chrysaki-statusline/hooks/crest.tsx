// The crest: the Chrysaki mark beside the header and the row under it, and
// the caption on that row. It draws on a wide terminal band alone. Elsewhere
// the header keeps the hexagon glyph. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { BandData } from './draw'
import { EMBLEMS } from './emblem'
import type { EmblemCell } from './emblem'
import { sampleRamp } from './gradient'
import { CORE, ROLE } from './palette'
import type { Table } from './prims'

// The crest needs the row under the header, which a band this wide keeps.
export const CREST_COLUMNS = 150
export const DEFAULT_EMBLEM = 'cube-emerald-plain'
const CAPTION_INK = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean] as const

// The mark's cells for this band, or null when the band draws no crest. The
// desktop and the editor have no Nerd Font, so the mark draws on the
// terminal alone.
function hasRoom(d: BandData): boolean {
  return d.surface === 'terminal' && d.columns >= CREST_COLUMNS && d.emblem !== 'none'
}

export function bandEmblem(d: BandData): readonly (readonly EmblemCell[])[] | null {
  if (!hasRoom(d) || !d.isCrestOpen) return null
  return EMBLEMS[d.emblem] ?? EMBLEMS[DEFAULT_EMBLEM] ?? null
}

// True when the band has room for the crest but the person folded it.
export function crestFolded(d: BandData): boolean {
  return hasRoom(d) && !d.isCrestOpen
}

// The cells the crest takes from the header: the mark and one space.
export function crestWidth(d: BandData): number {
  const e = bandEmblem(d)
  return e === null ? 0 : (e[0]?.length ?? 0) + 1
}

export function emblemColumn(T: Table, cells: readonly (readonly EmblemCell[])[]): RenderElement {
  const { Box, Text } = T
  const cell = ([g, fg, bg]: EmblemCell) => <Text {...(fg === null ? {} : { color: fg })} {...(bg === null ? {} : { backgroundColor: bg })}>{g}</Text>
  return (
    <Box key="emblem" flexDirection="column" flexShrink={0} width={(cells[0]?.length ?? 0) + 1}>
      {cells.map(row => <Text>{row.map(cell)}</Text>)}
    </Box>
  )
}

// The repository the session works in: the GitHub name when git knows it,
// else the folder.
export function repoName(d: BandData): string {
  const path = d.git?.repoPath || d.identity?.cwd || ''
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}

// The caption beside the mark's lower half: the name from the `caption`
// option in gem type, then the repository.
export function captionRow(T: Table, d: BandData): RenderElement {
  const { Box, Text, Button } = T
  const name = d.caption.trim()
  const repo = repoName(d)
  const n = Math.max(1, name.length - 1)
  const letters = [...name].map((ch, i) => <Text color={sampleRamp(CAPTION_INK, i / n)} bold>{ch}</Text>)
  return (
    <Box key="caption" paddingLeft={1}>
      {name === '' ? <Text /> : <Text>{letters}</Text>}
      {name !== '' && repo !== '' ? <Text color={CORE.border}>{'  ◆  '}</Text> : <Text />}
      {repo === '' ? <Text /> : <Text color={ROLE.sec}>{repo}</Text>}
      <Text>{'   '}</Text>
      <Button key="crest-fold" label="◂ fold" hotkey="e" plain dimColor onPress={d.onToggleCrest} />
    </Box>
  )
}
