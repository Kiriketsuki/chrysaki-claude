// Builds the band's tree from the collected values. No I/O happens here.
//
// The band is the Jewel Ledger. A header rule in the prompt's colour carries
// the brand run on the left and its mirror on the right. A drawer slot under
// it holds the account dropdown. The ledger below sets every figure on one
// grid, and a jewel badge opens each row. See ledger.tsx.

import type { RenderElement } from 'claude-code'

import type { AccountMenu, CacheView, FirefoxProfile, ShareOffer, StatuslineAccount, StatuslineLag, StatuslineWarn, StatuslineCache, StatuslineGit, StatuslineIdentity, StatuslineOutage, StatuslineRemote, StatuslineUsage, BandEntry } from '../types'
import { toneColor } from './cache'
import { ctxColor, isHandoffDue, sevenDayColor, usageColor } from './format'
import type { BarStyle } from './format'
import type { UsageHistory } from './history'
import { accountRows } from './dropdown'
import { CREST_COLUMNS, bandEmblem, captionRow, crestFolded, crestWidth, emblemColumn } from './crest'
import { drawDesktopBand } from './desktop-band'
import { AMBER_GROUND, fitSegs, header, headerPlan, modRow } from './header'
import { ledgerRows, ledgerRules } from './ledger'
import { packCells, paintCells } from './raster'
import { ROLE } from './palette'
import type { Table } from './prims'
import { isDesktop } from './prims-for'
import { ruleFrame, headerRulePaints } from './rules'

export type { Table } from './prims'
// The header code lives in header.tsx. These two stay importable from here.
export { AMBER_GROUND, fitSegs }

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
  // The height of one band row in CSS pixels. Only the desktop reads it, to
  // size its drawings to the code font's line.
  rowPx: number
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

// Below this width the terminal band folds to the header and one line. The
// desktop never folds.
export const NARROW_COLUMNS = 100
// The engine draws its collapse mark `[-]` over the last cells of the band's
// first row. That row is the blank top margin, so the header runs full width.
const RESERVE = 0
// The theme key of the prompt's rules. Text colours take a theme key.
const RULE_COLOR = 'promptBorder'
const HOURGLASS = '⧗'

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

export function drawBand(T: Table, d: BandData): RenderElement {
  const { Box } = T
  // The desktop draws its own tiers and never folds. See desktop-band.tsx.
  if (isDesktop(T, d)) return drawDesktopBand(T, d)
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
