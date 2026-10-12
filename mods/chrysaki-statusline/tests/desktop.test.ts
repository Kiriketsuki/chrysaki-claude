import { describe, expect, test } from 'claude-code/testing'

import { GEMS, gemColors } from '../hooks/gem'
import { DESK_ELEVATED, deskGround } from '../hooks/ground'
import { contextWidth, desktopPlanOpts, ledgerRules, planLedger, usageWidth } from '../hooks/ledger'
import { CORE, ROLE } from '../hooks/palette'
import { headerRulePaints, rulePaints } from '../hooks/rules'
import { CAP_POINTS, PILL_LINES, paintSvg } from '../hooks/svg'
import { MEASURE, answerMeasure, props } from './fixtures/band'
import { DESKTOP, MOBILE, TERMINAL, bandData, drawTree } from './fixtures/draw'
import type { Node } from './fixtures/draw'

const ROW = 26
const COLUMNS = [80, 130, 160, 238] as const
const PRIVATE_USE = /[\ue000-\uf8ff]/u
const RULE_GLYPHS = /[─━╸│┼┴⠀-⣿]/u

// The band as the desktop draws it, with no crest on either surface.
const desktop = (columns: number, over: Parameters<typeof bandData>[0] = {}) => drawTree(DESKTOP, bandData({ surface: 'desktop', columns, emblem: 'none', ...over }))
const terminal = (columns: number, over: Parameters<typeof bandData>[0] = {}) => drawTree(TERMINAL, bandData({ surface: 'terminal', columns, emblem: 'none', ...over }))

const deskOpts = (columns: number) => desktopPlanOpts(bandData({ surface: 'desktop', columns, emblem: 'none' }))

function all(n: Node, test: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (test(n)) out.push(n)
  for (const c of n.children) if (typeof c !== 'string') all(c, test, out)
  return out
}

function byKey(n: Node, key: string): Node | undefined {
  return all(n, x => x.props.key === key)[0]
}

function text(n: Node): string {
  return n.children.map(c => (typeof c === 'string' ? c : text(c))).join('')
}

// The cells a node takes in a row: a Button is one, a Box its width or its
// minimum width, an absolute Box none, and the rest the sum of its children.
function span(n: Node): number {
  if (n.type === 'Button') return 1
  if (n.props.position === 'absolute') return 0
  if (typeof n.props.width === 'number') return n.props.width
  if (typeof n.props.minWidth === 'number') return n.props.minWidth
  return n.children.reduce((sum, c) => sum + (typeof c === 'string' ? 0 : span(c)), 0)
}

function parentOf(root: Node, target: Node): Node | undefined {
  return all(root, n => n.children.includes(target))[0]
}

function sources(root: Node): string[] {
  return all(root, n => n.type === 'Svg').map(n => String(n.props.source))
}

