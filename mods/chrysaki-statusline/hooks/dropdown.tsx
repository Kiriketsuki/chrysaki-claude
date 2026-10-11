// The account dropdown: a panel under the header. A gradient bar runs down
// its left edge and a parallelogram tab names it. pick lists the accounts,
// one numbered row each. add takes a new account, with the Firefox profiles
// as chips. No I/O happens here.

import type { RenderElement } from 'claude-code'

import { NEW_PROFILE } from './accounts'
import type { BandData } from './draw'
import { readableInk, sampleRamp } from './gradient'
import { CORE, ROLE } from './palette'
import type { Table } from './prims'
import { isDesktop, primsFor } from './prims-for'

const PANEL = CORE.surface
const LIFT = CORE.raised
const BAR_INK = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean] as const
// Powerline slants for the tab. Only the terminal has the Nerd Font.
const SLANT_IN = ''
const SLANT_OUT = ''
// Digits press the first nine accounts.
const MAX_KEYED = 9

// The cells of the edge bar and its space, before the body of a panel row.
const EDGE_CELLS = 2
// The fields after the email of a desktop pick row: firefox, profile, kind, state.
const FIREFOX_CELLS = 8
const PROFILE_CELLS = 19
const MIN_PROFILE_CELLS = 6
const KIND_CELLS = 12
const IN_USE_CELLS = 8
const SIGNING_CELLS = 15
// The hint under the account list, in full and in short.
const PICK_HINT = 'press a number to sign in to that account through its Firefox profile'
const PICK_HINT_SHORT = 'press a number to sign in'
const HINT_ROOM = 76

// Lettering on a ground, guarded to 4.5:1. The desktop wraps Text that does
// not fit, and a wrapped row breaks the line count of the band, so it cuts
// the text short instead. The terminal keeps its own wrapping.
function on(T: Table, text: string, fg: string, bg: string, bold?: boolean): RenderElement {
  const { Text } = T
  const wrap = 'Svg' in T ? ('truncate-end' as const) : undefined
  return <Text color={readableInk(fg, bg)} backgroundColor={bg} bold={bold} {...(wrap === undefined ? {} : { wrap })}>{text}</Text>
}

// The widths of the fields after the email on the desktop. A band that is too
// narrow for all of them drops the firefox label first, then shortens the
// profile. The state field holds the widest state any row can show.
export function pickFields(room: number, hasSigning: boolean): { firefox: number; profile: number; kind: number; state: number } {
  const state = hasSigning ? SIGNING_CELLS : IN_USE_CELLS
  const full = FIREFOX_CELLS + PROFILE_CELLS + KIND_CELLS + state
  if (full <= room) return { firefox: FIREFOX_CELLS, profile: PROFILE_CELLS, kind: KIND_CELLS, state }
  const profile = Math.max(MIN_PROFILE_CELLS, Math.min(PROFILE_CELLS, room - KIND_CELLS - state))
  return { firefox: 0, profile, kind: KIND_CELLS, state }
}

// The lines the open dropdown takes under the header. The panel is one Box
// that sets no height, so the band counts its rows from here.
export function accountLines(d: BandData): number {
  const m = d.accountMenu
  if (m === null) return 0
  if (m.mode !== 'pick') return ADD_LINES
  return d.accounts.length + 2 + (d.accounts.length === 0 ? 1 : 0)
}

// The head, the email row, the profile row and the hint of the add panel.
const ADD_LINES = 4

// One panel row: the edge bar in its place on the gradient, then the body.
function panelRow(T: Table, key: string, i: number, n: number, bg: string, body: RenderElement[]): RenderElement {
  const { Box, Text } = T
  return (
    <Box key={key} backgroundColor={bg}>
      <Text color={sampleRamp(BAR_INK, i / Math.max(1, n - 1))} backgroundColor={PANEL}>▌</Text>
      <Text backgroundColor={bg}> </Text>
      {body}
    </Box>
  )
}

