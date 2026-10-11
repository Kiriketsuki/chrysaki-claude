// The rules of the band: the dashed rule between ledger rows and the rule of
// the header. Each rule is a run of cells, so a surface draws it as it can.
// No I/O happens here.

import { loopSampler, mixHex } from './gradient'
import { CORE, ROLE } from './palette'
import { frameColor } from './prims'
import type { Table } from './prims'
import type { BandData } from './draw'
import { hasRaster, packCells, paintCells } from './raster'
import type { Paint } from './raster'

export const RULE = '─'

// The animated rule: a gradient loop that travels one full cycle across the
// band in SWEEP_FRAMES steps. Only safe line accents take part: Royal Blue and
// Amethyst are fills alone.
export const SWEEP_FRAMES = 40
const SWEEP_STOPS = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean, ROLE.teal] as const
export const sweepAt = loopSampler(SWEEP_STOPS)

// The brand run, as a loop for the drifting header rule.
export const BRAND_INK = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean] as const
const brandAt = loopSampler(BRAND_INK)

// A dash run of DASH cells, then GAP_CELLS blank cells, cut to `width`.
export const DASH = 2
export const GAP_CELLS = 1

export function dashes(width: number): string {
  const unit = '─'.repeat(DASH) + ' '.repeat(GAP_CELLS)
  return unit.repeat(Math.ceil(Math.max(0, width) / unit.length)).slice(0, Math.max(0, width))
}

// Where a column separator meets the rule, and how.
export type Cross = { at: number; glyph: '┼' | '┴' }

// The dashes with each crossing drawn in. A crossing gets a dash cell on both
// sides, so it never floats in a gap.
export function ruleText(width: number, crosses: readonly Cross[]): string {
  const cells = [...dashes(width)]
  for (const c of crosses) {
    if (c.at < 0 || c.at >= width) continue
    cells[c.at] = c.glyph
    if (c.at > 0) cells[c.at - 1] = '─'
    if (c.at + 1 < width) cells[c.at + 1] = '─'
  }
  return cells.join('')
}

// One animated rule: its Raster key, its width and its crossings.
export type RuleSpec = { key: string; width: number; crosses: Cross[] }

// The cells of a rule at sweep frame `frame`. Each dash cell takes its own
// place on the gradient loop. Gaps take the terminal's colour.
export function rulePaints(spec: RuleSpec, frame: number): Paint[] {
  const width = Math.max(1, spec.width)
  return [...ruleText(spec.width, spec.crosses)].map((glyph, x) => ({
    glyph,
    fg: glyph === ' ' ? null : sweepAt(x / width + frame / SWEEP_FRAMES),
    bg: null,
  }))
}

// The packed cells a blit sends for a rule at sweep frame `frame`.
export function ruleFrame(spec: RuleSpec, frame: number): string {
  return packCells(paintCells(rulePaints(spec, frame)))
}

// The cells of the header rule at sweep frame `frame`: a faint brand loop
// that drifts along it, one space at each end.
export function headerRulePaints(room: number, frame: number): Paint[] {
  const dashCells = Array.from({ length: room }, (_, i) => ({ glyph: RULE, fg: mixHex(CORE.border, brandAt(i / Math.max(1, room) - frame / SWEEP_FRAMES), 0.55), bg: null }))
  return [{ glyph: ' ', fg: null, bg: null }, ...dashCells, { glyph: ' ', fg: null, bg: null }]
}

// True when the band draws its rules as Rasters the sweep clock repaints.
export function isRuleLive(T: Table, d: BandData): boolean {
  return d.isRuleAnimated && frameColor(d) === 'promptBorder' && hasRaster(T, d.surface)
}
