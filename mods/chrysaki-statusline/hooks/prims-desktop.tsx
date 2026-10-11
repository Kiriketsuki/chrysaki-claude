// The desktop's pieces of the band. The desktop draws Text in a proportional
// face, has no Nerd Font and no cell grid, so a glyph can neither hold a
// column nor draw a chamfer. Each piece here keeps the cell widths of the
// terminal band instead. A fixed-width Box holds every figure, and an Svg
// draws every chamfer, bar, rule and column line. Box widths count cells of
// the surface's code font, so the columns line up wherever the text falls.
// No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { BandData } from './draw'
import { gemColors } from './gem'
import { RESET } from './grid'
import { readableInk } from './gradient'
import { CORE, ROLE } from './palette'
import { inked, truncate } from './prims'
import type { Badge, PressField, Prims, Seg, Table } from './prims'
import type { Paint } from './raster'
import { headerRulePaints, ruleText, rulePaints } from './rules'
import { PILL_LINES, capSvg, gemSvg, isDrawn, paintSvg, vsepSvg } from './svg'

export type DesktopTable = Extract<Table, { Svg: unknown }>

// The colour of the rules and the column line. A hook cannot read the theme's
// own rule colour as a hex value, so the desktop takes the nearest grey of the
// palette. The cache warning warms it to Blonde, as it does on the terminal.
const FRAME = CORE.textMuted

// A badge Button with a hotkey draws a keycap before its label, about two
// cells wide, and the Button centres as one group. The label then sits right
// of the gem's centre line. The badge keeps this many cells free on its right,
// so the group shifts left by half of them and the label lands on the centre
// line of the badges that have no keycap.
export const KEYCAP_CELLS = 3