// The tab: a parallelogram on the terminal, a plain chip elsewhere.
function tab(T: Table, d: BandData, text: string): RenderElement[] {
  const { Text } = T
  const chip = on(T, ` ${text} `, ROLE.text, CORE.emerald, true)
  if (d.surface !== 'terminal') return [chip]
  return [<Text color={CORE.emerald} backgroundColor={PANEL}>{SLANT_IN}</Text>, chip, <Text color={CORE.emerald} backgroundColor={PANEL}>{SLANT_OUT}</Text>]
}

function key(T: Table, d: BandData, k: string, label: string, onPress: () => void): RenderElement[] {
  const { Text } = T
  const id = `account-${k === 'x' ? 'close' : k === 'n' ? 'add' : k === 's' ? 'save' : 'cancel'}`
  return [<Text backgroundColor={PANEL}>{'   '}</Text>, primsFor(T, d).press({ key: id, label, hotkey: k, onPress, body: [on(T, label, ROLE.sec, PANEL)] })]
}

function pickRows(T: Table, d: BandData): RenderElement[] {
  const { Text } = T
  const P = primsFor(T, d)
  const current = d.identity?.email.toLowerCase() ?? ''
  const n = d.accounts.length + 2
  const head = panelRow(T, 'account-head', 0, n, PANEL, [...tab(T, d, 'accounts'), ...key(T, d, 'n', 'new account', d.onAddAccount), ...key(T, d, 'x', 'close', d.onAccounts)])
  const width = Math.max(16, ...d.accounts.map(a => a.email.length)) + 2
  const isDesk = isDesktop(T, d)
  const fields = pickFields(d.columns - EDGE_CELLS - 2 - width, d.loginEmail !== null && d.accounts.some(a => a.email === d.loginEmail))
  const rows = d.accounts.map((a, i) => {
    const isCurrent = a.email === current
    const bg = isCurrent ? LIFT : PANEL
    const mail = a.email.padEnd(width)
    const letters = isCurrent
      ? [...mail].map((ch, k) => on(T, ch, sampleRamp([ROLE.emeraldLt, ROLE.teal], k / Math.max(1, mail.length - 1)), bg, true))
      : [on(T, mail, ROLE.text, bg)]
    const body = [
      on(T, isCurrent ? '⬢ ' : '⬡ ', isCurrent ? ROLE.blondeLt : ROLE.muted, bg, isCurrent),
      ...letters,
      on(T, 'firefox ', ROLE.muted, bg),
      on(T, a.profile.padEnd(18), ROLE.sec, bg),
      a.isWork ? on(T, '◆ work', CORE.topaz, bg) : on(T, '◆ personal', ROLE.emeraldLt, bg),
      ...(isCurrent ? [on(T, '   in use', ROLE.emeraldLt, bg)] : []),
      ...(d.loginEmail === a.email ? [on(T, '   ◐ signing in…', ROLE.blondeLt, bg, true)] : []),
    ]
    return panelRow(T, `account-row-${i}`, i + 1, n, bg, [
      P.press({
        key: `pick-${a.email}`,
        label: a.email,
        hotkey: i < MAX_KEYED ? String(i + 1) : undefined,
        onPress: () => d.onPickAccount(a.email),
        body,
        // The desktop Button takes the email alone. The marker, the profile and
        // the kind sit in fixed columns, so each row lines up with the next.
        row: {
          bg,
          before: [{ width: 2, cells: [on(T, isCurrent ? '⬢' : '⬡', isCurrent ? ROLE.blondeLt : ROLE.muted, bg, isCurrent)] }],
          width,
          after: [
            ...(fields.firefox === 0 ? [] : [{ width: fields.firefox, cells: [on(T, 'firefox', ROLE.muted, bg)] }]),
            { width: fields.profile, cells: [on(T, a.profile, ROLE.sec, bg)] },
            { width: fields.kind, cells: [a.isWork ? on(T, '◆ work', CORE.topaz, bg) : on(T, '◆ personal', ROLE.emeraldLt, bg)] },
            ...(isCurrent ? [{ width: IN_USE_CELLS, cells: [on(T, 'in use', ROLE.emeraldLt, bg)] }] : []),
            ...(d.loginEmail === a.email ? [{ width: SIGNING_CELLS, cells: [on(T, '◐ signing in…', ROLE.blondeLt, bg, true)] }] : []),
          ],
        },
      }),
      <Text backgroundColor={bg} />,
    ])
  })
  const empty = d.accounts.length === 0 ? [panelRow(T, 'account-none', 1, n, PANEL, [on(T, 'no accounts yet', ROLE.muted, PANEL)])] : []
  const hintText = isDesk && d.columns < HINT_ROOM ? PICK_HINT_SHORT : PICK_HINT
  const hint = panelRow(T, 'account-hint', n - 1, n, PANEL, [on(T, hintText, ROLE.muted, PANEL)])
  return [head, ...rows, ...empty, hint]
}

