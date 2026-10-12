// The header of the band: the drawer chevron (the terminal only), the brand
// run on the left, a rule, and the mirror run on the right. The runs step down through dark
// grounds, Abyss to Raised to Elevated, and the type carries the jewel: the
// model name, the folder and the account run a gradient letter by letter.
// Alerts keep their fills. Each zigzag edge cuts one ground into the next.
// The terminal draws one row. The desktop can move the right run to a row of
// its own when its width does not fit one. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { BandEntry, BandTone, StatuslineOutage } from '../types'
import { iconFor } from './band'
import { capPath, costSgd, leftEdge, modelLabel, rightEdge, sessionClock, smartCwd } from './format'
import type { BandData } from './draw'
import { crestFolded } from './crest'
import { mixHex, readableGround, readableInk } from './gradient'
import { deskGround } from './ground'
import { CORE, ROLE } from './palette'
import { hoverGroup } from './prims'
import type { Prims, Seg, Table } from './prims'
import { isDesktop, primsFor } from './prims-for'
import { BRAND_INK } from './rules'

// Each segment takes its text plus three cells: two of padding, one edge.
export function segWidth(segs: readonly { text: string }[]): number {
  return segs.reduce((n, s) => n + s.text.length + 3, 0)
}

// The rule between the two runs keeps at least this many cells.
export const MIN_RULE = 3

// Both runs, with the droppable segments taken out by rank until they fit in
// `room` cells. A segment wider than its share wraps and doubles the header.
export function fitSegs<S extends { text: string; drop?: number }>(left: readonly S[], right: readonly S[], room: number): [S[], S[]] {
  const ranks = [...new Set([...left, ...right].flatMap(s => (s.drop === undefined ? [] : [s.drop])))].sort((a, b) => a - b)
  let l = [...left]
  let r = [...right]
  for (const rank of ranks) {
    if (segWidth(l) + segWidth(r) <= room) break
    l = l.filter(s => s.drop !== rank)
    r = r.filter(s => s.drop !== rank)
  }
  return [l, r]
}

// A zigzag-alt run read left to right: each segment, then the glyph that
// joins it to the next, in this segment's colour on the next one's ground.
function zigzag(P: Prims, segs: readonly Seg[]): RenderElement[] {
  return segs.flatMap((s, i) => [P.segBody(s), P.edge(rightEdge(i, segs.length), s.bg, segs[i + 1]?.bg)])
}

// The mirror run, read right to left: the glyph before each segment, in that
// segment's colour on the previous one's ground, then the segment.
function mirrored(P: Prims, segs: readonly Seg[]): RenderElement[] {
  return segs.flatMap((s, j) => [P.edge(leftEdge(j, segs.length), s.bg, segs[j - 1]?.bg), P.segBody(s)])
}

// --- Segments ------------------------------------------------------------------

// The ground of a minor alert: a dark amber, so Blonde lettering reads on it
// and no text ever sits on a Blonde fill.
export const AMBER_GROUND = mixHex(CORE.blonde, CORE.abyss, 0.8)

// A contributed item as a segment. The tone picks the ground and the
// lettering, and guardSeg holds both to 4.5:1. Warn and alert never drop
// from the desktop header. The rest drop with the session clock.
function bandSeg(d: BandData, e: BandEntry): Seg {
  const label = `${iconFor(e.icon, d.surface)} ${e.text}`
  const look: Record<BandTone, Pick<Seg, 'bg' | 'fg' | 'bold' | 'ink'>> = {
    calm: { bg: CORE.raised, fg: ROLE.sec },
    info: { bg: CORE.raised, fg: ROLE.teal },
    accent: { bg: CORE.abyss, fg: ROLE.emeraldLt, bold: true, ink: BRAND_INK },
    warn: { bg: AMBER_GROUND, fg: ROLE.blondeLt, bold: true },
    alert: { bg: CORE.error, fg: ROLE.text, bold: true },
  }
  const isUrgent = e.tone === 'warn' || e.tone === 'alert'
  return {
    text: e.hotkey === undefined ? label : `${e.hotkey}: ${label}`,
    ...look[e.tone],
    ...(e.command === undefined ? {} : { press: { key: `band-${e.source}-${e.id}`, label, ...(e.hotkey === undefined ? {} : { hotkey: e.hotkey }), onPress: () => d.onBand(e) } }),
    ...(isUrgent ? {} : { drop: 2 }),
  }
}

