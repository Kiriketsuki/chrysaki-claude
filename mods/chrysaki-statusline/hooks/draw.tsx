// Builds the band's tree from the collected values. No I/O happens here.
//
// The band is the Jewel Ledger. A header rule in the prompt's colour carries
// the brand run on the left and its mirror on the right. A drawer slot under
// it holds the account dropdown. The ledger below sets every figure on one
// grid, and a jewel badge opens each row. See ledger.tsx.

import type { RenderElement } from 'claude-code'

import type { AccountMenu, CacheView, FirefoxProfile, ShareOffer, StatuslineAccount, StatuslineLag, StatuslineWarn, StatuslineCache, StatuslineGit, StatuslineIdentity, StatuslineOutage, StatuslineRemote, StatuslineUsage, BandEntry, BandTone } from '../types'
import { iconFor } from './band'
import { toneColor } from './cache'
import { costSgd, ctxColor, isHandoffDue, leftEdge, modelLabel, rightEdge, sessionClock, sevenDayColor, smartCwd, usageColor } from './format'
import type { BarStyle } from './format'
import type { UsageHistory } from './history'
import { accountRows } from './dropdown'
import { bandEmblem, captionRow, crestFolded, crestWidth, emblemColumn } from './crest'
import { SWEEP_FRAMES, isRuleLive, ledgerRows, ledgerRules, paintRow, ruleFrame } from './ledger'
import { loopSampler, mixHex, readableGround, readableInk, sampleRamp } from './gradient'
import { packCells, paintCells } from './raster'
import type { Paint } from './raster'
import { CORE, ROLE } from './palette'
import { frameColor, hoverGroup, spaces } from './prims'
import type { Table } from './prims'

export type { Table } from './prims'

export type BandData = {
  usage: StatuslineUsage | null
  identity: StatuslineIdentity | null
  git: StatuslineGit | null
  remote: StatuslineRemote | null
  inbox: number
  phase: number
  now: number
  home: string
  columns: number
  // The mark the crest draws (an EMBLEMS name, or none) and the caption name.
  emblem: string
  caption: string
  // The crest folds to the hexagon glyph. A press on the glyph opens it.
  isCrestOpen: boolean
  onToggleCrest: () => void
  // The surface the band draws on. Only the terminal paints a Raster.
  surface: string
  barStyle: BarStyle
  // The 5h and 7d readings over time, and the last context token counts.
  history: UsageHistory
  ctxHistory: number[]
  // The rule between ledger rows: animated, and the sweep frame it draws with.
  // On the terminal the sweep clock repaints the rule after that.
  isRuleAnimated: boolean
  sweep: number
  usdToSgd: number
  // A read of the OAuth usage endpoint: in flight, and the press that starts one.
  isLimitsBusy: boolean
  onRefreshLimits: () => void
  // The worst open incident on the status page, and the press that opens it.
  outage: StatuslineOutage | null
  share: ShareOffer | null
  onShare: () => void
  lag: StatuslineLag | null
  warn: StatuslineWarn | null
  onLag: () => void
  // The items other mods contribute through the band protocol, and a press.
  band: BandEntry[]
  onBand: (entry: BandEntry) => void
  onOutage: () => void
  onContext: () => void
  cache: StatuslineCache | null
  cacheView: CacheView | null
  hasGitCommand: boolean
  onGit: () => void
  // True while a handoff the band started is still being written.
  isHandingOff: boolean
  onHandoff: () => void
  // The handoff path on the clipboard, while the session has no context yet.
  resumePath: string | null
  onResume: () => void
  accounts: StatuslineAccount[]
  profiles: FirefoxProfile[]
  accountMenu: AccountMenu | null
  // The account a switcher login waits for, or null.
  loginEmail: string | null
  onAccounts: () => void
  onPickAccount: (email: string) => void
  onAddAccount: () => void
  onCancelAdd: () => void
  onDraftEmail: (text: string) => void
  onDraftProfile: (value: string) => void
  onSaveAccount: () => void
  // The hint drawer under the prompt, and its chevron in the header.
  isHintOpen: boolean
  onToggleHint: () => void
}

// Below this width the band folds to the header and one line.
export const NARROW_COLUMNS = 100
// The engine draws its collapse mark `[-]` over the last cells of the band's
// first row. That row is the blank top margin, so the header runs full width.
const RESERVE = 0
const RULE = '─'
// The theme key of the prompt's rules. Text colours take a theme key.
const RULE_COLOR = 'promptBorder'
const HOURGLASS = '⧗'