describe('the desktop band keeps the terminal layout', () => {
  test('draws no private-use glyph, no rule glyph in Text, no Raster and no Image', () => {
    for (const columns of COLUMNS) {
      const menu = { accountMenu: { mode: 'pick' as const, draftEmail: '', draftProfile: '' } }
      for (const root of [desktop(columns), desktop(columns, menu), desktop(columns, { isRuleAnimated: true, barStyle: 'smooth' })]) {
        const strings = all(root, n => n.type === 'Text' || n.type === 'Button').flatMap(n => [text(n), String(n.props.label ?? '')])
        expect(strings.filter(s => PRIVATE_USE.test(s))).toEqual([])
        expect(sources(root).filter(s => PRIVATE_USE.test(s))).toEqual([])
        expect(all(root, n => n.type === 'Text').map(text).filter(s => RULE_GLYPHS.test(s))).toEqual([])
        expect(all(root, n => n.type === 'Raster' || n.type === 'Image')).toEqual([])
      }
    }
  })

  test('draws every Button with a string label and no children', () => {
    const menu = { accountMenu: { mode: 'pick' as const, draftEmail: '', draftProfile: '' } }
    const add = { accountMenu: { mode: 'add' as const, draftEmail: '', draftProfile: '' } }
    for (const root of [desktop(160), desktop(160, menu), desktop(160, add), desktop(80)]) {
      const buttons = all(root, n => n.type === 'Button')
      expect(buttons.length).toBeGreaterThan(0)
      expect(buttons.filter(b => typeof b.props.label !== 'string' || b.children.length > 0)).toEqual([])
    }
  })

  test('sets each ledger cell to the width the desktop plan gives', () => {
    const keys = ['cell-5h', 'cell-7d', 'cell-ctx', 'cell-cache', 'git-a', 'git-b']
    for (const columns of [130, 160, 238]) {
      const d = desktop(columns)
      const plan = planLedger(columns, desktopPlanOpts(bandData({ surface: 'desktop', columns, emblem: 'none' })))
      const want = [usageWidth(plan), usageWidth(plan), contextWidth(plan), contextWidth(plan), plan.gitWidth, plan.gitWidth]
      keys.forEach((key, i) => expect(byKey(d, key)?.props.width).toBe(want[i]))
    }
    // The terminal sets the same usage width. The desktop adds two cells to the
    // key field of the context row, for the keycap, and one to the git badge.
    const t = terminal(238)
    expect(byKey(t, 'cell-5h')?.props.width).toBe(byKey(desktop(238), 'cell-5h')?.props.width)
    expect(Number(byKey(desktop(238), 'cell-ctx')?.props.width) - Number(byKey(t, 'cell-ctx')?.props.width)).toBe(2)
    expect(['cell-5h', 'cell-ctx', 'git-a'].map(k => byKey(desktop(160), k)?.props.width)).toEqual([47, 67, 159])
    expect(['cell-5h', 'cell-ctx', 'git-a'].map(k => byKey(desktop(238), k)?.props.width)).toEqual([47, 67, 113])
    expect(['cell-5h', 'cell-ctx', 'git-a'].map(k => byKey(desktop(130), k)?.props.width)).toEqual([47, 67, 129])
  })

  test('the desktop never folds, the terminal still does at 80', () => {
    const folded = terminal(80)
    expect(byKey(folded, 'cell-5h')).toBeUndefined()
    expect(all(folded, n => n.type === 'Text' && /^5h 80%$/.test(text(n))).length).toBe(1)
    const full = desktop(80)
    expect(byKey(full, 'cell-5h')).toBeDefined()
    expect(all(full, n => n.type === 'Text' && /^5h 80%$/.test(text(n)))).toEqual([])
  })

  test('spans the band with the header, and with each inline row', () => {
    for (const columns of COLUMNS) {
      const root = desktop(columns)
      const rows = all(root, n => typeof n.props.key === 'string' && /^header(-right-\d)?$/.test(String(n.props.key)))
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(span(row)).toBe(columns)
    }
    for (const columns of [238]) {
      const root = desktop(columns)
      for (const key of ['row-0', 'row-1']) {
        const row = byKey(root, key) as Node
        expect(row.props.paddingLeft).toBe(1)
        expect(1 + span(row)).toBe(columns)
      }
      for (const rule of all(root, n => typeof n.props.key === 'string' && String(n.props.key).startsWith('row-rule-'))) {
        expect(span(rule)).toBe(columns - 1)
      }
      expect(all(root, n => n.type === 'Svg' && n.props.alt === 'column divider').length).toBe(4)
      for (const sep of all(root, n => n.type === 'Svg' && n.props.alt === 'column divider')) expect(parentOf(root, sep)?.props.width).toBe(5)
    }
  })

  test('sizes each header segment to its text plus two cells, and the rule to the room', () => {
    const root = desktop(160)
    const header = byKey(root, 'header') as Node
    const segments = all(header, n => n.type === 'Box' && typeof n.props.backgroundColor === 'string' && n.props.height === PILL_LINES && n.props.paddingX === 1)
    expect(segments.length).toBeGreaterThan(5)
    // The text centres, so the spare width splits evenly on both sides.
    expect(segments.every(b => b.props.justifyContent === 'center')).toBe(true)
    const rule = all(header, n => n.type === 'Svg' && n.props.alt === 'header rule')[0] as Node
    expect(parentOf(root, rule)?.props.flexShrink).toBe(1)
    const rest = span(header) - (parentOf(root, rule)?.props.width as number)
    expect(rest + (parentOf(root, rule)?.props.width as number)).toBe(160)
  })

  test('draws each header edge as the polygon of the terminal glyph, in the same colours', () => {
    // The terminal header is one row. A narrow desktop splits it, and each
    // row restarts its edges, so only the one-row headers compare edge by edge.
    for (const columns of [80, 130]) {
      const rows = all(desktop(columns), n => typeof n.props.key === 'string' && /^header(-right-\d)?$/.test(String(n.props.key)))
      const edges = rows.flatMap(r => all(r, n => n.type === 'Svg' && n.props.alt === 'edge'))
      const segments = rows.flatMap(r => all(r, n => n.type === 'Box' && typeof n.props.backgroundColor === 'string' && n.props.height === PILL_LINES && n.props.paddingX === 1))
      expect(segments.length).toBeGreaterThan(3)
      expect(edges.length).toBe(segments.length)
    }
    // The terminal draws contributed items in a row of their own, so the two
    // headers compare with none.
    for (const columns of [160, 238]) {
      const glyphs = all(byKey(terminal(columns, { band: [] }), 'header') as Node, n => n.type === 'Text' && /^[\ue0b0-\ue0bf]$/.test(text(n)))
      const edges = all(byKey(desktop(columns, { band: [] }), 'header') as Node, n => n.type === 'Svg' && n.props.alt === 'edge')
      expect(edges.length).toBe(glyphs.length)
      glyphs.forEach((g, i) => {
        const source = String(edges[i]?.props.source)
        expect(source).toContain(`<polygon points="${CAP_POINTS[text(g)]}" fill="${deskGround(String(g.props.color))}"/>`)
        if (g.props.backgroundColor === undefined) expect(source).not.toContain('<rect')
        else expect(source).toContain(`fill="${deskGround(String(g.props.backgroundColor))}"/>`)
      })
    }
  })

  test('draws each badge as a hexagon with both caps and the facet of its gem', () => {
    const root = desktop(160)
    const badges: [string, keyof typeof GEMS, number][] = [
      ['5h', 'emerald', 6], ['7d', 'teal', 6], ['ctx-detail', 'blue', 9], ['cache', 'amethyst', 9], ['git-pane', 'rhodolite', 9], ['diff', 'rhodolite', 9],
    ]
    for (const [key, gem, width] of badges) {
      const svg = all(root, n => n.type === 'Svg' && n.props.alt === `${key} badge`)[0] as Node
      const box = parentOf(root, svg) as Node
      expect(box.props.width).toBe(width + 1)
      const colors = gemColors(GEMS[gem], width - 1)
      const source = String(svg.props.source)
      expect(source).toContain(`fill="${colors[0]}"/>`)
      expect(source).toContain(`points="${width - 1}.98,0 ${width + 1},0.5 ${width - 1}.98,1" fill="${colors[colors.length - 1]}"`)
    }
    for (const key of ['ctx-detail', 'git-pane']) {
      const box = parentOf(root, all(root, n => n.type === 'Svg' && n.props.alt === `${key} badge`)[0] as Node) as Node
      expect(all(box, n => n.type === 'Button' && n.props.key === key).length).toBe(1)
    }
  })

  test('draws the usage bar with the fills of the terminal bar on the track', () => {
    const d = desktop(238)
    const bar = all(byKey(d, 'cell-5h') as Node, n => n.type === 'Svg' && n.props.alt === 'bar cells')[0] as Node
    const source = String(bar.props.source)
    // A run whose colour steps is one rect on a gradient, so its colours sit
    // on the gradient stops.
    const fills = [...source.matchAll(/(?:fill|stop-color)="(#[0-9a-f]{6})"/g)].map(m => m[1])
    expect(fills[0]).toBe(ROLE.emeraldLt)
    expect(fills).toContain(CORE.border)
    // The terminal bar holds one coloured run for each fill colour.
    const win = byKey(terminal(238), 'win-5h') as Node
    const runs = all(win, n => n.type === 'Text' && typeof n.props.color === 'string' && /^[━╸─]+$/.test(text(n))).map(n => n.props.color)
    expect(new Set(fills.filter(f => f !== CORE.border))).toEqual(new Set(runs.filter(c => c !== CORE.border)))
    expect(parentOf(d, bar)?.props.width).toBe(16)
  })

  test('draws a smooth bar as eighth-width rects', () => {
    const d = desktop(160, { barStyle: 'smooth' })
    const bar = all(byKey(d, 'cell-5h') as Node, n => n.type === 'Svg' && n.props.alt === 'bar-5h cells')[0] as Node
    // 80% of 16 cells is 12 full cells and 6.4 eighths: 6 eighths, a width of 0.75.
    expect(String(bar.props.source)).toContain('width="0.75"')
  })

  test('draws a shaped bar one glyph to a cell', () => {
    const d = desktop(160, { barStyle: 'hex' })
    const win = byKey(d, 'win-5h') as Node
    const glyphs = all(win, n => n.type === 'Text' && /^[⬢⬡]$/.test(text(n)))
    expect(glyphs.length).toBe(16)
    expect(glyphs.every(g => parentOf(d, g)?.props.width === 1)).toBe(true)
  })

  test('crosses the row rules with ticks where the column lines run', () => {
    const rules = (columns: number) => all(desktop(columns), n => n.type === 'Svg' && n.props.alt === 'row rule').map(n => String(n.props.source))
    const one = rules(238)
    expect(one.length).toBe(1)
    expect(one[0]).toContain('x1="49.5"')
    expect(one[0]).toContain('x1="121.5"')
    for (const columns of [130, 160]) {
      const stacked = rules(columns)
      expect(stacked.length).toBe(3)
      expect(stacked[0]).toContain(`<line x1="49.5" y1="0" x2="49.5" y2="${ROW}"`)
      expect(stacked[1]).toContain('<line x1="49.5" y1="0" x2="49.5" y2="13"')
      expect(stacked[2]).not.toContain('<line')
    }
  })

  test('colours the rules with the frame, and with Blonde inside the cache warning', () => {
    const rule = (over: Parameters<typeof bandData>[0]) => String(all(desktop(160, over), n => n.type === 'Svg' && n.props.alt === 'row rule')[0]?.props.source)
    const calm = rule({})
    expect(calm).toContain(`fill="${CORE.textMuted}"`)
    expect(calm).toContain(`stroke="${CORE.textMuted}"`)
    const warn = rule({ cacheView: { label: '0:50', tone: 'warning' } })
    expect(warn).toContain(`stroke="${ROLE.warn}"`)
    expect(warn).not.toContain(CORE.textMuted)
  })

  test('holds the animated gradient still at frame 0', () => {
    const rule = (sweep: number) => String(all(desktop(160, { isRuleAnimated: true, sweep }), n => n.type === 'Svg' && n.props.alt === 'row rule')[0]?.props.source)
    expect(rule(0)).toBe(paintSvg(rulePaints(ledgerRules(160, deskOpts(160))[0]!, 0), ROW))
    expect(rule(23)).toBe(rule(0))
    const head = (sweep: number) => String(all(desktop(160, { isRuleAnimated: true, sweep }), n => n.type === 'Svg' && n.props.alt === 'header rule')[0]?.props.source)
    expect(head(11)).toBe(head(0))
    const live = desktop(160, { isRuleAnimated: true })
    const room = (parentOf(live, all(live, n => n.type === 'Svg' && n.props.alt === 'header rule')[0] as Node) as Node).props.width as number
    expect(head(0)).toBe(paintSvg(headerRulePaints(room - 2, 0), ROW))
  })

  test('holds every figure in a Box of fixed width, with no padded text', () => {
    for (const columns of [130, 160, 238]) {
      const root = desktop(columns)
      const rows = all(root, n => typeof n.props.key === 'string' && /^row-\d$/.test(String(n.props.key)))
      expect(rows.length).toBeGreaterThan(1)
      for (const row of rows) {
        for (const t of all(row, n => n.type === 'Text')) {
          const own = text(t)
          expect(own === '' || !/^ +$/.test(own)).toBe(true)
          let up = parentOf(root, t)
          let fixed = false
          while (up !== undefined && up !== row) {
            if (typeof up.props.width === 'number') fixed = true
            up = parentOf(root, up)
          }
          expect(fixed).toBe(true)
          const box = parentOf(root, t) as Node
          if (typeof box.props.width === 'number' && box.children.length === 1) expect(own).toBe(own.trim())
        }
      }
    }
  })

  test('keeps ctx-detail and handoff as Buttons, drops hint-toggle, and keeps the reset time as Text', () => {
    const d = desktop(160)
    for (const key of ['ctx-detail', 'handoff', 'git-pane']) expect(all(d, n => n.type === 'Button' && n.props.key === key).length).toBe(1)
    expect(all(d, n => n.type === 'Button' && n.props.key === 'hint-toggle').length).toBe(0)
    expect(byKey(d, 'limits-5h')).toBeUndefined()
    expect(byKey(d, 'limits-7d')).toBeUndefined()
    const t = terminal(160)
    expect(all(t, n => n.type === 'Button' && n.props.key === 'limits-5h').length).toBe(1)
    expect(all(t, n => n.type === 'Button' && n.props.key === 'limits-7d').length).toBe(1)
  })

  test('sizes every drawing to the row height option', () => {
    const root = drawTree(DESKTOP, bandData({ surface: 'desktop', columns: 160, rowPx: 30 }))
    const svgs = all(root, n => n.type === 'Svg')
    expect(svgs.length).toBeGreaterThan(10)
    for (const svg of svgs) {
      expect(svg.props.height).toBe(30)
      expect(String(svg.props.source)).toContain('height="30"')
    }
  })

  test('draws every drawing in a Box of fixed width, one row tall, with the overflow hidden', () => {
    for (const columns of COLUMNS) {
      const root = desktop(columns)
      for (const svg of all(root, n => n.type === 'Svg')) {
        const box = parentOf(root, svg) as Node
        expect(typeof box.props.width).toBe('number')
        expect(box.props.height).toBe(1)
        expect(box.props.overflow).toBe('hidden')
        // A row height that is too large clips evenly and keeps the midline.
        expect(box.props.alignItems).toBe('center')
      }
    }
  })

  test('keeps every colour of a drawing inside the palette and the terminal draw', () => {
    for (const over of [{}, { isRuleAnimated: true }, { barStyle: 'smooth' as const }, { cacheView: { label: '0:50', tone: 'warning' as const } }]) {
      // The editor draws the same cells as Text runs, so it names every colour.
      const flat = drawTree(MOBILE, bandData({ surface: 'vscode', columns: 238, emblem: 'none', ...over }))
      const seen = new Set<string>([...Object.values(CORE), ...Object.values(ROLE), DESK_ELEVATED])
      for (const root of [terminal(238, over), flat]) {
        for (const n of all(root, () => true)) for (const k of ['color', 'backgroundColor']) if (typeof n.props[k] === 'string') seen.add(String(n.props[k]))
      }
      const mine = desktop(238, over)
      const room = (parentOf(mine, all(mine, n => n.type === 'Svg' && n.props.alt === 'header rule')[0] as Node) as Node).props.width as number
      for (const p of [...rulePaints(ledgerRules(238, deskOpts(238))[0]!, 0), ...headerRulePaints(room - 2, 0)]) if (p.fg !== null) seen.add(p.fg)
      for (const gem of Object.values(GEMS)) for (const w of [5, 7, 8]) for (const c of gemColors(gem, w)) seen.add(c)
      const unknown = sources(desktop(238, over)).flatMap(s => [...s.matchAll(/#[0-9a-f]{6}/gi)].map(m => m[0])).filter(c => !seen.has(c.toLowerCase()) && !seen.has(c))
      expect(unknown).toEqual([])
    }
  })

  test('lines up the account columns and keeps the email a Button', () => {
    const menu = { accountMenu: { mode: 'pick' as const, draftEmail: '', draftProfile: '' } }
    const root = desktop(160, menu)
    const buttons = ['kiriketsuki@gmail.com', 'jlim@aurrigo.com'].map(email => all(root, n => n.type === 'Button' && n.props.key === `pick-${email}`)[0] as Node)
    expect(buttons.map(b => b.props.label)).toEqual(['kiriketsuki@gmail.com', 'jlim@aurrigo.com'])
    const rows = buttons.map(b => parentOf(root, parentOf(root, b) as Node) as Node)
    const widths = rows.map(r => r.children.filter((c): c is Node => typeof c !== 'string').map(c => c.props.width))
    // Marker, email, firefox, profile, kind. The row in use adds its status.
    expect(widths[1]).toEqual([2, 23, 8, 19, 12])
    expect(widths[0]?.slice(0, 5)).toEqual(widths[1])
    expect(widths[0]?.length).toBe(6)
    // No text holds a padding space or the separator the old label joined with.
    for (const row of rows) for (const t of all(row, n => n.type === 'Text')) expect(text(t)).toBe(text(t).trim())
  })

  test('shows which Firefox profile is picked in the add panel', () => {
    const add = (draftProfile: string) => desktop(160, { accountMenu: { mode: 'add' as const, draftEmail: '', draftProfile }, profiles: [{ name: 'Original profile', path: '/p/a' }, { name: 'Work Claude', path: '/p/b' }] })
    const chip = (root: Node, path: string) => parentOf(root, all(root, n => n.type === 'Button' && n.props.key === `profile-${path}`)[0] as Node) as Node
    const picked = add('/p/a')
    const first = chip(picked, '/p/a')
    const second = chip(picked, '/p/b')
    expect(first.props.backgroundColor).toBe(CORE.emerald)
    expect(second.props.backgroundColor).not.toBe(CORE.emerald)
    expect(all(first, n => n.type === 'Text').map(text)).toContain('⬢')
    expect(all(second, n => n.type === 'Text').map(text)).toContain('⬡')
    // The picked chip moves with the draft.
    expect(chip(add('/p/b'), '/p/b').props.backgroundColor).toBe(CORE.emerald)
    expect(chip(add('/p/b'), '/p/a').props.backgroundColor).not.toBe(CORE.emerald)
  })

  test('leaves the other surfaces with their Text runs and no Svg', () => {
    const root = drawTree(MOBILE, bandData({ surface: 'vscode', columns: 238, emblem: 'none' }))
    expect(all(root, n => n.type === 'Svg')).toEqual([])
    expect(all(root, n => n.type === 'Text' && /[\ue0b0-\ue0bf]/.test(text(n))).length).toBeGreaterThan(5)
  })
})

describe('the desktop band in the engine', () => {
  test('draws and runs the handoff press', async ($, on) => {
    answerMeasure(on)
    const ran: string[] = []
    on('command.run', async (_$, e) => {
      ran.push(e.command)
      return {}
    })
    await $.session.measure(MEASURE)
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'AbovePrompt', props: props(200) })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ key: 'hint-toggle' })).toBeUndefined()
    expect(await ui.find({ key: 'ctx-detail' })).toBeDefined()
    await ui.press({ key: 'handoff' })
    expect(ran).toEqual(['context-handoff'])
    await ui.unmount()
  })

  test('sizes the drawings to the desktopRowPx option', { options: { desktopRowPx: '30' } }, async ($, on) => {
    answerMeasure(on)
    await $.session.measure(MEASURE)
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'AbovePrompt', props: props(200) })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs.length).toBeGreaterThan(10)
    expect(svgs.every(s => s.props.height === 30)).toBe(true)
    await ui.unmount()
  })
})