// Every ground gives its lettering at least 4.5:1. The desktop lifts a
// ground that is too dark for its card and lifts the lettering to match.
function guardSeg(s: Seg, isDesk: boolean): Seg {
  const lifted = isDesk ? deskGround(s.bg) : s.bg
  if (lifted !== s.bg) return { ...s, bg: lifted, fg: readableInk(s.fg, lifted) }
  return { ...s, bg: readableGround(s.bg, s.fg) }
}

// The row of items other mods contribute through the band protocol, under
// the terminal header. Each item is a segment in its tone, with the guard
// of the header. Hexagon caps close each one, as the ledger badges do. Null
// while no mod contributes. The desktop keeps the items in its header.
export function modRow(T: Table, d: BandData): RenderElement | null {
  if (d.band.length === 0) return null
  const { Box, Text } = T
  const P = primsFor(T, d)
  const isDesk = isDesktop(T, d)
  const hasCaps = d.surface === 'terminal'
  const parts = d.band.flatMap(e => {
    const s = guardSeg(bandSeg(d, e), isDesk)
    return [
      ...(hasCaps ? [<Text color={s.bg}>{'\ue0b2'}</Text>] : []),
      P.segBody(s),
      ...(hasCaps ? [<Text color={s.bg}>{'\ue0b0'}</Text>] : []),
      <Text>{'  '}</Text>,
    ]
  })
  return <Box key="mod-row" paddingLeft={1} overflow="hidden">{parts}</Box>
}

type Runs = { left: Seg[]; right: Seg[] }

// How far the desktop narrows its header to keep one row. `cwdMax` caps the
// folder path to that many characters, cut from the left. `hasVersion` false
// leaves out the version, which the brand card still shows. `isNarrow` shows
// the account name before the @ and leaves out the clock, which the cost card
// still shows.
export type DeskFit = { cwdMax: number; hasVersion: boolean; isNarrow: boolean }
const WHOLE: DeskFit = { cwdMax: Infinity, hasVersion: true, isNarrow: false }