// --- Segments ------------------------------------------------------------------

// A header segment. `text` gives the width, so a pressable segment's text
// carries the `x: ` mark the painter adds before a hotkey. `iconFg` colours
// the glyph before the first space. A segment with `press` draws its label as
// a plain Button on the segment's ground. A segment with `drop` leaves when
// the header runs out of room, the lowest rank first.
type Seg = {
  text: string
  bg: string
  fg: string
  bold?: boolean
  iconFg?: string
  // Gradient stops for the words after the icon, drawn letter by letter.
  ink?: readonly string[]
  press?: { key: string; label: string; hotkey?: string; onPress: () => void }
  drop?: number
}

// Letters of `text`, each in its own colour along the `ink` run.
function inked(T: Table, text: string, ink: readonly string[], bg: string, bold?: boolean): RenderElement[] {
  const { Text } = T
  const n = Math.max(1, text.trim().length - 1)
  let k = 0
  return [...text].map(ch => {
    if (ch === ' ') return <Text backgroundColor={bg}> </Text>
    const color = readableInk(sampleRamp(ink, k++ / n), bg)
    return <Text backgroundColor={bg} color={color} bold={bold}>{ch}</Text>
  })
}

function segBody(T: Table, s: Seg): RenderElement {
  const { Box, Text, Button } = T
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

function segWidth(segs: readonly { text: string }[]): number {
  return segs.reduce((n, s) => n + s.text.length + 3, 0)
}

// The rule between the two runs keeps at least this many cells.
const MIN_RULE = 3

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
function zigzag(T: Table, segs: readonly Seg[]): RenderElement[] {
  const { Text } = T
  return segs.flatMap((s, i) => {
    const next = segs[i + 1]
    const edge = rightEdge(i, segs.length)
    return [
      segBody(T, s),
      next === undefined ? <Text color={s.bg}>{edge}</Text> : <Text color={s.bg} backgroundColor={next.bg}>{edge}</Text>,
    ]
  })
}

// The mirror run, read right to left: the glyph before each segment, in that
// segment's colour on the previous one's ground, then the segment.
function mirrored(T: Table, segs: readonly Seg[]): RenderElement[] {
  const { Text } = T
  return segs.flatMap((s, j) => {
    const prev = segs[j - 1]
    const edge = leftEdge(j, segs.length)
    return [
      prev === undefined ? <Text color={s.bg}>{edge}</Text> : <Text color={s.bg} backgroundColor={prev.bg}>{edge}</Text>,
      segBody(T, s),
    ]
  })
}


// --- Header --------------------------------------------------------------------

// The gem type header: the drawer chevron, the brand run, a rule, then the
// mirror run. The runs step down through dark grounds, Abyss to Raised to
// Elevated, and the type carries the jewel: the model name, the folder and
// the account run a gradient letter by letter. Alerts keep their fills.
// Each zigzag edge cuts one ground into the next.
const BRAND_INK = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean] as const
// The ground of a minor alert: a dark amber, so Blonde lettering reads on it
// and no text ever sits on a Blonde fill.
export const AMBER_GROUND = mixHex(CORE.blonde, CORE.abyss, 0.8)
// The brand run as a loop, for the drifting header rule.
const brandAt = loopSampler(BRAND_INK)

// A contributed item as a header segment. The tone picks the ground and the
// lettering, and the guard in headerPlan holds both to 4.5:1. Warn and alert
// never drop. The rest drop with the session clock.
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

type HeaderPlan = { left: Seg[]; right: Seg[]; room: number }

