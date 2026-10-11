import { describe, expect, test } from 'claude-code/testing'

import { rowPxOption } from '../hooks/format'
import { GEMS, gemColors } from '../hooks/gem'
import { leftEdge, rightEdge } from '../hooks/format'
import { ledgerRules } from '../hooks/ledger'
import { ROLE } from '../hooks/palette'
import { rulePaints } from '../hooks/rules'
import { CAP_POINTS, GEM_PAD, PAD, PILL_LINES, capSvg, gemSvg, paintSvg, vsepSvg } from '../hooks/svg'

const ROW = 26
const GLYPHS = ['\ue0b0', '\ue0b2', '\ue0bc', '\ue0b8', '\ue0be', '\ue0ba']

function count(text: string, part: string): number {
  return text.split(part).length - 1
}

describe('capSvg', () => {
  test('draws each edge glyph as its polygon on a 1 by 1 cell', () => {
    for (const glyph of GLYPHS) {
      const svg = capSvg(glyph, '#112233', '#445566', ROW)
      expect(svg).toContain('viewBox="0 -0.15 1 1.3"')
      expect(svg).toContain('preserveAspectRatio="none"')
      expect(svg).toContain(`height="${ROW}"`)
      expect(svg).toContain(`<polygon points="${CAP_POINTS[glyph]}" fill="#112233"/>`)
    }
  })

  test('draws the ground rect only when a neighbour gives one', () => {
    expect(capSvg('\ue0b0', '#112233', '#445566', ROW)).toContain('<rect x="0" y="0" width="1" height="1" fill="#445566"/>')
    expect(capSvg('\ue0b0', '#112233', undefined, ROW)).not.toContain('<rect')
  })

  test('knows every glyph the header edges can take', () => {
    for (let n = 1; n <= 6; n++) {
      for (let i = 0; i < n; i++) {
        expect(CAP_POINTS[rightEdge(i, n)]).toBeDefined()
        expect(CAP_POINTS[leftEdge(i, n)]).toBeDefined()
      }
    }
  })
})

describe('gemSvg', () => {
  test('holds both caps and a body that covers the cells between them', () => {
    const colors = gemColors(GEMS.emerald, 5)
    const svg = gemSvg(colors, ROW)
    expect(svg).toContain('viewBox="0 -0.26 7 1.52"')
    expect(svg).toContain(`<polygon points="1.02,0 0,0.5 1.02,1" fill="${colors[0]}"/>`)
    expect(svg).toContain(`<polygon points="5.98,0 7,0.5 5.98,1" fill="${colors[4]}"/>`)
    // The body rects start at cell 1 and end at cell 6.
    const xs = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])] as const)
    expect(xs[0]?.[0]).toBe(1)
    const last = xs[xs.length - 1] as readonly [number, number]
    expect(Math.round(last[0] + last[1])).toBe(6)
  })
})

describe('the pill inset', () => {
  test('stands each pill shorter than the line, by the same pad above and below', () => {
    expect(PAD).toBe(0.15)
    expect(Math.abs(PILL_LINES - 1 / 1.3)).toBeLessThan(1e-9)
    expect(GEM_PAD).toBe(0.26)
    // The ledger gem is inset more than a header pill, so stacked gems part.
    expect(GEM_PAD).toBeGreaterThan(PAD)
    const gem = gemSvg(gemColors(GEMS.emerald, 5), ROW)
    for (const svg of [capSvg('\ue0b0', '#112233', '#445566', ROW), gem]) {
      const pad = svg === gem ? GEM_PAD : PAD
      const box = /viewBox="0 (-?[\d.]+) [\d.]+ ([\d.]+)"/.exec(svg)
      expect(Number(box?.[1])).toBe(-pad)
      // No shape reaches the top or the bottom edge of the viewBox.
      const ys = [...svg.matchAll(/y="(-?[\d.]+)"/g)].map(m => Number(m[1]))
      const heights = [...svg.matchAll(/ height="([\d.]+)"/g)].filter(m => m[1] !== String(ROW)).map(m => Number(m[1]))
      for (const y of ys) expect(y).toBeGreaterThan(-pad)
      for (const h of heights) expect(h).toBeLessThanOrEqual(1)
    }
  })
})