// Both runs of the header, before any segment drops. Every ground gives its
// lettering at least 4.5:1, so the edges, which read the same ground, stay
// matched. `isCompact` leaves out the version, the folder, the clock and the
// account. `hasCrest` lets the crest's mark stand in for the hexagon glyph.
// `isDesk` lifts the Raised and Elevated grounds for the lighter desktop card,
// and lifts the lettering to match instead of darkening the ground. `fit`
// narrows the desktop header to one row (DeskFit).
export function headerSegs(d: BandData, isCompact: boolean, hasCrest: boolean, isDesk = false, fit: DeskFit = WHOLE): Runs {
  const { cwdMax, hasVersion, isNarrow } = fit
  const id = d.identity
  const u = d.usage
  const left: Seg[] = [
    // Beside the crest the mark stands in for the ⬢ glyph.
    hasCrest
      ? { text: modelLabel(id?.model ?? ''), bg: CORE.abyss, fg: ROLE.text, bold: true, ink: BRAND_INK }
      : crestFolded(d)
        // A folded crest: a press on the brand segment opens it.
        ? { text: `⬢ ${modelLabel(id?.model ?? '')}`, bg: CORE.abyss, fg: ROLE.text, bold: true, ink: BRAND_INK, press: { key: 'crest-toggle', label: `⬢ ${modelLabel(id?.model ?? '')}`, onPress: d.onToggleCrest } }
        : { text: `⬢ ${modelLabel(id?.model ?? '')}`, bg: CORE.abyss, fg: ROLE.text, bold: true, iconFg: ROLE.blondeLt, ink: BRAND_INK },
    ...(id?.version && !isCompact && hasVersion ? [{ text: `◆ v${id.version}`, bg: CORE.raised, fg: ROLE.text, iconFg: ROLE.teal, ink: [ROLE.sec, ROLE.text], drop: 1 }] : []),
    ...(!isCompact ? [{ text: `⌂ ${capPath(smartCwd(id?.cwd ?? '', d.home), cwdMax)}`, bg: CORE.elevated, fg: ROLE.text, bold: true, iconFg: ROLE.teal, ink: [ROLE.text, ROLE.blondeLt], drop: 3 }] : []),
  ]
  const email = id?.email ?? ''
  // The account list knows the work accounts. The config folder is the guess
  // for an email it does not list.
  const isWork = d.accounts.find(a => a.email === email.toLowerCase())?.isWork ?? id?.isWorkAccount ?? false
  // A narrow header shows the name before the @, on the pill and on its
  // desktop button. The account dropdown still lists the whole address.
  const shown = isNarrow ? email.replace(/@.*$/, '') : email
  const accountSeg: Seg = {
    text: `a: ${shown}`,
    bg: CORE.abyss,
    fg: ROLE.text,
    bold: true,
    ink: isWork ? [CORE.topaz, ROLE.blondeLt] : [ROLE.emeraldLt, ROLE.teal],
    press: { key: 'account', label: shown, hotkey: 'a', onPress: d.onAccounts },
    drop: 4,
  }
  const o = d.outage
  const outageLabel = o === null ? '' : `⚠ ${o.impact}${o.count > 1 ? ` +${o.count - 1}` : ''}`
  const outageSeg: Seg[] = o === null ? [] : [{
    text: `o: ${outageLabel}`,
    bg: o.impact === 'minor' ? AMBER_GROUND : CORE.error,
    fg: o.impact === 'minor' ? ROLE.blondeLt : ROLE.text,
    bold: true,
    press: { key: 'outage', label: outageLabel, hotkey: 'o', onPress: d.onOutage },
  }]
  // The share key for a new artifact. It never drops, like the outage badge.
  const shareSeg: Seg[] = d.share === null ? [] : [{
    text: 'p: ↗ share',
    bg: CORE.teal,
    fg: ROLE.text,
    bold: true,
    press: { key: 'share', label: '↗ share', hotkey: 'p', onPress: d.onShare },
  }]
  // The lag badge from chrysaki-lag. It never drops, like the outage badge.
  const lag = d.lag
  const lagSeg: Seg[] = lag === null ? [] : [{
    text: `l: ▲ ${lag.bound} ${lag.pct}%`,
    bg: lag.level === 'laggy' ? CORE.error : AMBER_GROUND,
    fg: lag.level === 'laggy' ? ROLE.text : ROLE.blondeLt,
    bold: true,
    press: { key: 'lag', label: `▲ ${lag.bound} ${lag.pct}%`, hotkey: 'l', onPress: d.onLag },
  }]
  // The warning badge from chrysaki-lag. It opens /lag too.
  const warn = d.warn
  const warnText = warn === null ? '' : `⚠ ${warn.short}${warn.more > 0 ? ` +${warn.more}` : ''}`
  const warnSeg: Seg[] = warn === null ? [] : [{
    text: `w: ${warnText}`,
    bg: warn.level === 'crit' ? CORE.error : AMBER_GROUND,
    fg: warn.level === 'crit' ? ROLE.text : ROLE.blondeLt,
    bold: true,
    press: { key: 'warn', label: warnText, hotkey: 'w', onPress: d.onLag },
  }]
  // The terminal draws contributed items in the mod row under the header.
  // The desktop keeps them in the header, inside its budget of lines.
  const bandSegs = isDesk ? d.band.map(e => bandSeg(d, e)) : []
  const right: Seg[] = [
    ...lagSeg,
    ...warnSeg,
    ...bandSegs,
    ...outageSeg,
    ...shareSeg,
    ...(u?.costUsd === undefined ? [] : [{ text: `◈ $${costSgd(u.costUsd, d.usdToSgd)}`, bg: CORE.elevated, fg: ROLE.blondeLt, bold: true }]),
    ...(u?.startedAt === undefined || isCompact || isNarrow ? [] : [{ text: `◷ ${sessionClock(d.now - u.startedAt)}`, bg: CORE.raised, fg: ROLE.sec, drop: 2 }]),
    ...(d.inbox > 0 ? [{ text: `✉ ${d.inbox}`, bg: AMBER_GROUND, fg: ROLE.blondeLt, bold: true }] : []),
    ...(email && !isCompact ? [accountSeg] : []),
  ]
  const guard = (s: Seg): Seg => guardSeg(s, isDesk)
  return { left: left.map(guard), right: right.map(guard) }
}

export type HeaderPlan = { left: Seg[]; right: Seg[]; room: number }

// The segments that fit and the room left for the rule. No drawing happens
// here, so the sweep clock can size the header rule the same way. The chevron
// takes `chevron` cells, one on the terminal.
export function headerPlan(d: BandData, inner: number, isCompact: boolean, hasCrest = false, chevron = 1): HeaderPlan {
  const { left, right } = headerSegs(d, isCompact, hasCrest)
  const [fitLeft, fitRight] = fitSegs(left, right, inner - chevron - 2 - MIN_RULE)
  const room = Math.max(0, inner - chevron - segWidth(fitLeft) - segWidth(fitRight) - 2)
  return { left: fitLeft, right: fitRight, room }
}

