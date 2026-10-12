import { describe, expect, test } from 'claude-code/testing'

import { MAX_ROWS, cutRows } from '../hooks/desktop-band'
import { accountLines, pickFields } from '../hooks/dropdown'
import { DESKTOP, TERMINAL, bandData, drawTree } from './fixtures/draw'
import type { Node } from './fixtures/draw'

// The open account dropdown is one Box of rows under the header. The desktop
// band counts those rows, so a band with the menu open never runs past the
// lines the desktop gives it, and the menu is never the part that scrolls away.

const PICK = { accountMenu: { mode: 'pick' as const, draftEmail: '', draftProfile: '' } }
const ADD = { accountMenu: { mode: 'add' as const, draftEmail: '', draftProfile: '' } }
const WIDTHS = [60, 80, 100, 130, 160, 206] as const

type Over = Parameters<typeof bandData>[0]

const accounts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ email: `user${i}@example.com`, profile: `Profile ${i}`, path: `/p/${i}`, isWork: i % 2 === 1 }))

const desktop = (columns: number, over: Over = {}) => drawTree(DESKTOP, bandData({ surface: 'desktop', columns, emblem: 'none', rowPx: 20, ...over }))

function all(n: Node, test: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (test(n)) out.push(n)
  for (const c of n.children) if (typeof c !== 'string') all(c, test, out)
  return out
}

const byKey = (n: Node, key: string): Node | undefined => all(n, x => x.props.key === key)[0]
const panel = (root: Node): Node | undefined => root.children.find((c): c is Node => typeof c !== 'string' && /^account-(pick|add-panel)$/.test(String(c.props.key)))

// The lines of the band: the panel counts its rows, any other child its height or one line.
function lines(root: Node): number {
  return root.children.reduce((sum, c) => {
    if (typeof c === 'string') return sum
    if (c === panel(root)) return sum + c.children.length
    return sum + (typeof c.props.height === 'number' ? c.props.height : 1)
  }, 0)
}

describe('accountLines', () => {
  test('matches the rows each panel draws', () => {
    for (const n of [0, 1, 2, 5]) {
      const d = bandData({ surface: 'desktop', accounts: accounts(n), ...PICK })
      expect(accountLines(d), `pick with ${n}`).toBe(panel(desktop(160, { accounts: accounts(n), ...PICK }))?.children.length)
    }
    const add = bandData({ surface: 'desktop', ...ADD })
    expect(accountLines(add)).toBe(panel(desktop(160, ADD))?.children.length)
  })

  test('is zero when the menu is closed', () => {
    expect(accountLines(bandData())).toBe(0)
  })
})

describe('the desktop band with the account menu open', () => {
  test('keeps header, menu and ledger inside the band limit at every width', () => {
    for (const columns of WIDTHS) {
      for (const n of [0, 2, 4]) {
        for (const [name, mode] of [['pick', PICK], ['add', ADD]] as const) {
          const root = desktop(columns, { accounts: accounts(n), ...mode })
          expect(lines(root), `${name} with ${n} accounts at ${columns}`).toBeLessThanOrEqual(MAX_ROWS)
          expect(panel(root), `${name} panel at ${columns}`).toBeDefined()
        }
      }
    }
  })

  test('cuts the ledger from the bottom, and keeps usage and context', () => {
    const root = desktop(60, PICK)
    expect(byKey(root, 'row-5h')).toBeDefined()
    expect(byKey(root, 'row-cache')).toBeDefined()
    expect(byKey(root, 'row-git-a')).toBeUndefined()
    expect(byKey(root, 'block-rule-2')).toBeUndefined()
  })

  test('keeps the whole ledger when the menu leaves the room', () => {
    const root = desktop(206, PICK)
    expect(byKey(root, 'row-0')).toBeDefined()
    expect(byKey(root, 'row-1')).toBeDefined()
  })

  test('cuts the menu text short on the desktop and leaves the terminal alone', () => {
    const hint = (root: Node) => all(root, n => n.type === 'Text' && n.children.join('').includes('sign in'))[0]
    expect(hint(desktop(100, PICK))?.props.wrap).toBe('truncate-end')
    const term = drawTree(TERMINAL, bandData({ columns: 160, ...PICK }))
    expect(hint(term)?.props.wrap).toBeUndefined()
  })

  test('uses the short hint in a narrow band', () => {
    const text = (root: Node) => all(root, n => n.type === 'Text').map(n => n.children.join('')).join('|')
    expect(text(desktop(60, PICK))).not.toContain('through its Firefox profile')
    expect(text(desktop(100, PICK))).toContain('through its Firefox profile')
  })

  test('fits the fields of a pick row inside the band', () => {
    for (const columns of [60, 80, 100]) {
      const root = desktop(columns, { accounts: accounts(2), ...PICK })
      const row = byKey(root, 'pick-user0@example.com-row')
      expect(row, `row at ${columns}`).toBeDefined()
      const cells = (row as Node).children.reduce((sum, c) => sum + (typeof c === 'string' ? 0 : Number(c.props.width ?? 0)), 0)
      // The edge bar and its space take two cells.
      expect(cells + 2, `row at ${columns}`).toBeLessThanOrEqual(columns)
    }
  })
})

describe('pickFields', () => {
  test('keeps every field when the room holds them', () => {
    expect(pickFields(60, false)).toEqual({ firefox: 8, profile: 19, kind: 12, state: 8 })
    expect(pickFields(70, true)).toEqual({ firefox: 8, profile: 19, kind: 12, state: 15 })
  })

  test('drops the firefox label, then shortens the profile', () => {
    expect(pickFields(39, false)).toEqual({ firefox: 0, profile: 19, kind: 12, state: 8 })
    expect(pickFields(30, false)).toEqual({ firefox: 0, profile: 10, kind: 12, state: 8 })
  })

  test('never takes the profile below its minimum', () => {
    expect(pickFields(0, true).profile).toBe(6)
  })
})

describe('cutRows', () => {
  const row = (key: string, height?: number) => ({ type: 'Box', props: { key, ...(height === undefined ? {} : { height }) }, children: [] }) as never
  const keys = (rows: readonly unknown[]) => rows.map(r => (r as { props: { key: string } }).props.key)

  test('keeps rows that fit', () => {
    const rows = [row('a'), row('block-rule-1'), row('b')]
    expect(keys(cutRows(rows, 3))).toEqual(['a', 'block-rule-1', 'b'])
  })

  test('cuts from the bottom and never ends on a rule', () => {
    const rows = [row('a'), row('block-rule-1'), row('b'), row('git-rule'), row('c')]
    expect(keys(cutRows(rows, 4))).toEqual(['a', 'block-rule-1', 'b'])
    expect(keys(cutRows(rows, 2))).toEqual(['a'])
  })

  test('counts a half line rule at its height', () => {
    const rows = [row('a'), row('usage-rule', 0.5), row('b')]
    expect(keys(cutRows(rows, 2.5))).toEqual(['a', 'usage-rule', 'b'])
    expect(keys(cutRows(rows, 2))).toEqual(['a'])
  })

  test('leaves nothing when no row fits', () => {
    expect(cutRows([row('a')], 0)).toEqual([])
  })
})
