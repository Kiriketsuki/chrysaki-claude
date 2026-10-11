import { describe, expect, test } from 'claude-code/testing'

import { MAX_ROWS, desktopTier } from '../hooks/desktop-band'
import { contrast } from '../hooks/gradient'
import { DESK_ELEVATED, DESK_RAISED } from '../hooks/ground'
import { CORE } from '../hooks/palette'
import { KEYCAP_CELLS } from '../hooks/prims-desktop'
import { AMBER_GROUND as AMBER, MIN_RULE, balanceRows, splitRun } from '../hooks/header'
import { desktopPlanOpts, ledgerRules, planLedger } from '../hooks/ledger'
import { PILL_LINES } from '../hooks/svg'
import { PAIR_RULE_LINES, pairRules, planStack, stackRules } from '../hooks/stack'
import { TWO_UP_GEOMS, TWO_UP_MIN, pairWidth, planTwoUp, twoUpRules } from '../hooks/two-up'
import { MEASURE, answerMeasure, props } from './fixtures/band'
import { DESKTOP, TERMINAL, bandData, drawTree } from './fixtures/draw'
import type { Node } from './fixtures/draw'

// The desktop band never folds. These tests walk the trees it draws at six
// widths and six kinds of data, and hold each tree to what the desktop
// renderer accepts: a Svg only inside a Box of fixed cell width, and a tree
// under the node, depth and size budgets.

const ROW = 20
const WIDTHS = [60, 80, 90, 100, 130, 160] as const
// The widths where the tiers change, and one wide band.
const TIER_WIDTHS = [119, 120, 205, 206, 238] as const
const PRIVATE_USE = /[-]/u
const MENU = { accountMenu: { mode: 'pick' as const, draftEmail: '', draftProfile: '' } }

type Over = Parameters<typeof bandData>[0]

const VARIANTS: Record<string, Over> = {
  default: {},
  menu: MENU,
  animated: { barStyle: 'smooth', isRuleAnimated: true },
  nogit: { git: null, remote: null },
  nousage: { usage: null, cache: null, cacheView: null },
  resume: { usage: { ctxWindow: 200000 }, resumePath: '/home/k/.claude/handoffs/2026-10-05-band.md' },
}

const data = (columns: number, over: Over = {}) => bandData({ surface: 'desktop', columns, emblem: 'none', rowPx: ROW, ...over })
const desktop = (columns: number, over: Over = {}) => drawTree(DESKTOP, data(columns, over))
const tier = (columns: number) => desktopTier(columns, data(columns))

function all(n: Node, test: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (test(n)) out.push(n)
  for (const c of n.children) if (typeof c !== 'string') all(c, test, out)
  return out
}

const byKey = (n: Node, key: string): Node | undefined => all(n, x => x.props.key === key)[0]
const svgs = (n: Node): Node[] => all(n, x => x.type === 'Svg')
const alts = (n: Node): string[] => svgs(n).map(s => String(s.props.alt))

function text(n: Node): string {
  return n.children.map(c => (typeof c === 'string' ? c : text(c))).join('')
}

function parentOf(root: Node, target: Node): Node | undefined {
  return all(root, n => n.children.includes(target))[0]
}

function depth(n: Node): number {
  return 1 + Math.max(0, ...n.children.map(c => (typeof c === 'string' ? 0 : depth(c))))
}

// The lines of a band column: each child takes its own height, or one line.
// The open account panel is one Box of rows, and each row takes a line.
function lines(root: Node): number {
  return root.children.reduce((sum, c) => {
    if (typeof c === 'string') return sum
    if (typeof c.props.height === 'number') return sum + c.props.height
    return sum + (/^account-(pick|add-panel)$/.test(String(c.props.key)) ? c.children.length : 1)
  }, 0)
}

// The cells a node takes in a row. A Box counts its width or minimum width, an
// absolute Box none, and the rest the sum of its children.
function span(n: Node): number {
  if (n.type === 'Button') return 1
  if (n.props.position === 'absolute') return 0
  if (typeof n.props.width === 'number') return n.props.width
  if (typeof n.props.minWidth === 'number') return n.props.minWidth
  return n.children.reduce((sum, c) => sum + (typeof c === 'string' ? 0 : span(c)), 0)
}

const headerRows = (root: Node): Node[] => all(root, n => typeof n.props.key === 'string' && /^header(-right-\d)?$/.test(String(n.props.key)))

const trees = (): { label: string; columns: number; over: Over; root: Node }[] =>
  WIDTHS.flatMap(columns => Object.entries(VARIANTS).map(([name, over]) => ({ label: `${name} at ${columns}`, columns, over, root: desktop(columns, over) })))

