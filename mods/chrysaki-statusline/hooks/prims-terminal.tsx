// The terminal's pieces of the band: Text runs, Rasters and the Nerd Font
// edge glyphs, laid out by cell. Each piece is the code the band drew before
// the desktop had its own, so the terminal band stays as it was. No I/O
// happens here.

import type { RenderElement } from 'claude-code'

import type { BandData } from './draw'
import { gemColor } from './gem'
import { SEP, SOCKET } from './grid'
import { readableInk } from './gradient'
import { ROLE } from './palette'
import { frameColor, inked, truncate } from './prims'
import type { Badge, Prims, Seg, Table } from './prims'
import { hasRaster, packCells, paintCells } from './raster'
import type { Paint } from './raster'
import { DASH, GAP_CELLS, RULE, SWEEP_FRAMES, headerRulePaints, isRuleLive, ruleText, rulePaints, sweepAt } from './rules'
import type { RuleSpec } from './rules'

// The caps that make a badge a flat hexagon: ◀ body ▶.
const CAP_LEFT = '\ue0b2'
const CAP_RIGHT = '\ue0b0'

function center(text: string, width: number): string {
  const room = Math.max(0, width - text.length)
  const left = Math.floor(room / 2)
  return ' '.repeat(left) + text + ' '.repeat(room - left)
}

// One row of cells: a Raster on the terminal, runs of Text elsewhere.
export function paintRow(T: Table, surface: string, key: string, paints: readonly Paint[]): RenderElement {
  if (hasRaster(T, surface)) {
    const { Raster } = T
    return <Raster key={key} columns={paints.length} rows={1} cells={packCells(paintCells(paints))} />
  }
  const { Text } = T
  const runs: { fg: string | null; bg: string | null; text: string }[] = []
  for (const p of paints) {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.fg === p.fg && last.bg === p.bg) last.text += p.glyph
    else runs.push({ fg: p.fg, bg: p.bg, text: p.glyph })
  }
  return (
    <Text key={key}>
      {runs.map(r => <Text {...(r.fg === null ? {} : { color: r.fg })} {...(r.bg === null ? {} : { backgroundColor: r.bg })}>{r.text}</Text>)}
    </Text>
  )
}

