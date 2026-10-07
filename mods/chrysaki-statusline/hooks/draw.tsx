// Builds the band's tree from the collected values. No I/O happens here.
//
// The band is the Jewel Ledger. A header rule in the prompt's colour carries
// the brand run on the left and its mirror on the right. A drawer slot under
// it holds the account dropdown. The ledger below sets every figure on one
// grid, and a jewel badge opens each row. See ledger.tsx.

import type { RenderElement } from 'claude-code'

import type { AccountMenu, CacheView, FirefoxProfile, StatuslineAccount, StatuslineCache, StatuslineGit, StatuslineIdentity, StatuslineOutage, StatuslineRemote, StatuslineUsage } from '../types'
import { NEW_PROFILE, accountLabel } from './accounts'
import { toneColor } from './cache'
import { costSgd, ctxColor, fiveHourColor, isHandoffDue, leftEdge, modelLabel, rightEdge, sessionClock, sevenDayColor, smartCwd } from './format'
import type { BarStyle } from './format'
import { ledgerRows } from './ledger'
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
  barStyle: BarStyle
  // The rule between ledger rows: animated, and its current frame.
  isRuleAnimated: boolean
  sweep: number
  usdToSgd: number
  // A read of the OAuth usage endpoint: in flight, and the press that starts one.
  isLimitsBusy: boolean
  onRefreshLimits: () => void
  // The worst open incident on the status page, and the press that opens it.
  outage: StatuslineOutage | null
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
// At this width and up, an empty drawer slot parts the header from the ledger.
const SPACER_COLUMNS = 150
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
  press?: { key: string; label: string; hotkey: string; onPress: () => void }
  drop?: number
}

