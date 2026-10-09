import { describe, expect, test } from 'claude-code/testing'

import { smoothCells } from '../hooks/format'
import { mixHex } from '../hooks/gradient'
import { blendZones, ledgerRules, rulePaints, smoothPaints } from '../hooks/ledger'
import { CORE, ROLE } from '../hooks/palette'
import { DEFAULT_COLOR, packCells, paintCells, unpackCells } from '../hooks/raster'

const ZONES = [
  { until: 50, color: ROLE.emeraldLt },
  { until: 75, color: ROLE.teal },
  { until: Infinity, color: ROLE.error },
]

describe('raster cells', () => {
  test('pack and unpack give back the same cells', async () => {
    const cells = paintCells([
      { glyph: '▍', fg: '#1a8a6a', bg: '#363a4f' },
      { glyph: ' ', fg: null, bg: null },
      { glyph: '┼', fg: '#20969c', bg: null },
    ])
    expect(unpackCells(packCells(cells))).toEqual(cells)
    expect(cells[1]).toEqual({ codePoint: 0x20, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR })
    expect(cells[0]?.fg).toBe(0x1a8a6a)
  })
})

describe('smooth bars', () => {
  test('a bar fills in eighths of a cell', async () => {
    // 50% of 4 cells is 16 eighths: two full cells.
    expect(smoothCells(50, 4).map(c => c.glyph).join('')).toBe('██  ')
    // 3 of 16 cells and one eighth: 25 eighths of 128 is 19.53%.
    expect(smoothCells(19.53, 16).map(c => c.glyph).join('').trimEnd()).toBe('███▏')
    expect(smoothCells(0, 3).every(c => c.fill === 0)).toBe(true)
    expect(smoothCells(140, 3).every(c => c.fill === 1)).toBe(true)
  })

  test('zone colours mix across each boundary and hold inside a zone', async () => {
    expect(blendZones(ZONES, 20, 16)).toBe(ROLE.emeraldLt)
    expect(blendZones(ZONES, 62, 16)).toBe(ROLE.teal)
    // On the boundary the colour is halfway between the two zones.
    expect(blendZones(ZONES, 50, 16)).toBe(mixHex(ROLE.emeraldLt, ROLE.teal, 0.5))
    expect(blendZones(ZONES, 50, 16)).not.toBe(ROLE.emeraldLt)
  })

  test('the track sits under every cell and empty cells carry no ink', async () => {
    const paints = smoothPaints(30, ZONES, 8)
    expect(paints.every(p => p.bg === CORE.border)).toBe(true)
    expect(paints.filter(p => p.fg !== null).length).toBe(3)
    expect(paints[7]?.fg).toBeNull()
  })
})

describe('rule rasters', () => {
  test('a rule frame keeps the crossings and moves its colours with the frame', async () => {
    const spec = ledgerRules(237)[0]
    expect(spec?.key).toBe('rule-1')
    if (spec === undefined) return
    const a = rulePaints(spec, 0)
    const b = rulePaints(spec, 5)
    expect(a.length).toBe(236)
    expect(a.map(p => p.glyph).join('')).toContain('┼')
    expect(a.filter(p => p.glyph === ' ').every(p => p.fg === null)).toBe(true)
    expect(a[0]?.fg).not.toBe(b[0]?.fg)
  })

  test('a stacked ledger has three rules', async () => {
    expect(ledgerRules(130).map(r => r.key)).toEqual(['rule-1', 'rule-2', 'rule-3'])
  })
})