export function terminalPrims(T: Table, d: BandData): Prims {
  const { Box, Text, Button } = T

  // A hexagon gem badge: the left cap, a body whose ground runs across the
  // facet cell by cell, the right cap, and one space. A pressable badge draws
  // its cells as the children of a plain Button.
  const badge = (b: Badge): RenderElement[] => {
    const inner = b.width - 1
    const at = (i: number) => gemColor(b.gem, inner, i)
    const cells = (text: string, offset: number) => [...text].map((ch, i) => <Text backgroundColor={at(i + offset)} color={ROLE.text} bold>{ch}</Text>)
    const mark = b.press?.hotkey === undefined ? 0 : 3
    const body = b.press === undefined
      ? <Text>{cells(center(b.text, inner), 0)}</Text>
      : (
        <Box key={`badge-${b.key}`} width={inner} backgroundColor={at(1)}>
          <Button key={b.key} hotkey={b.press.hotkey} plain onPress={b.press.onPress}>{cells(center(b.press.label, inner - mark), mark)}</Button>
        </Box>
      )
    return [<Text color={at(0)}>{CAP_LEFT}</Text>, body, <Text color={at(inner - 1)}>{CAP_RIGHT}</Text>, <Text> </Text>]
  }

  const segBody = (s: Seg): RenderElement => {
    if (s.press !== undefined) {
      return (
        <Box key={`seg-${s.press.key}`} backgroundColor={s.bg}>
          <Text backgroundColor={s.bg}> </Text>
          {s.ink === undefined
            ? <Button key={s.press.key} hotkey={s.press.hotkey} plain onPress={s.press.onPress}><Text backgroundColor={s.bg} color={s.fg} bold={s.bold}>{s.press.label}</Text></Button>
            : <Button key={s.press.key} hotkey={s.press.hotkey} plain onPress={s.press.onPress}>{inked(T, s.press.label, s.ink, s.bg, s.bold)}</Button>}
          <Text backgroundColor={s.bg}> </Text>
        </Box>
      )
    }
    const at = s.text.indexOf(' ')
    if (s.iconFg === undefined && s.ink !== undefined) {
      return <Text backgroundColor={s.bg}>{[<Text backgroundColor={s.bg}> </Text>, ...inked(T, s.text, s.ink, s.bg, s.bold), <Text backgroundColor={s.bg}> </Text>]}</Text>
    }
    if (s.iconFg === undefined || at < 0) return <Text backgroundColor={s.bg} color={s.fg} bold={s.bold}>{` ${s.text} `}</Text>
    const icon = <Text backgroundColor={s.bg} color={readableInk(s.iconFg, s.bg)} bold>{` ${s.text.slice(0, at)}`}</Text>
    if (s.ink !== undefined) {
      return <Text backgroundColor={s.bg}>{[icon, <Text backgroundColor={s.bg}> </Text>, ...inked(T, s.text.slice(at + 1), s.ink, s.bg, s.bold), <Text backgroundColor={s.bg}> </Text>]}</Text>
    }
    return (
      <Text backgroundColor={s.bg}>
        {icon}
        <Text backgroundColor={s.bg} color={s.fg} bold={s.bold}>{`${s.text.slice(at)} `}</Text>
      </Text>
    )
  }

  const spaces = (n: number): RenderElement => <Text>{' '.repeat(Math.max(0, n))}</Text>

  // The dashed rule between two ledger rows. A separator above and below it
  // crosses it as `┼`. One above alone ends on it as `┴`. Animated, each dash
  // takes its place on the gradient loop, shifted by the sweep frame. On the
  // terminal the rule is a Raster, and the sweep clock repaints its cells with
  // `$.ui.blit`, so the band does not draw again. Elsewhere the rule keeps the
  // frame of its last draw. Inside the cache warning lead, or with the
  // animation off, the rule takes the frame colour.
  const dashRule = (spec: RuleSpec): RenderElement => {
    const base = frameColor(d)
    const text = ruleText(spec.width, spec.crosses)
    if (!d.isRuleAnimated || base !== 'promptBorder') return <Text color={base}>{text}</Text>
    if (hasRaster(T, d.surface)) return paintRow(T, d.surface, spec.key, rulePaints(spec, d.sweep))
    const unit = DASH + GAP_CELLS
    const parts: RenderElement[] = []
    for (let x = 0; x < spec.width; x += unit) {
      parts.push(<Text color={sweepAt(x / Math.max(1, spec.width) + d.sweep / SWEEP_FRAMES)}>{text.slice(x, x + unit)}</Text>)
    }
    return <Text>{parts}</Text>
  }

  return {
    chevron: ({ label, onPress }) => <Button key="hint-toggle" label={label} plain onPress={onPress} />,
    chevronCells: 1,
    row: (key, paints) => paintRow(T, d.surface, key, paints),
    textBar: paints => {
      const runs: { color: string; text: string }[] = []
      for (const p of paints) {
        const color = p.fg ?? SOCKET
        const last = runs[runs.length - 1]
        if (last !== undefined && last.color === color) last.text += p.glyph
        else runs.push({ color, text: p.glyph })
      }
      return <Text>{runs.map(r => <Text color={r.color}>{r.text}</Text>)}</Text>
    },
    emptyLine: length => <Text color={SOCKET}>{'─'.repeat(length)}</Text>,
    badge,
    edge: (glyph, fg, bg) => (bg === undefined ? <Text color={fg}>{glyph}</Text> : <Text color={fg} backgroundColor={bg}>{glyph}</Text>),
    segBody,
    gap: spaces,
    fill: spaces,
    fig: (text, width, color, opts = {}) => {
      const padded = opts.right ? text.padStart(width) : text.padEnd(width)
      return <Text color={color} bold={opts.bold}>{truncate(padded, width)}</Text>
    },
    amount: (used, of, width) => <Text><Text color={ROLE.text} bold>{used}</Text><Text color={ROLE.sec}>{truncate(of, width - used.length).padEnd(width - used.length)}</Text></Text>,
    resetKey: (label, text) => (
      <Box key={`reset-${label}`}>
        <Text color={d.isLimitsBusy ? ROLE.blondeLt : ROLE.teal}>{d.isLimitsBusy ? '◐' : '↻'}</Text>
        <Button key={`limits-${label}`} label={` ${text}`.padEnd(7)} plain dimColor onPress={d.onRefreshLimits} />
      </Box>
    ),
    press: ({ key, hotkey, onPress, body }) => <Button key={key} hotkey={hotkey} plain onPress={onPress}>{body}</Button>,
    pressKey: (boxKey, key, label, hotkey, onPress, width) => (
      <Box key={boxKey} width={width} flexShrink={0} overflow="hidden"><Text color={ROLE.blondeLt} bold>⬢ </Text><Button key={key} label={label} hotkey={hotkey} plain onPress={onPress} /></Box>
    ),
    hold: el => el,
    cell: (key, width, children) => <Box key={key} width={width} overflow="hidden">{children}</Box>,
    vsep: () => <Text color={frameColor(d)}>{SEP}</Text>,
    dashRule,
    headerRule: room => {
      if (isRuleLive(T, d)) return paintRow(T, d.surface, 'header-rule', headerRulePaints(room, d.sweep))
      return <Text color={frameColor(d)}>{` ${RULE.repeat(room)} `}</Text>
    },
  }
}