function segBody(T: Table, s: Seg): RenderElement {
  const { Box, Text, Button } = T
  if (s.press !== undefined) {
    return (
      <Box key={`seg-${s.press.key}`} backgroundColor={s.bg}>
        <Text backgroundColor={s.bg}> </Text>
        <Button key={s.press.key} label={s.press.label} hotkey={s.press.hotkey} plain onPress={s.press.onPress} />
        <Text backgroundColor={s.bg}> </Text>
      </Box>
    )
  }
  const at = s.text.indexOf(' ')
  if (s.iconFg === undefined || at < 0) return <Text backgroundColor={s.bg} color={s.fg} bold={s.bold}>{` ${s.text} `}</Text>
  return (
    <Text backgroundColor={s.bg}>
      <Text backgroundColor={s.bg} color={s.iconFg} bold>{` ${s.text.slice(0, at)}`}</Text>
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

// The header: the drawer chevron, the brand run (model on Emerald, version on
// Royal Blue Lt, folder on Amethyst Lt), a rule in the prompt's colour, then
// the mirror run with cost on Amethyst Lt, the session clock on Royal Blue Lt,
// the inbox on Blonde and the account on Emerald, or Topaz for a work account.
// Neighbours take hues far apart, so each powerline edge shows.
function header(T: Table, d: BandData, inner: number, isCompact: boolean): RenderElement {
  const { Box, Text, Button } = T
  const id = d.identity
  const u = d.usage
  const left: Seg[] = [
    { text: `⬢ ${modelLabel(id?.model ?? '')}`, bg: CORE.emerald, fg: ROLE.text, bold: true, iconFg: ROLE.blondeLt },
    ...(id?.version && !isCompact ? [{ text: `◆ v${id.version}`, bg: CORE.blueLight, fg: ROLE.text, drop: 1 }] : []),
    ...(!isCompact ? [{ text: `⌂ ${smartCwd(id?.cwd ?? '', d.home)}`, bg: CORE.amethystLight, fg: ROLE.text, bold: true, drop: 3 }] : []),
  ]
  const email = id?.email ?? ''
  // The account list knows the work accounts. The config folder is the guess
  // for an email it does not list.
  const isWork = d.accounts.find(a => a.email === email.toLowerCase())?.isWork ?? id?.isWorkAccount ?? false
  const accountSeg: Seg = {
    text: `a: ${email}`,
    bg: isWork ? CORE.topaz : CORE.emerald,
    fg: ROLE.text,
    bold: true,
    press: { key: 'account', label: email, hotkey: 'a', onPress: d.onAccounts },
    drop: 4,
  }
  const o = d.outage
  const outageLabel = o === null ? '' : `⚠ ${o.impact}${o.count > 1 ? ` +${o.count - 1}` : ''}`
  const outageSeg: Seg[] = o === null ? [] : [{
    text: `o: ${outageLabel}`,
    bg: o.impact === 'minor' ? CORE.blonde : CORE.error,
    fg: o.impact === 'minor' ? CORE.abyss : ROLE.text,
    bold: true,
    press: { key: 'outage', label: outageLabel, hotkey: 'o', onPress: d.onOutage },
  }]
  const right: Seg[] = [
    ...outageSeg,
    ...(u?.costUsd === undefined ? [] : [{ text: `◈ $${costSgd(u.costUsd, d.usdToSgd)}`, bg: CORE.amethystLight, fg: ROLE.blondeLt, bold: true }]),
    ...(u?.startedAt === undefined || isCompact ? [] : [{ text: `◷ ${sessionClock(d.now - u.startedAt)}`, bg: CORE.blueLight, fg: ROLE.text, drop: 2 }]),
    ...(d.inbox > 0 ? [{ text: `✉ ${d.inbox}`, bg: CORE.blonde, fg: CORE.abyss, bold: true }] : []),
    ...(email && !isCompact ? [accountSeg] : []),
  ]
  // The chevron opens the hint drawer under the prompt. It takes one cell, and
  // the brand segment brings its own leading space.
  const chevron = 1
  const [fitLeft, fitRight] = fitSegs(left, right, inner - chevron - 2 - MIN_RULE)
  const room = Math.max(0, inner - chevron - segWidth(fitLeft) - segWidth(fitRight) - 2)
  return (
    <Box key="header">
      <Button key="hint-toggle" label={d.isHintOpen ? '▾' : '▸'} plain onPress={d.onToggleHint} />
      {hoverGroup(T, 'brand', `${id?.model ?? 'model unknown'} · Claude Code ${id?.version ?? '?'} · ${id?.cwd ?? ''}`, zigzag(T, fitLeft))}
      <Text color={frameColor(d)}>{` ${RULE.repeat(room)} `}</Text>
      {fitRight.length > 0
        ? hoverGroup(T, 'cost', u?.costUsd === undefined ? 'session' : `US$${u.costUsd.toFixed(2)} this session`, mirrored(T, fitRight))
        : <Text />}
    </Box>
  )
}

// --- Account dropdown ------------------------------------------------------------

// The rows under the header while the account dropdown is open. pick lists
// the accounts, each with its Firefox profile. add takes a new account.
function accountRows(T: Table, d: BandData): RenderElement[] {
  const m = d.accountMenu
  if (m === null) return []
  const { Box, Text, Button } = T
  const Select = 'Select' in T ? T.Select : undefined
  const Input = 'Input' in T ? T.Input : undefined
  const current = d.identity?.email.toLowerCase() ?? ''
  const close = <Button key="account-close" label="close" hotkey="x" plain onPress={d.onAccounts} />
  if (Select === undefined || Input === undefined) {
    return [<Box key="account-rows" paddingX={1}><Text color={ROLE.muted}>This surface has no picker. Use a terminal or the desktop app.  </Text>{close}</Box>]
  }
  if (m.mode === 'pick') {
    const options = d.accounts.map(a => ({ value: a.email, label: `${a.email === current ? '● ' : '○ '}${accountLabel(a)}` }))
    const isKnown = d.accounts.some(a => a.email === current)
    return [
      <Box key="account-rows" paddingX={1}>
        <Text color={ROLE.emeraldLt} bold>{'⬢ account  '}</Text>
        {options.length > 0
          ? <Select key="account-pick" options={options} value={isKnown ? current : undefined} autoFocus onSelect={value => d.onPickAccount(value)} />
          : <Text color={ROLE.muted}>no accounts yet</Text>}
        {spaces(T, 3)}
        <Button key="account-add" label="new account" hotkey="n" plain onPress={d.onAddAccount} />
        {spaces(T, 3)}
        {close}
        {d.loginEmail === null ? <Text /> : <Text color={ROLE.warn} bold>{`   ◐ signing in as ${d.loginEmail}`}</Text>}
      </Box>,
    ]
  }
  const profileOptions = [
    ...d.profiles.map(p => ({ value: p.path, label: p.name })),
    { value: NEW_PROFILE, label: '+ new Firefox profile' },
  ]
  return [
    <Box key="account-rows" paddingX={1}>
      <Text color={ROLE.emeraldLt} bold>{'✚ new account  '}</Text>
      <Input key="account-email" placeholder="email" value={m.draftEmail} autoFocus submitLabel="next" onInput={value => d.onDraftEmail(value)} onSubmit={value => d.onDraftEmail(value)} />
      {spaces(T, 3)}
      <Select key="account-profile" label="firefox " options={profileOptions} value={m.draftProfile === '' ? undefined : m.draftProfile} onSelect={value => d.onDraftProfile(value)} />
      {spaces(T, 3)}
      <Button key="account-save" label="save" hotkey="s" plain onPress={d.onSaveAccount} />
      {spaces(T, 3)}
      <Button key="account-cancel" label="cancel" hotkey="x" plain onPress={d.onCancelAdd} />
    </Box>,
  ]
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
  if (u?.fiveHour) add(<Text color={fiveHourColor(u.fiveHour.percent)}>{`5h ${u.fiveHour.percent}%`}</Text>)
  if (u?.sevenDay) add(<Text color={sevenDayColor(u.sevenDay.percent)}>{`7d ${u.sevenDay.percent}%`}</Text>)
  if (u?.ctxPercent !== undefined) add(<Text color={ctxColor(u.ctxPercent, u.ctxTokens)}>{`ctx ${u.ctxPercent}%${isHandoffDue(u.ctxTokens) ? ' ⬢' : ''}`}</Text>)
  if (d.cacheView) add(<Text color={toneColor(d.cacheView.tone)}>{`${HOURGLASS} ${d.cacheView.label}`}</Text>)
  if (g) add(<Text color={ROLE.emeraldLt}>{`⎇ ${g.branch} +${g.insertions} -${g.deletions}`}</Text>)
  return bits.length === 0 ? null : <Box>{bits}</Box>
}

export function drawBand(T: Table, d: BandData): RenderElement {
  const { Box } = T
  const inner = Math.max(20, d.columns - RESERVE)
  if (d.columns < NARROW_COLUMNS) {
    const lines = [header(T, d, inner, true), compactLine(T, d)]
    return <Box flexDirection="column" marginTop={1}>{lines.filter((l): l is RenderElement => l !== null)}</Box>
  }
  // One empty row parts the band from the transcript above it. The drawer
  // slot under the header holds the account dropdown, or stays empty as a
  // spacer on a wide band.
  const menu = accountRows(T, d)
  const slot = menu.length > 0 ? menu : d.columns >= SPACER_COLUMNS ? [<Box key="drawer" height={1} />] : []
  return <Box flexDirection="column" marginTop={1}>{[header(T, d, inner, false), ...slot, ...ledgerRows(T, d, inner)]}</Box>
}