function brandCard(d: BandData): string {
  const id = d.identity
  return `${id?.model ?? 'model unknown'} · Claude Code ${id?.version ?? '?'} · ${id?.cwd ?? ''}`
}

// The cost card. `hasClock` adds the session clock for a header that left the
// clock out.
function costCard(d: BandData, hasClock = false): string {
  const u = d.usage
  const cost = u?.costUsd === undefined ? 'session' : `US$${u.costUsd.toFixed(2)} this session`
  const card = hasClock && u?.startedAt !== undefined ? `${cost} · ${sessionClock(d.now - u.startedAt)}` : cost
  const o = d.outage
  return o === null ? card : `${card} · ${outageCard(o)}`
}

// The top incident, the components it names, and whether the page watches it.
export function outageCard(o: StatuslineOutage): string {
  const where = o.components.length > 0 ? o.components.join(', ') : 'no component named'
  return `${o.name} (${where}${o.isMonitoring ? ', monitoring' : ''})`
}

// The terminal header, one row: the chevron, the brand run, a rule, then the
// mirror run.
export function header(T: Table, d: BandData, inner: number, isCompact: boolean, hasCrest = false): RenderElement {
  const { Box, Text } = T
  const P = primsFor(T, d)
  const { left: fitLeft, right: fitRight, room } = headerPlan(d, inner, isCompact, hasCrest, P.chevronCells)
  return (
    <Box key="header">
      {P.chevron({ label: d.isHintOpen ? '▾' : '▸', onPress: d.onToggleHint })}
      {hoverGroup(T, 'brand', brandCard(d), zigzag(P, fitLeft))}
      {P.headerRule(room)}
      {fitRight.length > 0 ? hoverGroup(T, 'cost', costCard(d), mirrored(P, fitRight)) : <Text />}
    </Box>
  )
}

// --- Desktop rows --------------------------------------------------------------

// Cuts a run into rows in order. A row holds as many segments as fit in
// `room` cells, and a segment wider than the room gets a row of its own.
function cutRows<S extends { text: string }>(segs: readonly S[], room: number): S[][] {
  const rows: S[][] = []
  for (const s of segs) {
    const last = rows[rows.length - 1]
    if (last !== undefined && segWidth(last) + segWidth([s]) <= room) rows[rows.length - 1] = [...last, s]
    else rows.push([s])
  }
  return rows
}

// A run cut into at most `maxRows` rows. When the rows run over, the droppable
// segments leave by rank, the lowest first, until the rows fit. A run that
// still runs over after that keeps its extra rows.
export function splitRun<S extends { text: string; drop?: number }>(segs: readonly S[], room: number, maxRows: number): S[][] {
  const ranks = [...new Set(segs.flatMap(s => (s.drop === undefined ? [] : [s.drop])))].sort((a, b) => a - b)
  let kept = [...segs]
  let rows = cutRows(kept, room)
  for (const rank of ranks) {
    if (rows.length <= maxRows) break
    kept = kept.filter(s => s.drop !== rank)
    rows = cutRows(kept, room)
  }
  return rows
}

// The most rows the right run takes on the desktop. With the row of the left
// run, the header takes two rows at most, and the ledger keeps its lines.
const RIGHT_ROWS = 1

// Two rows of one run, with segments moved from the end of the first row to
// the front of the second while that brings the two widths closer. The order
// of the run stays. Any other count of rows stays as it is.
export function balanceRows<S extends { text: string }>(rows: readonly S[][], room: number): S[][] {
  if (rows.length !== 2) return rows.map(r => [...r])
  let first = [...(rows[0] as S[])]
  let second = [...(rows[1] as S[])]
  for (;;) {
    const moved = first[first.length - 1]
    if (moved === undefined || first.length < 2) break
    const gapNow = Math.abs(segWidth(first) - segWidth(second))
    const nextFirst = first.slice(0, -1)
    const nextSecond = [moved, ...second]
    if (segWidth(nextSecond) > room || Math.abs(segWidth(nextFirst) - segWidth(nextSecond)) >= gapNow) break
    first = nextFirst
    second = nextSecond
  }
  return [first, second]
}

// A rule shorter than this many cells beyond the minimum draws as a gap.
const RULE_STUB = 4