function addRows(T: Table, d: BandData): RenderElement[] {
  const { Text } = T
  const P = primsFor(T, d)
  const m = d.accountMenu
  if (m === null) return []
  const n = 4
  const head = panelRow(T, 'account-head', 0, n, PANEL, [...tab(T, d, 'new account'), ...key(T, d, 's', 'save', d.onSaveAccount), ...key(T, d, 'x', 'cancel', d.onCancelAdd)])
  let field = on(T, 'this surface has no text field', ROLE.muted, PANEL)
  if ('Input' in T) {
    const { Input } = T
    field = <Input key="account-email" placeholder="email" value={m.draftEmail} autoFocus submitLabel="next" onInput={v => d.onDraftEmail(v)} onSubmit={v => d.onDraftEmail(v)} />
  }
  const options = [...d.profiles.map(p => ({ value: p.path, label: p.name })), { value: NEW_PROFILE, label: '+ new profile' }]
  const chips = options.flatMap(o => {
    const isPicked = m.draftProfile === o.value
    const bg = isPicked ? CORE.emerald : LIFT
    const ends = isPicked && d.surface === 'terminal'
    return [
      ...(ends ? [<Text color={CORE.emerald} backgroundColor={PANEL}>{SLANT_IN}</Text>] : []),
      P.press({
        key: `profile-${o.value}`,
        label: o.label,
        onPress: () => d.onDraftProfile(o.value),
        body: [on(T, ` ${o.label} `, isPicked ? ROLE.text : ROLE.sec, bg, isPicked)],
        // The desktop Button has no colour of its own. The picked chip shows
        // its marker and the Emerald ground around the Button instead.
        row: { bg, before: [{ width: 2, cells: [on(T, isPicked ? '⬢' : '⬡', isPicked ? ROLE.text : ROLE.muted, bg, isPicked)] }], after: [{ width: 1, cells: [] }] },
      }),
      ...(ends ? [<Text color={CORE.emerald} backgroundColor={PANEL}>{SLANT_OUT}</Text>] : []),
      <Text backgroundColor={PANEL}>{'  '}</Text>,
    ]
  })
  return [
    head,
    panelRow(T, 'account-email-row', 1, n, PANEL, [on(T, 'email    ', ROLE.muted, PANEL), field, on(T, '   work or personal is guessed from the domain', ROLE.muted, PANEL)]),
    panelRow(T, 'account-profiles', 2, n, PANEL, [on(T, 'firefox  ', ROLE.muted, PANEL), ...chips]),
    panelRow(T, 'account-add-hint', 3, n, PANEL, [on(T, 'the login page opens in the profile you pick', ROLE.muted, PANEL)]),
  ]
}

// The rows under the header while the dropdown is open, inside one keyed Box.
export function accountRows(T: Table, d: BandData): RenderElement[] {
  const m = d.accountMenu
  if (m === null) return []
  const { Box } = T
  const rows = m.mode === 'pick' ? pickRows(T, d) : addRows(T, d)
  return [<Box key={m.mode === 'pick' ? 'account-pick' : 'account-add-panel'} flexDirection="column">{rows}</Box>]
}
