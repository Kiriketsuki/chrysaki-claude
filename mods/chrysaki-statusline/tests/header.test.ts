import { describe, expect, test } from 'claude-code/testing'

import { fitSegs } from '../hooks/draw'

// Each segment takes its text plus three cells: two of padding, one edge.
const seg = (text: string, drop?: number) => ({ text, drop })

describe('fitSegs', () => {
  const left = [seg('⬢ Opus 5.5'), seg('◆ v2.1.292', 1), seg('⌂ Aurrigo/AutoConnect', 3)]
  const right = [seg('o: ⚠ major'), seg('◈ $11.02'), seg('◷ 59m 06s', 2), seg('a: ben@work.example', 4)]

  test('keeps every segment when they fit', () => {
    const [l, r] = fitSegs(left, right, 200)
    expect(l.length).toBe(3)
    expect(r.length).toBe(4)
  })

  test('drops the version first, then the clock', () => {
    const [l1] = fitSegs(left, right, 100)
    expect(l1.map(s => s.text)).not.toContain('◆ v2.1.292')
    const [, r2] = fitSegs(left, right, 85)
    expect(r2.map(s => s.text)).not.toContain('◷ 59m 06s')
  })

  test('never drops the model or the outage badge', () => {
    const [l, r] = fitSegs(left, right, 10)
    expect(l.map(s => s.text)).toEqual(['⬢ Opus 5.5'])
    expect(r.map(s => s.text)).toEqual(['o: ⚠ major', '◈ $11.02'])
  })
})