describe('the desktop band never folds', () => {
  test('draws no compact line at any width', () => {
    for (const { label, root } of trees()) {
      const lines = all(root, n => n.type === 'Text').map(text)
      expect(lines.filter(s => /^(5h|7d|ctx) \d+%/.test(s)), label).toEqual([])
      expect(lines.filter(s => s === '  ◆  '), label).toEqual([])
    }
  })

  test('draws every block of the terminal band', () => {
    for (const { label, columns, over, root } of trees()) {
      // A folder with no repository has no diff row on the desktop. An open
      // account menu cuts the ledger from the bottom, and git goes first.
      const hasGit = over?.git !== null && over?.accountMenu === undefined
      for (const key of ['header', 'brand', 'cost', 'cell-5h', 'cell-7d', 'cell-ctx', 'cell-cache', ...(hasGit ? ['git-a', 'git-b'] : [])]) {
        expect(byKey(root, key), `${label} ${key}`).toBeDefined()
      }
      const a = alts(root)
      for (const badge of ['5h', '7d', 'ctx-detail', 'cache', ...(over?.accountMenu === undefined ? ['git-pane'] : []), ...(hasGit ? ['diff'] : [])]) expect(a, `${label} ${badge}`).toContain(`${badge} badge`)
      if (over?.git === null) expect(a, label).not.toContain('diff badge')
      expect(a, label).toContain('header rule')
      expect(a, label).toContain('edge')
      expect(a, label).toContain('row rule')
      for (const key of ['cell-5h', 'cell-7d', 'cell-ctx', 'cell-cache']) {
        expect(alts(byKey(root, key) as Node).filter(s => /^bar/.test(s)).length, `${label} ${key} bar`).toBeGreaterThan(0)
      }
      // A spark needs a reading and a geometry that keeps one. The desktop
      // never takes the short geometry that drops it from the ledger.
      const geom = tier(columns) === 'stack' ? planStack(columns) : tier(columns) === 'two-up' ? planTwoUp(columns) : planLedger(columns, desktopPlanOpts(data(columns)))
      const hasReading = over?.usage === undefined
      // The stack and the two-up ledger drop the spark when the band is tight.
      if (tier(columns) === 'inline') expect(geom.spark, label).toBeGreaterThan(0)
      if (hasReading && geom.spark > 0) for (const spark of ['spark-5h cells', 'spark-7d cells', 'spark-ctx cells']) expect(a, `${label} ${spark}`).toContain(spark)
      const dividers = a.filter(s => s === 'column divider').length
      expect(dividers, label).toBe(tier(columns) === 'inline' ? 4 : tier(columns) === 'two-up' ? 2 : 0)
    }
  })

  test('picks the tier from the width', () => {
    expect([60, 70, 79].map(tier)).toEqual(['stack', 'stack', 'stack'])
    expect([80, 90, 100, 117, 119, 120, 130, 160, 205].map(tier)).toEqual(Array(9).fill('two-up'))
    expect([206, 238].map(tier)).toEqual(['inline', 'inline'])
    for (const columns of [60, 79]) {
      const root = desktop(columns)
      expect(byKey(root, 'block-rule-1')).toBeDefined()
      expect(byKey(root, 'block-rule-2')).toBeDefined()
      expect(byKey(root, 'row-rule-1')).toBeUndefined()
    }
    for (const columns of [80, 90, 100, 117, 130]) {
      expect(byKey(desktop(columns), 'row-rule-1'), `at ${columns}`).toBeDefined()
      expect(byKey(desktop(columns), 'block-rule-1'), `at ${columns}`).toBeUndefined()
    }
    expect(byKey(desktop(238), 'row-0')).toBeDefined()
    expect(byKey(desktop(238), 'row-rule-1')).toBeDefined()
    expect(byKey(desktop(238), 'row-2')).toBeUndefined()
  })

  test('keeps the full geometry at every width the desktop draws side by side', () => {
    // Two columns need the full bar and the spark. Three also need git to hold
    // its widest row on one line, where the desktop would wrap it.
    for (const columns of [120, 130, 160, 205, 206, 238]) {
      const plan = planLedger(columns, desktopPlanOpts(data(columns)))
      expect([plan.bar, plan.spark]).toEqual([16, 8])
    }
    expect(byKey(desktop(205), 'git-a')?.props.width).toBe(204)
    expect(byKey(desktop(206), 'git-a')?.props.width).toBe(81)
  })

  test('sets the cell widths of each tier', () => {
    const widths = (columns: number) => ['cell-5h', 'cell-ctx', 'git-a'].map(k => byKey(desktop(columns), k)?.props.width)
    expect(widths(60)).toEqual([42, 59, 59])
    expect(widths(79)).toEqual([50, 67, 78])
    expect(widths(80)).toEqual([28, 47, 79])
    expect(widths(90)).toEqual([33, 52, 89])
    expect(widths(100)).toEqual([38, 57, 99])
    expect(widths(117)).toEqual([46, 65, 116])
    expect(widths(120)).toEqual([47, 67, 119])
    expect(widths(130)).toEqual([47, 67, 129])
    expect(widths(160)).toEqual([47, 67, 159])
    expect(widths(238)).toEqual([47, 67, 113])
  })

  test('plans the stack geometry and its rules', () => {
    const pick = (inner: number) => {
      const { bar, spark } = planStack(inner)
      return { bar, spark }
    }
    expect(pick(60)).toEqual({ bar: 8, spark: 8 })
    expect(pick(63)).toEqual({ bar: 8, spark: 8 })
    expect(pick(64)).toEqual({ bar: 12, spark: 8 })
    expect(pick(67)).toEqual({ bar: 12, spark: 8 })
    expect(pick(68)).toEqual({ bar: 16, spark: 8 })
    expect(pick(59)).toEqual({ bar: 16, spark: 0 })
    expect(pick(40)).toEqual({ bar: 8, spark: 0 })
    expect(stackRules(80).map(r => [r.key, r.width, r.crosses])).toEqual([['block-rule-1', 79, []], ['block-rule-2', 79, []]])
  })

  test('starts the bar, the figure and the git items of every stacked row in the same column', () => {
    // The cells before a node, counted in cells, with a Text as zero.
    const before = (n: Node, target: Node): number | undefined => {
      let sum = 0
      for (const c of n.children) {
        if (typeof c === 'string') continue
        if (c === target) return sum
        const inner = before(c, target)
        if (inner !== undefined) return sum + inner
        sum += span(c)
      }
      return undefined
    }
    for (const columns of [60, 79]) {
      const root = desktop(columns)
      const bars = ['cell-5h', 'cell-7d', 'cell-ctx', 'cell-cache'].map(key => {
        const cell = byKey(root, key) as Node
        const bar = all(cell, n => n.type === 'Svg' && /^bar/.test(String(n.props.alt)))[0] as Node
        return before(cell, parentOf(cell, bar) as Node)
      })
      expect(new Set(bars).size, `bars at ${columns}`).toBe(1)
      const git = byKey(root, 'git-a') as Node
      expect(before(git, byKey(git, 'branch') as Node), `git at ${columns}`).toBe(bars[0])
      const diff = byKey(root, 'git-b') as Node
      const first = all(diff, n => n.type === 'Box' && n.props.flexShrink === 0 && n.props.width === undefined)[0] as Node
      expect(before(diff, first), `diff at ${columns}`).toBe(bars[0])
    }
  })

  test('leaves the counts of zero out of the stacked diff row, so the tail keeps its row', () => {
    for (const columns of [60, 79]) {
      const root = desktop(columns)
      expect(byKey(root, 'git-c'), `at ${columns}`).toBeUndefined()
      const row = text(byKey(root, 'git-b') as Node)
      expect(row, `at ${columns}`).toContain('2 unstaged')
      expect(row, `at ${columns}`).not.toContain('0 staged')
      expect(row, `at ${columns}`).not.toContain('0 untracked')
      expect(row, `at ${columns}`).toContain('PR #35')
    }
    // The two-up tier leaves them out too. The inline tier keeps every count, as the terminal does.
    expect(text(byKey(desktop(130), 'git-b') as Node)).not.toContain('0 staged')
    expect(text(byKey(desktop(238), 'git-b') as Node)).toContain('0 staged')
  })

  test('moves the pull request and the issues to a third git row when the diff row still runs over', () => {
    const git = data(60).git as NonNullable<ReturnType<typeof data>['git']>
    const busy = { git: { ...git, staged: 120, unstaged: 340, untracked: 560, insertions: 1200, deletions: 340 } }
    const root = desktop(60, busy)
    expect(byKey(root, 'git-c')).toBeDefined()
    expect(all(byKey(root, 'git-c') as Node, n => n.type === 'Text' && /PR #35/.test(text(n))).length).toBe(1)
    expect(all(byKey(root, 'git-b') as Node, n => n.type === 'Text' && /PR #35/.test(text(n)))).toEqual([])
    // A tree with no pull request and no issues has nothing to move.
    expect(byKey(desktop(60, { ...busy, remote: null }), 'git-c')).toBeUndefined()
    expect(lines(root)).toBeLessThanOrEqual(MAX_ROWS)
  })

  test('draws no diff row for a folder with no repository, in every tier', () => {
    for (const columns of [60, 100, 130, 160, 238]) {
      const root = desktop(columns, VARIANTS.nogit)
      expect(byKey(root, 'git-b'), `at ${columns}`).toBeUndefined()
      expect(byKey(root, 'row-git-b'), `at ${columns}`).toBeUndefined()
      expect(byKey(root, 'row-3'), `at ${columns}`).toBeUndefined()
      expect(byKey(root, 'row-rule-3'), `at ${columns}`).toBeUndefined()
      expect(byKey(root, 'git-rule'), `at ${columns}`).toBeUndefined()
      expect(alts(root), `at ${columns}`).not.toContain('diff badge')
      expect(byKey(root, 'git-a'), `at ${columns}`).toBeDefined()
    }
    // The terminal keeps the bare badge row.
    expect(byKey(drawTree(TERMINAL, bandData({ columns: 160, emblem: 'none', git: null, remote: null })), 'git-b')).toBeDefined()
    // The column line ends at the first rule once the diff row is gone.
    const opts = desktopPlanOpts(data(238))
    expect(ledgerRules(238, opts)[0]?.crosses.map(c => c.glyph)).toEqual(['┼', '┼'])
    expect(ledgerRules(238, opts, false)[0]?.crosses.map(c => c.glyph)).toEqual(['┼', '┴'])
  })

  test('draws no private-use glyph, no Raster and no Image', () => {
    for (const { label, root } of trees()) {
      const strings = all(root, n => n.type === 'Text' || n.type === 'Button').flatMap(n => [text(n), String(n.props.label ?? '')])
      expect(strings.filter(s => PRIVATE_USE.test(s)), label).toEqual([])
      expect(svgs(root).filter(s => PRIVATE_USE.test(String(s.props.source))), label).toEqual([])
      expect(all(root, n => n.type === 'Raster' || n.type === 'Image'), label).toEqual([])
    }
  })

  test('holds every drawing to the rules of the desktop renderer', () => {
    for (const { label, root } of trees()) {
      const list = svgs(root)
      expect(list.length, label).toBeGreaterThan(10)
      for (const svg of list) {
        // S2: the props are exactly source, alt and height, and no children.
        expect(Object.keys(svg.props).sort(), label).toEqual(['alt', 'height', 'source'])
        expect(svg.children, label).toEqual([])
        expect(String(svg.props.alt).trim().length, label).toBeGreaterThan(0)
        // S3: the height is the row height option.
        expect(svg.props.height, label).toBe(ROW)
        // S4: the markup is wider than any band, with a viewBox.
        const source = String(svg.props.source)
        expect(source.length, label).toBeLessThanOrEqual(131072)
        expect(source, label).toContain('width="4096"')
        expect(source, label).toContain(`height="${ROW}"`)
        // S1: the only in-flow child of a Box of fixed cell width.
        const box = parentOf(root, svg) as Node
        expect(box.type, label).toBe('Box')
        expect(typeof box.props.width, label).toBe('number')
        expect(box.props.width as number, label).toBeGreaterThanOrEqual(1)
        expect(box.props.height, label).toBe(1)
        expect(box.props.overflow, label).toBe('hidden')
        const isHeaderRule = svg.props.alt === 'header rule'
        expect(box.props.flexShrink, label).toBe(isHeaderRule ? 1 : 0)
        if (isHeaderRule) expect(box.props.minWidth, label).toBe(0)
        const inFlow = box.children.filter((c): c is Node => typeof c !== 'string' && c.props.position !== 'absolute')
        expect(inFlow, label).toEqual([svg])
        // S5: the viewBox width is the Box width in cells.
        const viewBox = /viewBox="0 (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(source)
        expect(Number(viewBox?.[2]), `${label} ${String(svg.props.alt)}`).toBe(box.props.width)
      }
    }
  })

  test('keeps every tree inside the renderer budgets', () => {
    for (const { label, root } of trees()) {
      expect(all(root, () => true).length, label).toBeLessThan(2000)
      expect(depth(root), label).toBeLessThan(32)
      expect(JSON.stringify(root).length, label).toBeLessThan(262144)
    }
  })

  test('keeps the lines to the band limit, with no margin on top', () => {
    for (const columns of WIDTHS) {
      for (const [name, over] of Object.entries(VARIANTS)) {
        const root = desktop(columns, over)
        expect(root.props.marginTop, `${name} at ${columns}`).toBeUndefined()
        expect(lines(root), `${name} at ${columns}`).toBeLessThanOrEqual(MAX_ROWS)
      }
    }
  })

  test('spans every header row across the band, in two rows at most', () => {
    for (const { label, columns, root } of trees()) {
      const rows = headerRows(root)
      expect(rows.length, label).toBeGreaterThan(0)
      expect(rows.length, label).toBeLessThanOrEqual(2)
      for (const row of rows) expect(span(row), `${label} ${String(row.props.key)}`).toBe(columns)
    }
    // The header takes two rows at most, so the ledger keeps its lines. At 60
    // the right run drops the clock, the quiet band item and the account.
    const narrow = desktop(60)
    expect(headerRows(narrow).map(r => r.props.key)).toEqual(['header', 'header-right-0'])
    const labels = all(narrow, n => n.type === 'Button').map(b => String(b.props.label))
    expect(labels.some(l => l.includes('major'))).toBe(true)
    expect(labels.some(l => l.includes('kiriketsuki@gmail.com'))).toBe(false)
    const cwd = all(headerRows(narrow)[0] as Node, n => n.type === 'Text').map(text).join('')
    expect(cwd).toContain('chrysaki')
    // A header too wide for one row stays at the narrow step: no version.
    expect(cwd).not.toContain('v2.1.295')
    expect(all(narrow, n => n.type === 'Text').map(text).join('')).not.toContain('◷')
    // At 100 no item drops: the narrow right run fits its row. The account
    // shows its name before the @, and the clock moves to the cost card.
    const roomy = desktop(100)
    expect(headerRows(roomy).map(r => r.props.key)).toEqual(['header', 'header-right-0'])
    expect(all(roomy, n => n.type === 'Button').map(b => String(b.props.label))).toContain('kiriketsuki')
    expect(all(roomy, n => n.type === 'Text').map(text).join('')).not.toContain('◷')
    expect(all(roomy, n => n.type === 'Text').map(text).join('')).toMatch(/this session · \d+h \d+m/)
    expect(headerRows(desktop(160)).map(r => r.props.key)).toEqual(['header'])
  })

  test('draws no drawer chevron and gives the header row no cell for it', () => {
    for (const { label, columns, root } of trees()) {
      expect(all(root, n => n.type === 'Button' && n.props.key === 'hint-toggle').length, label).toBe(0)
      for (const row of headerRows(root)) expect(span(row), `${label} ${String(row.props.key)}`).toBe(columns)
    }
  })

  test('parts the header from the ledger with an empty gap whenever the band has the lines', () => {
    for (const columns of [...WIDTHS, ...TIER_WIDTHS]) {
      for (const [name, over] of Object.entries(VARIANTS)) {
        const root = desktop(columns, over)
        const used = lines(root)
        expect(used, `${name} at ${columns}`).toBeLessThanOrEqual(MAX_ROWS)
        // The gap is there, or the band is full without it. The open menu holds the gap.
        const isGap = byKey(root, 'drawer') !== undefined || used > MAX_ROWS - 0.5 || over?.accountMenu !== undefined
        expect(isGap, `${name} at ${columns}`).toBe(true)
      }
    }
    expect(byKey(desktop(130), 'drawer')).toBeDefined()
    expect(byKey(desktop(80), 'drawer')).toBeDefined()
    expect(byKey(desktop(100), 'drawer')).toBeDefined()
  })

  test('keeps every item of a git row on one line, so a short cell clips and never wraps', () => {
    for (const { label, root } of trees()) {
      for (const key of ['git-a', 'git-b', 'git-c']) {
        const cell = byKey(root, key)
        if (cell === undefined) continue
        for (const t of all(cell, n => n.type === 'Text')) {
          // Some Box above the Text, below the cell, does not shrink.
          let up = parentOf(root, t)
          let isHeld = false
          while (up !== undefined && up !== cell) {
            if (up.props.flexShrink === 0) isHeld = true
            up = parentOf(root, up)
          }
          expect(isHeld, `${label} ${key} ${text(t)}`).toBe(true)
        }
      }
    }
  })

  test('insets every pill and every edge, so stacked pills leave a gap', () => {
    for (const { label, root } of trees()) {
      const grounds = headerRows(root).flatMap(r => all(r, n => n.type === 'Box' && typeof n.props.backgroundColor === 'string' && n.props.paddingX === 1 && n.props.position !== 'absolute'))
      expect(grounds.length, label).toBeGreaterThan(3)
      for (const ground of grounds) {
        expect(ground.props.height, label).toBe(PILL_LINES)
        const outer = parentOf(root, ground) as Node
        expect(outer.props.height, label).toBe(1)
        expect(outer.props.alignItems, label).toBe('center')
      }
      for (const svg of svgs(root).filter(s => /^(edge|.* badge)$/.test(String(s.props.alt)))) {
        const box = parentOf(root, svg) as Node
        expect(box.props.backgroundColor, `${label} ${String(svg.props.alt)}`).toBeUndefined()
        expect(String(svg.props.source), label).toContain(svg.props.alt === 'edge' ? 'viewBox="0 -0.15 ' : 'viewBox="0 -0.26 ')
      }
    }
  })

  test('draws one rule on the right rows of a split header, and a plain gap under it', () => {
    for (const columns of [60, 80, 100]) {
      const root = desktop(columns)
      const rows = headerRows(root).filter(r => String(r.props.key).startsWith('header-right-'))
      expect(rows.length, `at ${columns}`).toBeGreaterThan(0)
      rows.forEach((row, j) => {
        const rules = all(row, n => n.type === 'Svg' && n.props.alt === 'header rule').length
        expect(rules, `${columns} ${String(row.props.key)}`).toBe(j === 0 ? 1 : 0)
        expect(span(row), `${columns} ${String(row.props.key)}`).toBe(columns)
      })
    }
  })

  test('draws every Button with a string label and no children', () => {
    for (const { label, root } of trees()) {
      const buttons = all(root, n => n.type === 'Button')
      expect(buttons.length, label).toBeGreaterThan(0)
      expect(buttons.filter(b => typeof b.props.label !== 'string' || b.children.length > 0), label).toEqual([])
    }
  })
})

describe('the desktop header on the lighter card', () => {
  // The card of the desktop app, from the pre-v1 screenshot.
  const CARD = '#212121'

  test('lifts the Raised and Elevated grounds to 1.3:1 or more from the card and from each other', () => {
    expect(contrast(DESK_RAISED, CARD)).toBeGreaterThanOrEqual(1.3)
    expect(contrast(DESK_ELEVATED, CARD)).toBeGreaterThanOrEqual(1.3)
    expect(contrast(DESK_RAISED, DESK_ELEVATED)).toBeGreaterThanOrEqual(1.3)
    expect(contrast(DESK_RAISED, CORE.abyss)).toBeGreaterThanOrEqual(1.3)
    expect(contrast(DESK_ELEVATED, CORE.abyss)).toBeGreaterThanOrEqual(1.3)
  })

  test('grounds every header pill but Abyss and the alert fills 1.3:1 or more from the card', () => {
    for (const { label, root } of trees()) {
      const grounds = headerRows(root).flatMap(r => all(r, n => n.type === 'Box' && typeof n.props.backgroundColor === 'string' && n.props.paddingX === 1 && n.props.position !== 'absolute'))
      const light = grounds.map(g => String(g.props.backgroundColor)).filter(c => c !== CORE.abyss && c !== CORE.error && c !== AMBER)
      expect(light.length, label).toBeGreaterThan(0)
      for (const c of light) expect(contrast(c, CARD), `${label} ${c}`).toBeGreaterThanOrEqual(1.3)
    }
  })

  test('keeps the left run and a rule on the first row, and the right run on its own row', () => {
    for (const columns of [80, 100]) {
      const rows = headerRows(desktop(columns))
      expect(rows.length, `at ${columns}`).toBe(2)
      const first = rows[0] as Node
      // The first row holds no Button: no chevron and no pill of the right run.
      expect(all(first, n => n.type === 'Button').map(b => b.props.key), `at ${columns}`).toEqual([])
      expect(all(rows[1] as Node, n => n.type === 'Button' && n.props.key === 'account').length, `at ${columns}`).toBe(1)
    }
  })

  test('sets the right run of a split header against the left edge, under the left run', () => {
    for (const columns of [80, 100]) {
      const second = headerRows(desktop(columns))[1] as Node
      // The pills come first and the rule, if any, closes the row.
      const first = second.children[0] as Node
      expect(all(first, n => n.type === 'Box' && n.props.paddingX === 1).length, `at ${columns}`).toBeGreaterThan(0)
    }
  })

  test('draws the header on one row when the capped folder lets every item fit', () => {
    const over = { identity: { model: 'claude-opus-5-5', version: '2.1.295', cwd: 'C:\\Users\\Kidriel\\dev\\obKidian', email: 'kiriketsuki@gmail.com', isWorkAccount: false }, home: 'C:\\Users\\Kidriel', outage: null, inbox: 0, band: [] }
    const wide = headerRows(desktop(120, over))
    expect(wide.map(r => r.props.key)).toEqual(['header'])
    expect(text(wide[0] as Node)).toContain('dev/obKidian')
    expect(span(wide[0] as Node)).toBe(120)
    // Just under the width of the whole header, the path loses its left end
    // and the base name stays whole. Narrower still, the header splits.
    const capped = [...Array(30).keys()].map(n => 120 - n).filter(w => headerRows(desktop(w, over)).length === 1 && text(headerRows(desktop(w, over))[0] as Node).includes('…'))
    expect(capped.length).toBeGreaterThan(0)
    for (const w of capped) {
      const row = headerRows(desktop(w, over))[0] as Node
      expect(text(row), `at ${w}`).toContain('obKidian')
      expect(span(row), `at ${w}`).toBe(w)
    }
    expect(headerRows(desktop(70, over)).length).toBe(2)
  })

  test('hides the version and caps the folder before the header splits', () => {
    const win = { identity: { model: 'claude-opus-5-5', version: '2.1.295', cwd: 'C:\\Users\\Kidriel\\dev\\obKidian', email: 'kiriketsuki@gmail.com', isWorkAccount: false }, home: 'C:\\Users\\Kidriel', band: [], inbox: 9 }
    const oneRow = (w: number) => headerRows(desktop(w, win)).length === 1
    const hasVersion = (w: number) => text(headerRows(desktop(w, win))[0] as Node).includes('v2.1.295')
    // Some width keeps one row only because the version left.
    const saved = [...Array(60).keys()].map(n => 80 + n).filter(w => oneRow(w) && !hasVersion(w))
    expect(saved.length).toBeGreaterThan(0)
    for (const w of saved) {
      const row = headerRows(desktop(w, win))[0] as Node
      expect(text(row), `at ${w}`).toContain('obKidian')
      expect(span(row), `at ${w}`).toBe(w)
    }
    // With room for every item the version stays.
    expect(hasVersion(160)).toBe(true)
  })

  test('shortens the email and hides the clock to keep one row on a narrow pane', () => {
    const win = { identity: { model: 'claude-opus-5-5', version: '2.1.295', cwd: 'C:\\Users\\Kidriel\\dev\\obKidian', email: 'kiriketsuki@gmail.com', isWorkAccount: false }, home: 'C:\\Users\\Kidriel', band: [], inbox: 9 }
    for (const columns of [95, 100]) {
      const rows = headerRows(desktop(columns, win))
      expect(rows.map(r => r.props.key), `at ${columns}`).toEqual(['header'])
      const row = rows[0] as Node
      // The desktop draws the account as a Button, so its label is the pill.
      const account = all(row, n => n.type === 'Button' && n.props.key === 'account')[0] as Node
      expect(account?.props.label, `at ${columns}`).toBe('kiriketsuki')
      expect(text(row), `at ${columns}`).not.toContain('◷')
      expect(span(row), `at ${columns}`).toBe(columns)
      // The clock moves to the cost card, so it is still one hover away.
      expect(text(byKey(row, 'cost') as Node), `at ${columns}`).toMatch(/this session · \d+h \d+m/)
    }
    // A wide pane keeps the whole address and the clock.
    const wide = headerRows(desktop(160, win))[0] as Node
    expect(all(wide, n => n.type === 'Button' && n.props.key === 'account')[0]?.props.label).toBe('kiriketsuki@gmail.com')
    expect(text(wide)).toContain('◷')
  })

  test('draws no rule stub: a rule keeps at least MIN_RULE plus four cells, else the row holds a gap', () => {
    for (const columns of [60, 80, 90, 100, 130]) {
      for (const row of headerRows(desktop(columns))) {
        for (const rule of all(row, n => n.type === 'Svg' && n.props.alt === 'header rule')) {
          const box = (all(row, n => n.children.includes(rule))[0] as Node).props.width as number
          expect(box - 2, `${columns} ${String(row.props.key)}`).toBeGreaterThanOrEqual(MIN_RULE + 4)
        }
      }
    }
    // At 60 the left run leaves eleven cells, so the first row draws its rule.
    expect(alts(headerRows(desktop(60))[0] as Node)).toContain('header rule')
  })

  test('letters every header pill at 4.5:1 on its own ground, with the ground on the pill Box alone', () => {
    for (const { label, root } of trees()) {
      const grounds = headerRows(root).flatMap(r => all(r, n => n.type === 'Box' && typeof n.props.backgroundColor === 'string' && n.props.paddingX === 1 && n.props.position !== 'absolute'))
      expect(grounds.length, label).toBeGreaterThan(3)
      for (const ground of grounds) {
        // The Box clips what the font paints beyond the pill.
        expect(ground.props.overflow, label).toBe('hidden')
        for (const t of all(ground, n => n.type === 'Text')) {
          expect(t.props.backgroundColor, `${label} ${text(t)}`).toBeUndefined()
          if (typeof t.props.color === 'string' && t.props.color.startsWith('#')) {
            expect(contrast(t.props.color, String(ground.props.backgroundColor)), `${label} ${text(t)}`).toBeGreaterThanOrEqual(4.5)
          }
        }
      }
    }
  })
})

describe('the stacked ledger rhythm', () => {
  test('parts the two rows of every block with a half-line rule, so each pair keeps one rhythm', () => {
    for (const columns of [60, 79]) {
      const root = desktop(columns)
      const keys = root.children.map(c => (typeof c === 'string' ? c : c.props.key))
      for (const [rule, above, below] of [['usage-rule', 'row-5h', 'row-7d'], ['context-rule', 'row-ctx', 'row-cache'], ['git-rule', 'row-git-a', 'row-git-b']]) {
        expect(keys.indexOf(rule as string), `${rule} at ${columns}`).toBe(keys.indexOf(above as string) + 1)
        expect(keys.indexOf(below as string), `${below} at ${columns}`).toBe(keys.indexOf(rule as string) + 1)
        expect(byKey(root, rule as string)?.props.height, `${rule} at ${columns}`).toBe(PAIR_RULE_LINES)
        expect(alts(byKey(root, rule as string) as Node), `${rule} at ${columns}`).toEqual(['row rule'])
      }
      expect(lines(root), `at ${columns}`).toBeLessThanOrEqual(MAX_ROWS)
    }
    expect(pairRules(80).map(r => [r.key, r.width, r.crosses])).toEqual([['usage-rule', 79, []], ['context-rule', 79, []], ['git-rule', 79, []]])
  })

  test('draws the pair rules as a set or not at all, and never one alone', () => {
    for (const columns of [60, 79]) {
      for (const [name, over] of Object.entries(VARIANTS)) {
        const root = desktop(columns, over)
        const found = ['usage-rule', 'context-rule', 'git-rule'].filter(k => byKey(root, k) !== undefined)
        const whole = over?.git === null ? 2 : 3
        expect([0, whole], `${name} at ${columns}`).toContain(found.length)
      }
    }
    // An open account menu takes the lines, so the rules wait.
    expect(byKey(desktop(79, MENU), 'usage-rule')).toBeUndefined()
    // A third git row takes the line of the rules too.
    const git = data(60).git as NonNullable<ReturnType<typeof data>['git']>
    const busy = desktop(60, { git: { ...git, staged: 120, unstaged: 340, untracked: 560, insertions: 1200, deletions: 340 } })
    expect(byKey(busy, 'git-c')).toBeDefined()
    expect(byKey(busy, 'usage-rule')).toBeUndefined()
  })

  test('spends the gap under the header after the pair rules, a half line when a line does not fit', () => {
    expect(byKey(desktop(79), 'drawer')?.props.height).toBe(0.5)
    expect(byKey(desktop(206), 'drawer')?.props.height).toBe(1)
    expect(byKey(desktop(130), 'drawer')?.props.height).toBe(0.5)
    expect(lines(desktop(79))).toBe(MAX_ROWS)
  })

  test('insets the ledger gems more than the header pills, so stacked gems part', () => {
    for (const columns of [60, 80, 100]) {
      const gems = svgs(desktop(columns)).filter(s => / badge$/.test(String(s.props.alt)))
      expect(gems.length).toBe(6)
      for (const gem of gems) expect(String(gem.props.source)).toContain('viewBox="0 -0.26 ')
    }
  })

  test('shifts a hotkey badge label left of the keycap, and leaves a plain badge alone', () => {
    for (const { label, root } of trees()) {
      const labelBox = (alt: string) => {
        const gem = svgs(root).find(s => s.props.alt === alt) as Node
        const box = parentOf(root, gem) as Node
        return box.children.find((c): c is Node => typeof c !== 'string' && c.props.position === 'absolute') as Node
      }
      // An open account menu cuts the git rows off the bottom.
      if (svgs(root).some(s => s.props.alt === 'git-pane badge')) expect(labelBox('git-pane badge').props.paddingRight, label).toBe(KEYCAP_CELLS)
      expect(labelBox('ctx-detail badge').props.paddingRight, label).toBeUndefined()
      if (svgs(root).some(s => s.props.alt === 'diff badge')) expect(labelBox('diff badge').props.paddingRight, label).toBeUndefined()
    }
  })
})

describe('the desktop two-up ledger', () => {
  const keys = (root: Node) => root.children.map(c => (typeof c === 'string' ? c : String(c.props.key)))

  test('picks the bar and the spark from the width', () => {
    const pick = (inner: number) => {
      const { bar, spark } = planTwoUp(inner)
      return { bar, spark }
    }
    expect(pick(80)).toEqual({ bar: 7, spark: 0 })
    expect(pick(90)).toEqual({ bar: 7, spark: 4 })
    expect(pick(100)).toEqual({ bar: 8, spark: 8 })
    expect(pick(117)).toEqual({ bar: 16, spark: 8 })
    expect(pick(120)).toEqual({ bar: 16, spark: 8 })
    expect(TWO_UP_MIN).toBe(80)
  })

  test('fits the band at every width from 80', () => {
    for (let columns = 238; columns >= TWO_UP_MIN; columns--) {
      expect(pairWidth(planTwoUp(columns)), `at ${columns}`).toBeLessThanOrEqual(columns - 1)
    }
    expect(TWO_UP_GEOMS.length).toBeGreaterThan(10)
  })

  test('draws four ledger rows: 5h with ctx, 7d with cache, then git and diff', () => {
    for (const columns of [80, 90, 100, 117]) {
      const root = desktop(columns)
      expect(keys(root).filter(k => /^row-\d$/.test(k)), `at ${columns}`).toEqual(['row-0', 'row-1', 'row-2', 'row-3'])
      const pair = (row: string) => alts(byKey(root, row) as Node).filter(a => / badge$/.test(a))
      expect(pair('row-0'), `at ${columns}`).toEqual(['5h badge', 'ctx-detail badge'])
      expect(pair('row-1'), `at ${columns}`).toEqual(['7d badge', 'cache badge'])
      expect(byKey(root, 'git-a')?.props.width, `at ${columns}`).toBe(columns - 1)
      expect(byKey(root, 'git-b')?.props.width, `at ${columns}`).toBe(columns - 1)
      expect(alts(root).filter(a => a === 'column divider').length, `at ${columns}`).toBe(2)
    }
  })

  test('keeps both columns on the same edges in the two rows', () => {
    for (const columns of [80, 90, 100, 117]) {
      const root = desktop(columns)
      const w = (k: string) => byKey(root, k)?.props.width
      expect(w('cell-5h'), `at ${columns}`).toBe(w('cell-7d'))
      expect(w('cell-ctx'), `at ${columns}`).toBe(w('cell-cache'))
      const geom = planTwoUp(columns)
      for (const k of ['cell-5h', 'cell-7d', 'cell-ctx', 'cell-cache']) {
        const bar = all(byKey(root, k) as Node, n => n.type === 'Box' && n.props.width === geom.bar && svgs(n).length === 1)
        expect(bar.length, `${k} at ${columns}`).toBeGreaterThan(0)
      }
    }
  })

  test('draws each rule at half a line, crossing the column line once and ending it with a tee', () => {
    for (const columns of [80, 90, 100, 117]) {
      const root = desktop(columns)
      for (const key of ['row-rule-1', 'row-rule-2', 'row-rule-3']) {
        const rule = byKey(root, key) as Node
        expect(rule.props.height, `${key} at ${columns}`).toBe(PAIR_RULE_LINES)
        expect(rule.props.alignItems, `${key} at ${columns}`).toBe('center')
        expect(alts(rule), `${key} at ${columns}`).toEqual(['row rule'])
      }
      const [first, second, third] = twoUpRules(columns)
      expect(first?.crosses.map(c => c.glyph)).toEqual(['┼'])
      expect(second?.crosses.map(c => c.glyph)).toEqual(['┴'])
      expect(third?.crosses).toEqual([])
      expect(first?.crosses[0]?.at).toBe(second?.crosses[0]?.at)
      expect(first?.width).toBe(columns - 1)
    }
  })

  test('draws no more than 8 lines at 90 columns with the rich fixture', () => {
    const root = desktop(90)
    expect(lines(root)).toBeLessThanOrEqual(8)
    expect(keys(root)).toEqual(['header', 'header-right-0', 'drawer', 'row-0', 'row-rule-1', 'row-1', 'row-rule-2', 'row-2', 'row-rule-3', 'row-3'])
    for (const columns of [80, 100, 117]) expect(lines(desktop(columns)), `at ${columns}`).toBeLessThanOrEqual(8)
  })

  test('stacks below 80 columns and sets two-up from 80', () => {
    expect(keys(desktop(79))).toContain('row-5h')
    expect(keys(desktop(80))).not.toContain('row-5h')
    expect(keys(desktop(80))).toContain('row-0')
  })
})

describe('splitRun', () => {
  const seg = (word: string, drop?: number) => ({ text: word, ...(drop === undefined ? {} : { drop }) })
  // A segment takes its text plus three cells.
  const ten = (c: string) => c.repeat(10)

  test('keeps one row when everything fits', () => {
    expect(splitRun([seg('aaa'), seg('bbb')], 100, 2).map(r => r.length)).toEqual([2])
  })

  test('cuts overflow into rows and keeps the order', () => {
    const rows = splitRun([seg(ten('a')), seg(ten('b')), seg(ten('c'))], 30, 2)
    expect(rows.map(r => r.map(s => s.text[0]))).toEqual([['a', 'b'], ['c']])
  })

  test('drops rank 2, then rank 4, when more rows than the limit are needed', () => {
    const run = [seg(ten('a')), seg(ten('b'), 2), seg(ten('c'), 4)]
    expect(splitRun(run, 14, 3).map(r => r.length)).toEqual([1, 1, 1])
    expect(splitRun(run, 14, 2).flat().map(s => s.text[0])).toEqual(['a', 'c'])
    expect(splitRun(run, 14, 1).flat().map(s => s.text[0])).toEqual(['a'])
  })

  test('gives a segment wider than the room a row of its own', () => {
    const rows = splitRun([seg('ab'), seg(ten('w')), seg('cd')], 10, 5)
    expect(rows.map(r => r.map(s => s.text))).toEqual([['ab'], [ten('w')], ['cd']])
  })
})

describe('balanceRows', () => {
  const seg = (word: string) => ({ text: word })
  const ten = (c: string) => c.repeat(10)

  test('moves segments from the first row to the second while the widths come closer', () => {
    const rows = balanceRows([[seg(ten('a')), seg(ten('b')), seg(ten('c'))], [seg(ten('d'))]], 60)
    expect(rows.map(r => r.map(s => s.text[0]))).toEqual([['a', 'b'], ['c', 'd']])
  })

  test('keeps the order, and keeps a row that is already even', () => {
    const rows = balanceRows([[seg(ten('a')), seg(ten('b'))], [seg(ten('c')), seg(ten('d'))]], 60)
    expect(rows.map(r => r.map(s => s.text[0]))).toEqual([['a', 'b'], ['c', 'd']])
  })

  test('leaves one row, and a second row that would overflow', () => {
    expect(balanceRows([[seg(ten('a'))]], 60).map(r => r.length)).toEqual([1])
    const rows = balanceRows([[seg(ten('a')), seg(ten('b')), seg(ten('c'))], [seg(ten('d'))]], 25)
    expect(rows.map(r => r.length)).toEqual([3, 1])
  })
})

describe('the desktop band in the engine at 80 columns', () => {
  test('draws the ledger cells and no compact line', async ($, on) => {
    answerMeasure(on)
    await $.session.measure(MEASURE)
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'AbovePrompt', props: props(80) })
    expect(await ui.find({ key: 'cell-5h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 80%/ })).toBeUndefined()
    expect(await ui.find({ key: 'hint-toggle' })).toBeUndefined()
    await ui.unmount()
  })
})