// The segments that fit and the room left for the rule. No drawing happens
// here, so the sweep clock can size the header rule the same way.
function headerPlan(d: BandData, inner: number, isCompact: boolean, hasCrest = false): HeaderPlan {
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
    ...(id?.version && !isCompact ? [{ text: `◆ v${id.version}`, bg: CORE.raised, fg: ROLE.text, iconFg: ROLE.teal, ink: [ROLE.sec, ROLE.text], drop: 1 }] : []),
    ...(!isCompact ? [{ text: `⌂ ${smartCwd(id?.cwd ?? '', d.home)}`, bg: CORE.elevated, fg: ROLE.text, bold: true, iconFg: ROLE.teal, ink: [ROLE.text, ROLE.blondeLt], drop: 3 }] : []),
  ]
  const email = id?.email ?? ''
  // The account list knows the work accounts. The config folder is the guess
  // for an email it does not list.
  const isWork = d.accounts.find(a => a.email === email.toLowerCase())?.isWork ?? id?.isWorkAccount ?? false
  const accountSeg: Seg = {
    text: `a: ${email}`,
    bg: CORE.abyss,
    fg: ROLE.text,
    bold: true,
    ink: isWork ? [CORE.topaz, ROLE.blondeLt] : [ROLE.emeraldLt, ROLE.teal],
    press: { key: 'account', label: email, hotkey: 'a', onPress: d.onAccounts },
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
  const right: Seg[] = [
    ...lagSeg,
    ...warnSeg,
    ...outageSeg,
    ...shareSeg,
    ...(u?.costUsd === undefined ? [] : [{ text: `◈ $${costSgd(u.costUsd, d.usdToSgd)}`, bg: CORE.elevated, fg: ROLE.blondeLt, bold: true }]),
    ...(u?.startedAt === undefined || isCompact ? [] : [{ text: `◷ ${sessionClock(d.now - u.startedAt)}`, bg: CORE.raised, fg: ROLE.sec, drop: 2 }]),
    ...(d.inbox > 0 ? [{ text: `✉ ${d.inbox}`, bg: AMBER_GROUND, fg: ROLE.blondeLt, bold: true }] : []),
    ...(email && !isCompact ? [accountSeg] : []),
  ]
  // The chevron opens the hint drawer under the prompt. It takes one cell, and
  // the brand segment brings its own leading space.
  const chevron = 1
  // Every ground gives its lettering at least 4.5:1, so the edges, which read
  // the same ground, stay matched.
  const guard = (s: Seg): Seg => ({ ...s, bg: readableGround(s.bg, s.fg) })
  const [fitLeft, fitRight] = fitSegs(left.map(guard), right.map(guard), inner - chevron - 2 - MIN_RULE)
  const room = Math.max(0, inner - chevron - segWidth(fitLeft) - segWidth(fitRight) - 2)
  return { left: fitLeft, right: fitRight, room }
}

// The cells of the header rule at sweep frame `frame`: a faint brand loop
// that drifts along it, one space at each end.
export function headerRulePaints(room: number, frame: number): Paint[] {
  const dashes = Array.from({ length: room }, (_, i) => ({ glyph: RULE, fg: mixHex(CORE.border, brandAt(i / Math.max(1, room) - frame / SWEEP_FRAMES), 0.55), bg: null }))
  return [{ glyph: ' ', fg: null, bg: null }, ...dashes, { glyph: ' ', fg: null, bg: null }]
}

function headerRule(T: Table, d: BandData, room: number): RenderElement {
  const { Text } = T
  if (isRuleLive(T, d)) return paintRow(T, d.surface, 'header-rule', headerRulePaints(room, d.sweep))
  return <Text color={frameColor(d)}>{` ${RULE.repeat(room)} `}</Text>
}

function header(T: Table, d: BandData, inner: number, isCompact: boolean, hasCrest = false): RenderElement {
  const { Box, Text, Button } = T
  const id = d.identity
  const u = d.usage
  const { left: fitLeft, right: fitRight, room } = headerPlan(d, inner, isCompact, hasCrest)
  return (
    <Box key="header">
      <Button key="hint-toggle" label={d.isHintOpen ? '▾' : '▸'} plain onPress={d.onToggleHint} />
      {hoverGroup(T, 'brand', `${id?.model ?? 'model unknown'} · Claude Code ${id?.version ?? '?'} · ${id?.cwd ?? ''}`, zigzag(T, fitLeft))}
      {headerRule(T, d, room)}
      {fitRight.length > 0
        ? hoverGroup(T, 'cost', u?.costUsd === undefined ? 'session' : `US$${u.costUsd.toFixed(2)} this session`, mirrored(T, fitRight))
        : <Text />}
    </Box>
  )
}

