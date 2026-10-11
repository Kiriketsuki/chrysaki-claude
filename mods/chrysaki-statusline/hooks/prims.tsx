// Drawing primitives the header and the ledger share. No I/O happens here.

import type { Elements, RenderElement } from 'claude-code'

import type { BandData } from './draw'
import type { Gem } from './gem'
import { readableInk, sampleRamp } from './gradient'
import { CORE, ROLE } from './palette'
import type { Paint } from './raster'
import type { RuleSpec } from './rules'

export type Table = Elements[keyof Elements]

// A group that shows a card one row above it while hovered.
export function hoverGroup(T: Table, key: string, card: string, children: RenderElement[]): RenderElement {
  const { Box, Text } = T
  return (
    <Box key={key}>
      {children}
      <Box position="absolute" top={-1} left={0} display="none" hover={{ display: 'flex' }} backgroundColor={CORE.elevated} paddingX={1}>
        <Text color={ROLE.text}>{card}</Text>
      </Box>
    </Box>
  )
}

// The colour of the band's rules: the prompt's own rule colour. It warms to
// Blonde inside the cache warning lead, so the alert also shows in the shape
// of the band.
export function frameColor(d: BandData): string {
  return d.cacheView?.tone === 'warning' ? ROLE.warn : 'promptBorder'
}

export function spaces(T: Table, n: number): RenderElement {
  const { Text } = T
  return <Text>{' '.repeat(Math.max(0, n))}</Text>
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}

// A header segment. `text` gives the width, so a pressable segment's text
// carries the `x: ` mark the painter adds before a hotkey. `iconFg` colours
// the glyph before the first space. A segment with `press` draws its label as
// a plain Button on the segment's ground. A segment with `drop` leaves when
// the header runs out of room, the lowest rank first.
export type Seg = {
  text: string
  bg: string
  fg: string
  bold?: boolean
  iconFg?: string
  // Gradient stops for the words after the icon, drawn letter by letter.
  ink?: readonly string[]
  press?: { key: string; label: string; hotkey?: string; onPress: () => void }
  drop?: number
}

// A ledger badge: a hexagon of one gem, with its label.
export type Badge = {
  key: string
  text: string
  gem: Gem
  // The badge's cells, its left cap included. The right cap and one space follow.
  width: number
  press?: { label: string; hotkey?: string; onPress: () => void }
}

// What a desktop Button leaves out of a row: the cells that the terminal draws
// inside the Button. Each field holds its cells in a Box of fixed width, so
// the columns of one row line up with the next. The terminal ignores it.
export type PressField = { width: number; cells: RenderElement[] }
export type PressRow = {
  // The ground of the row, so the fields share the ground of the Button's row.
  bg: string
  // Fields before the Button, such as a marker.
  before?: readonly PressField[]
  // The width of the Button's own field. Absent, the Button takes its natural width.
  width?: number
  // Fields after the Button.
  after?: readonly PressField[]
}

// Letters of `text`, each in its own colour along the `ink` run. The letters
// paint `bg` as their ground. With `hasGround` false they read `bg` for the
// contrast only, and a Box around them paints the ground.
export function inked(T: Table, text: string, ink: readonly string[], bg: string, bold?: boolean, hasGround = true): RenderElement[] {
  const { Text } = T
  const n = Math.max(1, text.trim().length - 1)
  let k = 0
  const ground = hasGround ? { backgroundColor: bg } : {}
  return [...text].map(ch => {
    if (ch === ' ') return <Text {...ground}> </Text>
    const color = readableInk(sampleRamp(ink, k++ / n), bg)
    return <Text {...ground} color={color} bold={bold}>{ch}</Text>
  })
}

// The pieces of the band that depend on the surface. The layout calls these
// and never reads a cell width itself, so the terminal and the desktop share
// one layout and differ only in what each piece paints. See prims-terminal.tsx
// and prims-desktop.tsx.
export type Prims = {
  // The drawer chevron at the start of the header, and the cells it takes. The
  // terminal Button is one cell. A desktop Button is padded, so its Box is wider.
  chevron: (p: { label: string; onPress: () => void }) => RenderElement
  chevronCells: number
  // A row of cells: a bar, a spark. The terminal paints a Raster, others Text.
  row: (key: string, paints: readonly Paint[]) => RenderElement
  // A bar of discrete glyphs, such as the line, block and hex styles.
  textBar: (paints: readonly Paint[]) => RenderElement
  // The bare track of a bar with no figure yet.
  emptyLine: (length: number) => RenderElement
  // A hexagon gem badge, then one space.
  badge: (b: Badge) => RenderElement[]
  // The glyph that joins two header segments, in `fg` on `bg`.
  edge: (glyph: string, fg: string, bg?: string) => RenderElement
  segBody: (s: Seg) => RenderElement
  // `n` empty cells. `fill` is the pad that runs a git subject out to its age.
  gap: (n: number) => RenderElement
  fill: (n: number) => RenderElement
  // A fixed-width figure, aligned to the column edge.
  fig: (text: string, width: number, color: string, opts?: { bold?: boolean; right?: boolean }) => RenderElement
  // The tokens used, then the window, in one fixed field.
  amount: (used: string, of: string, width: number) => RenderElement
  resetKey: (label: string, text: string) => RenderElement
  // A plain Button. The terminal draws `body` as its cells. A desktop button
  // takes a string label alone, so it draws `label`, and `row` carries the
  // rest of the line in fixed-width fields.
  press: (p: { key: string; label: string; hotkey?: string; onPress: () => void; body: RenderElement[]; row?: PressRow }) => RenderElement
  pressKey: (boxKey: string, key: string, label: string, hotkey: string, onPress: () => void, width: number) => RenderElement
  // Keeps one item of a row on one line. The terminal clips at the cell edge on
  // its own and returns the item as it is. The desktop wraps a Text that is
  // short of room, so it sets the item in a Box that does not shrink.
  hold: (el: RenderElement) => RenderElement
  // A ledger cell: a fixed-width Box.
  cell: (key: string, width: number, children: RenderElement[]) => RenderElement
  // The column separator, SEP cells wide. The desktop two-up ledger asks for
  // fewer cells. The terminal always draws SEP.
  vsep: (cells?: number) => RenderElement
  dashRule: (spec: RuleSpec) => RenderElement
  headerRule: (room: number) => RenderElement
}