describe('paintSvg', () => {
  const one = (glyph: string) => paintSvg([{ glyph, fg: '#112233', bg: null }], ROW)

  test('sets a light rule 1 px tall and a heavy rule thicker', () => {
    expect(one('─')).toContain(`y="13" width="1.02" height="1"`)
    expect(one('━')).toContain('height="3"')
    expect(one('╸')).toContain('width="0.5" height="3"')
  })

  test('crosses a rule with a column line', () => {
    expect(one('┼')).toContain(`<line x1="0.5" y1="0" x2="0.5" y2="${ROW}"`)
    expect(one('┴')).toContain('<line x1="0.5" y1="0" x2="0.5" y2="13"')
    expect(one('┼')).toContain('vector-effect="non-scaling-stroke"')
  })

  test('fills eighth blocks by their width', () => {
    expect(one('▊')).toContain('width="0.75"')
    expect(one('█')).toContain(`width="1.02" height="${ROW}"`)
    expect(one('░')).toContain('fill-opacity="0.35"')
  })

  test('draws a braille cell as one square per dot', () => {
    expect(count(one('⣿'), '<rect')).toBe(8)
    const low = one('⡀')
    expect(count(low, '<rect')).toBe(1)
    expect(low).toContain('x="0.17"')
  })

  test('merges a run of equal rules into one rect', () => {
    const paints = Array.from({ length: 6 }, () => ({ glyph: '─', fg: '#112233', bg: null }))
    expect(count(paintSvg(paints, ROW), '<rect')).toBe(1)
  })

  test('blends a bar whose colour steps cell by cell into one gradient rect', () => {
    const inks = ['#14664e', '#1a8a6a', '#fbb13c', '#c4861c']
    const svg = paintSvg(inks.map(fg => ({ glyph: '━', fg, bg: null })), ROW)
    expect(count(svg, '<rect')).toBe(1)
    expect(svg).toContain('fill="url(#ink0)"')
    expect(count(svg, '<stop ')).toBe(4)
    expect(svg).toContain('<stop offset="0.125" stop-color="#14664e"/>')
  })

  test('draws the row rule with a tick at each crossing', () => {
    const svg = paintSvg(rulePaints(ledgerRules(160)[0]!, 0), ROW)
    expect(svg).toContain('x1="36.5"')
    expect(svg).toContain('x1="93.5"')
    // The rule's gradient leads with Emerald, as a fill or as a gradient stop.
    expect(svg).toMatch(new RegExp(`(fill|stop-color)="${ROLE.emeraldLt}"`))
  })
})

describe('the gem body', () => {
  test('blends the facet in one gradient rect, with no band per cell', () => {
    const svg = gemSvg(gemColors(GEMS.emerald, 5), ROW)
    expect(count(svg, '<rect')).toBe(1)
    expect(svg).toContain('fill="url(#facet)"')
    expect(count(svg, '<stop ')).toBe(5)
  })

  test('fills a flat gem with one colour and no gradient', () => {
    const svg = gemSvg(['#14664e', '#14664e', '#14664e'], ROW)
    expect(svg).not.toContain('linearGradient')
    expect(svg).toContain('fill="#14664e" shape-rendering')
  })
})

describe('vsepSvg', () => {
  test('draws a line at the middle of five cells', () => {
    expect(vsepSvg('#112233', ROW)).toContain('<line x1="2.5"')
  })
})

describe('the markup', () => {
  test('holds no radius and no clip', () => {
    const all = [
      ...GLYPHS.map(g => capSvg(g, '#112233', '#445566', ROW)),
      gemSvg(gemColors(GEMS.teal, 7), ROW),
      paintSvg(rulePaints(ledgerRules(238)[0]!, 3), ROW),
      vsepSvg('#112233', ROW),
    ].join('')
    expect(all).not.toMatch(/\b(rx|ry)=|clip-path|border-radius/)
  })
})

describe('rowPxOption', () => {
  test('reads a whole number and clamps it', () => {
    expect(rowPxOption('24')).toBe(24)
    expect(rowPxOption('x')).toBe(20)
    expect(rowPxOption(undefined)).toBe(20)
    expect(rowPxOption('5')).toBe(12)
    expect(rowPxOption('99')).toBe(48)
  })
})