// The space between a run and the edge of its row. A rule fills it when it
// leaves room for a rule that reads as one. A narrower space stays empty, so
// no stub of two or three cells shows. The space spans `cells` cells either way.
function ruled(T: Table, P: Prims, cells: number, isRuled: boolean): RenderElement {
  const { Box } = T
  const room = cells - 2
  if (isRuled && room >= MIN_RULE + RULE_STUB) return P.headerRule(room)
  return <Box width={Math.max(0, cells)} height={1} flexShrink={1} minWidth={0} />
}

// The steps a desktop header takes to keep one row, in order: the whole
// header, then without the version, then narrow (the account name before the
// @ and no clock). Each step also caps the folder path when that is enough.
const FIT_STEPS: readonly Omit<DeskFit, 'cwdMax'>[] = [
  { hasVersion: true, isNarrow: false },
  { hasVersion: false, isNarrow: false },
  { hasVersion: false, isNarrow: true },
]
const NARROW: DeskFit = { cwdMax: Infinity, hasVersion: false, isNarrow: true }

// The runs of the desktop header, fitted to `inner` cells on one row, and the
// fit that got them there. A desktop pane is narrower than a terminal, and one
// header row leaves more rows for the ledger. The result is null when even the
// narrow step with the shortest path leaves the header wider than one row.
function oneRowRuns(d: BandData, inner: number, chevron: number): { runs: Runs; fit: DeskFit } | null {
  // One row keeps a rule that reads as one, as the terminal header does.
  const need = (r: Runs) => segWidth(r.left) + segWidth(r.right) + chevron + 2 + MIN_RULE + RULE_STUB
  const path = smartCwd(d.identity?.cwd ?? '', d.home)
  for (const step of FIT_STEPS) {
    const whole = headerSegs(d, false, false, true, { ...step, cwdMax: Infinity })
    const over = need(whole) - inner
    if (over <= 0) return { runs: whole, fit: { ...step, cwdMax: Infinity } }
    const fit = { ...step, cwdMax: path.length - over }
    const capped = headerSegs(d, false, false, true, fit)
    if (need(capped) <= inner) return { runs: capped, fit }
  }
  return null
}

// The desktop header. With room it is the terminal header on one row, with the
// folder path capped first when that is all it takes. Without, the left run
// keeps its row with a rule that fills the rest, and the right run goes to a
// row of its own under it, set against the left edge like the first row. The
// right run drops its lower ranks, the clock and the quiet items first, until
// it fits that one row. Every row spans exactly `inner` cells. A rule of only
// a few cells draws as a gap.
export function desktopHeaderRows(T: Table, d: BandData, inner: number): RenderElement[] {
  const { Box, Text } = T
  const P = primsFor(T, d)
  const chevron = P.chevronCells
  const toggle = P.chevron({ label: d.isHintOpen ? '▾' : '▸', onPress: d.onToggleHint })
  const one = oneRowRuns(d, inner, chevron)
  if (one !== null) {
    const { left, right } = one.runs
    return [
      <Box key="header">
        {toggle}
        {hoverGroup(T, 'brand', brandCard(d), zigzag(P, left))}
        {ruled(T, P, inner - chevron - segWidth(left) - segWidth(right), true)}
        {right.length > 0 ? hoverGroup(T, 'cost', costCard(d, one.fit.isNarrow), mirrored(P, right)) : <Text />}
      </Box>,
    ]
  }
  const room = inner - 2 - MIN_RULE
  // A header too wide for one row even at the narrow step stays narrow.
  const whole = headerSegs(d, false, false, true, NARROW)
  // The left run caps its folder path before any segment of it drops.
  const over = segWidth(whole.left) - (room - chevron)
  const path = smartCwd(d.identity?.cwd ?? '', d.home)
  const left = over > 0 ? headerSegs(d, false, false, true, { ...NARROW, cwdMax: path.length - over }).left : whole.left
  const [fitLeft] = fitSegs(left, [], room - chevron)
  const rows = balanceRows(splitRun(whole.right, room, RIGHT_ROWS), room)
  // The first group of the right run keeps the key `cost`, the next `cost-1`.
  const costKey = (n: number) => (n === 0 ? 'cost' : `cost-${n}`)
  return [
    <Box key="header">
      {toggle}
      {hoverGroup(T, 'brand', brandCard(d), zigzag(P, fitLeft))}
      {ruled(T, P, inner - chevron - segWidth(fitLeft), true)}
    </Box>,
    ...rows.map((row, j) => (
      <Box key={`header-right-${j}`}>
        {hoverGroup(T, costKey(j), costCard(d, true), zigzag(P, row))}
        {ruled(T, P, inner - segWidth(row), true)}
      </Box>
    )),
  ]
}
