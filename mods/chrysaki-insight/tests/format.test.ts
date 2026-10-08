import { describe, expect, test } from 'claude-code/testing'

import { barCells, clock, duration, padEnd, padStart, percentOf, tokens, truncate, usd } from '../hooks/format'
import { C, BAR_COLORS } from '../hooks/theme'

describe('tokens', () => {
  test('keeps small counts whole and shortens large ones', () => {
    expect(tokens(0)).toBe('0')
    expect(tokens(812)).toBe('812')
    expect(tokens(1234)).toBe('1.2k')
    expect(tokens(45_600)).toBe('46k')
    expect(tokens(1_250_000)).toBe('1.3M')
  })

  test('reads a bad number as zero', () => {
    expect(tokens(Number.NaN)).toBe('0')
    expect(tokens(-5)).toBe('0')
  })
})

describe('percentOf', () => {
  test('shows one decimal below ten percent', () => {
    expect(percentOf(5, 1000)).toBe('0.5%')
    expect(percentOf(250, 1000)).toBe('25%')
  })

  test('shows 0% for an empty part or window', () => {
    expect(percentOf(0, 1000)).toBe('0%')
    expect(percentOf(10, 0)).toBe('0%')
  })
})

describe('duration', () => {
  test('picks the unit by size', () => {
    expect(duration(420)).toBe('420ms')
    expect(duration(1500)).toBe('1.5s')
    expect(duration(185_000)).toBe('3m05s')
    expect(duration(3_900_000)).toBe('1h05m')
  })

  test('clamps a negative span', () => {
    expect(duration(-1)).toBe('0ms')
  })
})

describe('clock, truncate and padding', () => {
  test('clock prints two digits per field', () => {
    expect(clock(new Date(2026, 9, 6, 7, 4, 9).getTime())).toBe('07:04:09')
  })

  test('truncate flattens whitespace and ends with an ellipsis', () => {
    expect(truncate('a  b\nc', 10)).toBe('a b c')
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
  })

  test('padEnd cuts long text so a column keeps its width', () => {
    expect(padEnd('abcdefgh', 4)).toBe('abc…')
    expect(padEnd('ab', 4)).toBe('ab  ')
    expect(padStart('ab', 4)).toBe('  ab')
  })

  test('usd marks a sub-cent cost', () => {
    expect(usd(0.004)).toBe('<$0.01')
    expect(usd(1.239)).toBe('$1.24')
  })
})

describe('barCells', () => {
  test('splits a bar by share', () => {
    expect(barCells(0.5, 10)).toEqual({ filled: 5, empty: 5 })
    expect(barCells(1, 10)).toEqual({ filled: 10, empty: 0 })
  })

  test('keeps one cell for a tiny share and none for zero', () => {
    expect(barCells(0.001, 10)).toEqual({ filled: 1, empty: 9 })
    expect(barCells(0, 10)).toEqual({ filled: 0, empty: 10 })
  })

  test('clamps a share past the window', () => {
    expect(barCells(1.4, 10)).toEqual({ filled: 10, empty: 0 })
    expect(barCells(Number.NaN, 10)).toEqual({ filled: 0, empty: 10 })
  })
})

describe('theme', () => {
  test('bars use only safe text accents', () => {
    const fills = ['#122858', '#1c3d7a', '#3a2068', '#583090']
    for (const color of BAR_COLORS) expect(fills.includes(color)).toBe(false)
    expect(BAR_COLORS.includes(C.emeraldLt)).toBe(true)
  })
})