// The folded form under NARROW_COLUMNS: one line of the key figures.
function compactLine(T: Table, d: BandData): RenderElement | null {
  const { Box, Text } = T
  const u = d.usage
  const g = d.git
  const bits: RenderElement[] = []
  const add = (el: RenderElement) => {
    if (bits.length > 0) bits.push(<Text color={RULE_COLOR}>{'  ◆  '}</Text>)
    bits.push(el)
  }
  if (u?.fiveHour) add(<Text color={usageColor(u.fiveHour.percent)}>{`5h ${u.fiveHour.percent}%`}</Text>)
  if (u?.sevenDay) add(<Text color={u.sevenDay.percent < 50 ? sevenDayColor(u.sevenDay.percent) : usageColor(u.sevenDay.percent)}>{`7d ${u.sevenDay.percent}%`}</Text>)
  if (u?.ctxPercent !== undefined) add(<Text color={ctxColor(u.ctxPercent, u.ctxTokens)}>{`ctx ${u.ctxPercent}%${isHandoffDue(u.ctxTokens) ? ' ⬢' : ''}`}</Text>)
  if (d.cacheView) add(<Text color={toneColor(d.cacheView.tone)}>{`${HOURGLASS} ${d.cacheView.label}`}</Text>)
  if (g) add(<Text color={ROLE.emeraldLt}>{`⎇ ${g.branch} +${g.insertions} -${g.deletions}`}</Text>)
  return bits.length === 0 ? null : <Box>{bits}</Box>
}

// A Raster row the sweep clock repaints: its key and its cells at a frame.
export type LiveStrip = { key: string; frame: (n: number) => string }

// The Raster rows a band draws for `d`, as the sweep clock repaints them:
// the header rule, then the ledger rules. A folded band has no ledger.
export function bandStrips(d: BandData): LiveStrip[] {
  const inner = Math.max(20, d.columns - RESERVE)
  const isCompact = d.columns < NARROW_COLUMNS
  const crest = crestWidth(d)
  const { room } = headerPlan(d, inner - crest, isCompact, crest > 0)
  const head: LiveStrip = { key: 'header-rule', frame: n => packCells(paintCells(headerRulePaints(room, n))) }
  const rules = isCompact ? [] : ledgerRules(inner).map((r): LiveStrip => ({ key: r.key, frame: n => ruleFrame(r, n) }))
  return [head, ...rules]
}

// The row of items other mods contribute through the band protocol, under
// the header. Each item is a segment in its tone, with the same contrast
// guard as the header. On the terminal hexagon caps close each one, as the
// ledger badges do. Null while no mod contributes.
function modRow(T: Table, d: BandData): RenderElement | null {
  if (d.band.length === 0) return null
  const { Box, Text } = T
  const hasCaps = d.surface === 'terminal'
  const parts = d.band.flatMap(e => {
    const raw = bandSeg(d, e)
    const s = { ...raw, bg: readableGround(raw.bg, raw.fg) }
    return [
      ...(hasCaps ? [<Text color={s.bg}>{'\ue0b2'}</Text>] : []),
      segBody(T, s),
      ...(hasCaps ? [<Text color={s.bg}>{'\ue0b0'}</Text>] : []),
      <Text>{'  '}</Text>,
    ]
  })
  return <Box key="mod-row" paddingLeft={1} overflow="hidden">{parts}</Box>
}

export function drawBand(T: Table, d: BandData): RenderElement {
  const { Box } = T
  const inner = Math.max(20, d.columns - RESERVE)
  const mods = modRow(T, d)
  if (d.columns < NARROW_COLUMNS) {
    const lines = [header(T, d, inner, true), mods, compactLine(T, d)]
    return <Box flexDirection="column" marginTop={1}>{lines.filter((l): l is RenderElement => l !== null)}</Box>
  }
  // One empty row parts the band from the transcript above it. Under the
  // header come the account dropdown while it is open, the mod row, then one
  // empty row before the ledger, as the empty row above the prompt.
  const menu = accountRows(T, d)
  const spacer = <Box key="spacer" height={1} />
  const middle = [...(mods === null ? [] : [mods]), spacer]
  const emblem = bandEmblem(d)
  if (emblem !== null) {
    // The crest: the mark beside the header and the row under it. That row
    // holds the caption, or the account dropdown while it is open.
    const side = [header(T, d, inner - crestWidth(d), false, true), ...(menu.length > 0 ? menu : [captionRow(T, d)])]
    const crest = <Box key="crest">{emblemColumn(T, emblem)}<Box flexDirection="column" flexGrow={1}>{side}</Box></Box>
    return <Box flexDirection="column" marginTop={1}>{[crest, ...middle, ...ledgerRows(T, d, inner)]}</Box>
  }
  return <Box flexDirection="column" marginTop={1}>{[header(T, d, inner, false), ...menu, ...middle, ...ledgerRows(T, d, inner)]}</Box>
}