export function desktopPrims(T: DesktopTable, d: BandData): Prims {
  const { Box, Text, Button, Svg } = T
  const ROW = d.rowPx
  const frame = d.cacheView?.tone === 'warning' ? ROLE.warn : FRAME
  // The gradient rules hold still on the desktop: one frame, drawn once.
  const isGradient = d.isRuleAnimated && d.cacheView?.tone !== 'warning'

  // A Box of fixed cell width that holds one drawing. The ground fills the
  // whole line, so a drawing a few pixels short of it still shows no gap. The
  // drawing centres on the line, so a row height that is too large clips the
  // top and the bottom evenly and keeps the midline on the text.
  const drawing = (key: string | undefined, width: number, source: string, alt: string, bg?: string, flex = 0): RenderElement => {
    // A Svg with no fixed Box around it takes its markup width and pushes the
    // rest of the row off the site. A width under one cell draws nothing.
    if (width < 1) return gap(0)
    return (
      <Box {...(key === undefined ? {} : { key })} width={width} height={1} flexShrink={flex} {...(flex > 0 ? { minWidth: 0 } : {})} overflow="hidden" alignItems="center" {...(bg === undefined ? {} : { backgroundColor: bg })}>
        <Svg source={source} alt={alt} height={ROW} />
      </Box>
    )
  }

  // A fixed-width field. Its text never takes a padding space: the Box sets
  // the width and the edge the text hugs.
  const field = (width: number, children: RenderElement[], isRight = false, key?: string): RenderElement => (
    <Box {...(key === undefined ? {} : { key })} width={width} height={1} flexShrink={0} overflow="hidden" alignItems="center" justifyContent={isRight ? 'flex-end' : 'flex-start'}>
      {children}
    </Box>
  )

  const gap = (n: number): RenderElement => <Box width={Math.max(0, n)} height={1} flexShrink={0} />

  // One cell of a discrete glyph, such as a hexagon or a triangle.
  const glyphCell = (p: Paint): RenderElement => (
    <Box width={1} height={1} flexShrink={0} justifyContent="center" overflow="hidden" {...(p.bg === null ? {} : { backgroundColor: p.bg })}>
      <Text {...(p.fg === null ? {} : { color: p.fg })}>{p.glyph}</Text>
    </Box>
  )

  const drawRow = (key: string | undefined, paints: readonly Paint[]): RenderElement => {
    if (paints.every(p => isDrawn(p.glyph))) return drawing(key, paints.length, paintSvg(paints, ROW), key === undefined ? 'bar cells' : `${key} cells`)
    return <Box {...(key === undefined ? {} : { key })} width={paints.length} height={1} flexShrink={0}>{paints.map(glyphCell)}</Box>
  }

  const badge = (b: Badge): RenderElement[] => {
    const inner = b.width - 1
    const button = b.press === undefined
      ? null
      : <Button key={b.key} label={b.press.label} {...(b.press.hotkey === undefined ? {} : { hotkey: b.press.hotkey })} plain onPress={b.press.onPress} />
    // The Button with a keycap is wider than the room left beside the pad. A
    // Box that does not shrink keeps the label whole, and the group centres
    // over its own width.
    const label = button === null
      ? <Text color={ROLE.text} bold wrap="truncate-end">{b.text}</Text>
      : b.press?.hotkey === undefined ? button : <Box flexShrink={0} alignItems="center">{button}</Box>
    return [
      <Box key={`gem-${b.key}`} position="relative" width={b.width + 1} height={1} flexShrink={0} overflow="hidden" alignItems="center">
        <Svg source={gemSvg(gemColors(b.gem, inner), ROW)} alt={`${b.key} badge`} height={ROW} />
        <Box position="absolute" top={0} left={1} width={inner} height={1} justifyContent="center" alignItems="center" {...(b.press?.hotkey === undefined ? {} : { paddingRight: KEYCAP_CELLS })}>{label}</Box>
      </Box>,
      gap(1),
    ]
  }

  // A segment is s.text.length + 2 cells wide, as on the terminal. The text is
  // narrower than the same count of cells, so it centres between the two
  // edges. The spare width then splits evenly and the pill keeps one even
  // margin on each side, as the terminal pill does. The ground stands a little
  // shorter than the line, as high as the edge drawings, so the pills of two
  // stacked header rows leave a gap between them.
  const pill = (key: string | undefined, width: number, isMin: boolean, children: RenderElement[], bg: string): RenderElement => (
    <Box {...(key === undefined ? {} : { key })} {...(isMin ? { minWidth: width } : { width, overflow: 'hidden' as const })} height={1} flexShrink={0} alignItems="center">
      <Box {...(isMin ? { minWidth: width } : { width })} height={PILL_LINES} flexShrink={0} overflow="hidden" alignItems="center" justifyContent="center" paddingX={1} backgroundColor={bg}>
        {children}
      </Box>
    </Box>
  )

  const segBody = (s: Seg): RenderElement => {
    const width = s.text.length + 2
    if (s.press !== undefined) {
      return pill(`seg-${s.press.key}`, width, true, [<Button key={s.press.key} label={s.press.label} {...(s.press.hotkey === undefined ? {} : { hotkey: s.press.hotkey })} plain onPress={s.press.onPress} />], s.bg)
    }
    const at = s.text.indexOf(' ')
    // The pill Box paints the ground alone. A Text with its own ground would
    // paint the font's full content area, which stands taller than the pill
    // and sticks out above and below its chamfers.
    let body: RenderElement
    if (s.iconFg === undefined && s.ink !== undefined) {
      body = <Text>{inked(T, s.text, s.ink, s.bg, s.bold, false)}</Text>
    } else if (s.iconFg === undefined || at < 0) {
      body = <Text color={s.fg} bold={s.bold} wrap="truncate-end">{s.text}</Text>
    } else {
      const icon = <Text color={readableInk(s.iconFg, s.bg)} bold>{s.text.slice(0, at)}</Text>
      body = s.ink === undefined
        ? <Text>{[icon, <Text color={s.fg} bold={s.bold}>{s.text.slice(at)}</Text>]}</Text>
        : <Text>{[icon, <Text> </Text>, ...inked(T, s.text.slice(at + 1), s.ink, s.bg, s.bold, false)]}</Text>
    }
    return pill(undefined, width, false, [body], s.bg)
  }

  // The cells of a rule, in the frame colour. A gap draws no cell.
  const framePaints = (text: string): Paint[] => [...text].map(glyph => ({ glyph, fg: glyph === ' ' ? null : frame, bg: null }))
  // A space, `room` rule cells and a space: the header rule in the frame colour.
  const framed = (room: number): Paint[] => [
    { glyph: ' ', fg: null, bg: null },
    ...Array.from({ length: room }, () => ({ glyph: '─', fg: frame, bg: null })),
    { glyph: ' ', fg: null, bg: null },
  ]

  return {
    // The desktop header has no drawer chevron. It draws nothing and takes no
    // cell, and the hint stays open on this surface.
    chevron: () => gap(0),
    chevronCells: 0,
    row: drawRow,
    textBar: paints => drawRow(undefined, paints),
    emptyLine: length => drawRow(undefined, Array.from({ length }, () => ({ glyph: '─', fg: CORE.border, bg: null }))),
    badge,
    // The edge holds its own ground inside the drawing, inset like the pills.
    edge: (glyph, fg, bg) => drawing(undefined, 1, capSvg(glyph, fg, bg, ROW), 'edge'),
    segBody,
    gap,
    fill: () => <Box flexGrow={1} minWidth={0} height={1} />,
    fig: (text, width, color, opts = {}) => field(width, [<Text color={color} bold={opts.bold} wrap="truncate-end">{truncate(text, width)}</Text>], opts.right === true),
    amount: (used, of, width) => field(width, [
      <Text color={ROLE.text} bold>{used}</Text>,
      <Text color={ROLE.sec} wrap="truncate-end">{truncate(of, width - used.length)}</Text>,
    ]),
    // The reset time is plain Text on the desktop. The limits read again on
    // their own schedule, and a native button here would crowd the two
    // busiest rows of the band.
    resetKey: (label, text) => field(RESET, [
      <Text color={d.isLimitsBusy ? ROLE.blondeLt : ROLE.teal}>{d.isLimitsBusy ? '◐' : '↻'}</Text>,
      gap(1),
      <Text color={ROLE.sec} dimColor wrap="truncate-end">{text}</Text>,
    ], false, `reset-${label}`),
    pressKey: (boxKey, key, label, hotkey, onPress, width) => (
      <Box key={boxKey} width={width} height={1} flexShrink={0} overflow="hidden" alignItems="center">
        <Text color={ROLE.blondeLt} bold>⬢</Text>
        {gap(1)}
        <Button key={key} label={label} hotkey={hotkey} plain onPress={onPress} />
      </Box>
    ),
    press: ({ key, label, hotkey, onPress, row }) => {
      const button = <Button key={key} label={label} {...(hotkey === undefined ? {} : { hotkey })} plain onPress={onPress} />
      if (row === undefined) return button
      const slot = (f: PressField, i: number): RenderElement => (
        <Box key={`${key}-field-${i}`} width={f.width} height={1} flexShrink={0} overflow="hidden" alignItems="center" backgroundColor={row.bg}>{f.cells}</Box>
      )
      return (
        <Box key={`${key}-row`} height={1} alignItems="center" backgroundColor={row.bg}>
          {(row.before ?? []).map(slot)}
          {row.width === undefined
            ? button
            : <Box key={`${key}-label`} width={row.width} height={1} flexShrink={0} overflow="hidden" alignItems="center" backgroundColor={row.bg}>{button}</Box>}
          {(row.after ?? []).map((f, i) => slot(f, i + (row.before?.length ?? 0)))}
        </Box>
      )
    },
    hold: el => <Box flexShrink={0} height={1} alignItems="center">{el}</Box>,
    cell: (key, width, children) => <Box key={key} width={width} height={1} flexShrink={0} overflow="hidden">{children}</Box>,
    vsep: (cells = 5) => drawing(undefined, cells, vsepSvg(frame, ROW, cells), 'column divider'),
    dashRule: spec => drawing(undefined, spec.width, paintSvg(isGradient ? rulePaints(spec, 0) : framePaints(ruleText(spec.width, spec.crosses)), ROW), 'row rule'),
    headerRule: room => drawing(undefined, room + 2, paintSvg(isGradient ? headerRulePaints(room, 0) : framed(room), ROW), 'header rule', undefined, 1),
  }
}

