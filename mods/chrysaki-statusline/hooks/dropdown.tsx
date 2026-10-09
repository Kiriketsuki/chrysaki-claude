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

const PANEL = CORE.surface
const LIFT = CORE.raised
const BAR_INK = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean] as const
// Powerline slants for the tab. Only the terminal has the Nerd Font.
const SLANT_IN = ''
const SLANT_OUT = ''
// Digits press the first nine accounts.
const MAX_KEYED = 9

// Lettering on a ground, guarded to 4.5:1.
function on(T: Table, text: string, fg: string, bg: string, bold?: boolean): RenderElement {
  const { Text } = T
  return <Text color={readableInk(fg, bg)} backgroundColor={bg} bold={bold}>{text}</Text>
}

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

function key(T: Table, k: string, label: string, onPress: () => void): RenderElement[] {
  const { Button, Text } = T
  return [<Text backgroundColor={PANEL}>{'   '}</Text>, <Button key={`account-${k === 'x' ? 'close' : k === 'n' ? 'add' : k === 's' ? 'save' : 'cancel'}`} hotkey={k} plain onPress={onPress}>{on(T, label, ROLE.sec, PANEL)}</Button>]
}

function pickRows(T: Table, d: BandData): RenderElement[] {
  const { Button, Text } = T
  const current = d.identity?.email.toLowerCase() ?? ''
  const n = d.accounts.length + 2
  const head = panelRow(T, 'account-head', 0, n, PANEL, [...tab(T, d, 'accounts'), ...key(T, 'n', 'new account', d.onAddAccount), ...key(T, 'x', 'close', d.onAccounts)])
  const width = Math.max(16, ...d.accounts.map(a => a.email.length)) + 2
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
      <Button key={`pick-${a.email}`} hotkey={i < MAX_KEYED ? String(i + 1) : undefined} plain onPress={() => d.onPickAccount(a.email)}>{body}</Button>,
      <Text backgroundColor={bg} />,
    ])
  })
  const empty = d.accounts.length === 0 ? [panelRow(T, 'account-none', 1, n, PANEL, [on(T, 'no accounts yet', ROLE.muted, PANEL)])] : []
  const hint = panelRow(T, 'account-hint', n - 1, n, PANEL, [on(T, 'press a number to sign in to that account through its Firefox profile', ROLE.muted, PANEL)])
  return [head, ...rows, ...empty, hint]
}

function addRows(T: Table, d: BandData): RenderElement[] {
  const { Button, Text } = T
  const m = d.accountMenu
  if (m === null) return []
  const n = 4
  const head = panelRow(T, 'account-head', 0, n, PANEL, [...tab(T, d, 'new account'), ...key(T, 's', 'save', d.onSaveAccount), ...key(T, 'x', 'cancel', d.onCancelAdd)])
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
      <Button key={`profile-${o.value}`} plain onPress={() => d.onDraftProfile(o.value)}>{on(T, ` ${o.label} `, isPicked ? ROLE.text : ROLE.sec, bg, isPicked)}</Button>,
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
