// Draws the git pane and the git band. Pure functions of the model: every
// change goes through the handlers in `Act`, which register.tsx supplies.

import type { Elements, RenderChildren, RenderSurface } from 'claude-code'

import type { GitDetail, GitFile, GitHead, GitLists, GitMode, GitTab } from '../types'
import { C, DIAMOND, EDGE, HEX, HEX_HOLLOW, branchColor, prettyGraph, stagedColor, unstagedColor } from './theme'

type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & Partial<Pick<Elements['terminal'], 'Input'>>

export type Model = {
  head: GitHead | null
  lists: GitLists | null
  tab: GitTab
  selected: string | null
  detail: GitDetail | null
  busy: string | null
  note: string | null
  mode: GitMode
  surface: RenderSurface
  columns: number
  spin: number
}

export type Act = {
  tab: (tab: GitTab) => void
  toggle: (f: GitFile) => void
  stageAll: () => void
  discard: (f: GitFile) => void
  startCommit: () => void
  commit: (message: string) => void
  startBranch: () => void
  branch: (name: string) => void
  cancel: () => void
  checkout: (name: string) => void
  push: () => void
  pull: () => void
  fetch: () => void
  stash: () => void
  pop: (ref: string) => void
  copy: (text: string) => void
  refresh: () => void
  close: () => void
  open: () => void
}

export const TABS: readonly { tab: GitTab; key: string; label: string }[] = [
  { tab: 'status', key: '1', label: 'status' },
  { tab: 'files', key: '2', label: 'files' },
  { tab: 'branches', key: '3', label: 'branches' },
  { tab: 'log', key: '4', label: 'log' },
  { tab: 'stash', key: '5', label: 'stash' },
]

export const rowKey = (tab: GitTab, id: string): string => `row:${tab}:${id}`

// --- Shared pieces ---------------------------------------------------------

const hasGlyphs = (m: { surface: RenderSurface }): boolean => m.surface === 'terminal'

// One island on the Abyss ground, edged the way the tmux window list is.
function island(ui: Ui, m: Model, index: number, isLast: boolean, bg: string, body: RenderChildren) {
  const { Box, Text } = ui
  if (!hasGlyphs(m)) return <Box backgroundColor={bg} paddingX={1}>{body}</Box>
  const isEven = index % 2 === 0
  const left = isEven ? EDGE.back : EDGE.forward
  const right = isLast ? EDGE.end : isEven ? EDGE.forward : EDGE.back
  return (
    <Box>
      <Text color={C.abyss} backgroundColor={bg}>{left}</Text>
      <Box backgroundColor={bg}>{body}</Box>
      <Text color={bg} backgroundColor={C.abyss}>{right}</Text>
    </Box>
  )
}

function badge(ui: Ui, m: Model, label: string) {
  const { Box, Text } = ui
  const isBusy = m.busy !== null
  const bg = isBusy ? C.blonde : C.emeraldLt
  const fg = isBusy ? C.abyss : C.text
  const hex = isBusy && m.spin % 2 === 1 ? HEX_HOLLOW : HEX
  return (
    <Box>
      <Text color={fg} backgroundColor={bg} bold> {hex} {isBusy ? `${m.busy}…` : label} </Text>
      {hasGlyphs(m) ? <Text color={bg} backgroundColor={C.abyss}>{EDGE.forward}</Text> : null}
    </Box>
  )
}

function counts(head: GitHead) {
  const staged = head.files.filter(f => !f.isUntracked && f.x !== '.').length
  const unstaged = head.files.filter(f => !f.isUntracked && f.y !== '.').length
  const untracked = head.files.filter(f => f.isUntracked).length
  return { staged, unstaged, untracked }
}

function shelf(ui: Ui, head: GitHead) {
  const { Box, Text } = ui
  const n = counts(head)
  return (
    <Box gap={1}>
      <Text color={branchColor(head.branch)} bold>{''} {head.branch}</Text>
      {head.upstream ? <Text color={C.text2}>↑{head.ahead} ↓{head.behind}</Text> : <Text color={C.muted}>no upstream</Text>}
      <Text color={C.border}>{DIAMOND}</Text>
      <Text color={C.emeraldLt}>●{n.staged}</Text>
      <Text color={C.blonde}>✚{n.unstaged}</Text>
      <Text color={C.muted}>?{n.untracked}</Text>
    </Box>
  )
}

// --- The band --------------------------------------------------------------

export function drawBand(ui: Ui, m: Model, act: Act) {
  const { Box, Button } = ui
  if (m.head === null) return null
  return (
    <Box gap={1}>
      {badge(ui, m, 'git')}
      {shelf(ui, m.head)}
      <Button key="git-open" label="open" hotkey="g" plain dimColor onPress={act.open} />
    </Box>
  )
}

// --- The pane --------------------------------------------------------------

export function drawPane(ui: Ui, m: Model, act: Act) {
  const { Box, Text } = ui
  if (m.head === null) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={C.muted}>This folder is not in a git repository.</Text>
        {optionsBar(ui, m, act)}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {tabStrip(ui, m, act)}
      <Box paddingX={1}>{shelf(ui, m.head)}</Box>
      {panel(ui, m, true, tabTitle(m), body(ui, m, act))}
      {m.mode === 'commit' || m.mode === 'branch' ? prompt(ui, m, act) : null}
      {m.detail !== null ? panel(ui, m, false, m.detail.title, detailBody(ui, m.detail)) : null}
      {m.note !== null ? <Box paddingX={1}><Text color={C.blondeLt} wrap="wrap">{m.note}</Text></Box> : null}
      {optionsBar(ui, m, act)}
    </Box>
  )
}

function tabStrip(ui: Ui, m: Model, act: Act) {
  const { Box, Button } = ui
  const isNarrow = m.columns < 70
  return (
    <Box backgroundColor={C.abyss}>
      {badge(ui, m, m.head?.repo ?? 'git')}
      {TABS.map((t, i) => {
        const isActive = t.tab === m.tab
        const bg = isActive ? C.raised : C.surface
        const label = isActive ? `${HEX} ${t.label}` : isNarrow ? '' : t.label
        const button = (
          <Button key={`tab-${t.tab}`} label={label || t.key} hotkey={t.key} plain dimColor={!isActive} onPress={() => act.tab(t.tab)} />
        )
        return <Box key={`island-${t.tab}`}>{island(ui, m, i, i === TABS.length - 1, bg, button)}</Box>
      })}
    </Box>
  )
}

// lazygit draws double borders: Emerald Lt on the focused panel, Border elsewhere.
function panel(ui: Ui, m: Model, isActive: boolean, title: string, content: RenderChildren) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={isActive ? C.emeraldLt : C.border} paddingX={1}>
      <Text color={isActive ? C.emeraldLt : C.text2} bold>{title}</Text>
      {content}
    </Box>
  )
}

function tabTitle(m: Model): string {
  const lists = m.lists
  if (m.tab === 'files') return `Files · ${m.head?.files.length ?? 0}`
  if (m.tab === 'branches') return `Branches · ${lists?.branches.length ?? 0}`
  if (m.tab === 'log') return 'Commits'
  if (m.tab === 'stash') return `Stash · ${lists?.stash.length ?? 0}`
  return 'Status'
}

function body(ui: Ui, m: Model, act: Act) {
  if (m.tab === 'files') return filesBody(ui, m, act)
  if (m.tab === 'branches') return branchesBody(ui, m, act)
  if (m.tab === 'log') return logBody(ui, m, act)
  if (m.tab === 'stash') return stashBody(ui, m, act)
  return statusBody(ui, m)
}

function marker(ui: Ui, isSelected: boolean) {
  const { Text } = ui
  return <Text color={isSelected ? C.emeraldLt : C.surface}>▌</Text>
}

function empty(ui: Ui, text: string) {
  const { Text } = ui
  return <Text color={C.muted}>{text}</Text>
}

function statusBody(ui: Ui, m: Model) {
  const { Box, Text } = ui
  const head = m.head as GitHead
  const n = counts(head)
  return (
    <Box flexDirection="column">
      <Text color={C.emeraldLt} bold>{HEX} {head.repo}</Text>
      <Text color={C.text2}>{head.root}</Text>
      <Text> </Text>
      <Text><Text color={C.muted}>branch   </Text><Text color={branchColor(head.branch)} bold>{head.branch}</Text></Text>
      <Text><Text color={C.muted}>upstream </Text><Text color={C.text2}>{head.upstream || 'none'}</Text></Text>
      <Text><Text color={C.muted}>head     </Text><Text color={C.text2}>{m.lists?.last ?? head.oid}</Text></Text>
      <Text><Text color={C.muted}>changes  </Text><Text color={C.emeraldLt}>{n.staged} staged</Text><Text color={C.muted}> · </Text><Text color={C.blonde}>{n.unstaged} unstaged</Text><Text color={C.muted}> · {n.untracked} untracked</Text></Text>
    </Box>
  )
}

function filesBody(ui: Ui, m: Model, act: Act) {
  const { Box, Text, Button } = ui
  const files = (m.head as GitHead).files
  if (files.length === 0) return empty(ui, 'Working tree clean.')
  return (
    <Box flexDirection="column">
      {files.map(f => {
        const key = rowKey('files', f.path)
        const xy = f.isUntracked ? '??' : f.isConflicted ? 'UU' : `${f.x}${f.y}`.replace(/\./g, ' ')
        return (
          <Box key={`f-${f.path}`}>
            {marker(ui, m.selected === key)}
            <Text color={f.isConflicted ? C.errorLt : f.isUntracked ? C.blonde : stagedColor(f.x)}>{xy[0]}</Text>
            <Text color={f.isConflicted ? C.errorLt : f.isUntracked ? C.blonde : unstagedColor(f.y)}>{xy[1]} </Text>
            <Button key={key} label={f.orig ? `${f.orig} → ${f.path}` : f.path} plain onPress={() => act.toggle(f)} />
          </Box>
        )
      })}
    </Box>
  )
}

function branchesBody(ui: Ui, m: Model, act: Act) {
  const { Box, Text, Button } = ui
  const branches = m.lists?.branches ?? []
  if (branches.length === 0) return empty(ui, 'Loading branches…')
  return (
    <Box flexDirection="column">
      {branches.map(b => {
        const key = rowKey('branches', b.name)
        return (
          <Box key={`b-${b.name}`} gap={1}>
            {marker(ui, m.selected === key)}
            <Text color={b.isHead ? C.emeraldLt : C.muted}>{b.isHead ? HEX : ' '}</Text>
            <Button key={key} label={b.name} plain onPress={() => act.checkout(b.name)} />
            {b.track ? <Text color={C.tealLt}>{b.track}</Text> : null}
            <Text color={C.muted}>{b.when}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function logBody(ui: Ui, m: Model, act: Act) {
  const { Box, Text, Button } = ui
  const log = m.lists?.log ?? []
  if (log.length === 0) return empty(ui, 'Loading commits…')
  return (
    <Box flexDirection="column">
      {log.map((c, i) => {
        if (c.hash === null) return <Text key={`g-${i}`} color={C.muted}>{prettyGraph(c.graph)}</Text>
        const key = rowKey('log', c.hash)
        return (
          <Box key={`c-${c.hash}`}>
            {marker(ui, m.selected === key)}
            <Text color={C.tealLt}>{prettyGraph(c.graph)}</Text>
            <Text color={C.blondeLt}>{c.hash} </Text>
            {c.refs ? <Text color={C.emeraldLt}>({c.refs}) </Text> : null}
            <Button key={key} label={c.subject} plain onPress={() => act.copy(c.hash ?? '')} />
          </Box>
        )
      })}
    </Box>
  )
}

function stashBody(ui: Ui, m: Model, act: Act) {
  const { Box, Text, Button } = ui
  const stash = m.lists?.stash ?? []
  if (stash.length === 0) return empty(ui, 'No stash entries. Press s to stash all changes.')
  return (
    <Box flexDirection="column">
      {stash.map(s => {
        const key = rowKey('stash', s.ref)
        return (
          <Box key={`s-${s.ref}`} gap={1}>
            {marker(ui, m.selected === key)}
            <Text color={C.tealLt}>{s.ref}</Text>
            <Button key={key} label={s.subject} plain onPress={() => act.pop(s.ref)} />
          </Box>
        )
      })}
    </Box>
  )
}

function prompt(ui: Ui, m: Model, act: Act) {
  const { Box, Text, Button } = ui
  const Input = ui.Input
  const isCommit = m.mode === 'commit'
  if (Input === undefined) return <Text color={C.muted}>This surface has no text field.</Text>
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={C.blonde} paddingX={1}>
      <Text color={C.blonde} bold>{isCommit ? 'Commit message' : 'New branch name'}</Text>
      <Input
        key={isCommit ? 'commit-msg' : 'branch-name'}
        placeholder={isCommit ? 'feat(scope): what changed' : 'feature/12-short-name'}
        submitLabel={isCommit ? 'commit' : 'create'}
        autoFocus
        onSubmit={value => (isCommit ? act.commit(value) : act.branch(value))}
      />
      <Button key="prompt-cancel" label="cancel" hotkey="x" plain dimColor onPress={act.cancel} />
    </Box>
  )
}

function lineColor(line: string): { color: string; bold?: boolean } {
  if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return { color: C.blondeLt, bold: true }
  if (line.startsWith('@@')) return { color: C.tealLt }
  if (line.startsWith('+')) return { color: C.emeraldLt }
  if (line.startsWith('-')) return { color: C.errorLt }
  if (line.startsWith('…')) return { color: C.muted }
  return { color: C.text2 }
}

function detailBody(ui: Ui, d: GitDetail) {
  const { Box, Text } = ui
  if (d.lines.every(l => l.trim().length === 0)) return <Text color={C.muted}>No changes to show.</Text>
  return (
    <Box flexDirection="column">
      {d.lines.map((line, i) => {
        const style = lineColor(line)
        return <Text key={`d-${i}`} color={style.color} bold={style.bold} wrap="truncate-end">{line.length > 0 ? line : ' '}</Text>
      })}
    </Box>
  )
}

// The lazygit options bar: each key a plain Button, so the hotkey works and
// the key shows in the accent colour.
function optionsBar(ui: Ui, m: Model, act: Act) {
  const { Box, Button } = ui
  const keys = optionKeys(m, act)
  return (
    <Box flexWrap="wrap" columnGap={2} paddingX={1}>
      {keys.map(k => <Button key={`opt-${k.key}`} label={k.label} hotkey={k.key} plain onPress={k.run} />)}
    </Box>
  )
}

function optionKeys(m: Model, act: Act): { key: string; label: string; run: () => void }[] {
  const selectedFile = m.tab === 'files' ? fileOf(m) : null
  const common = [
    { key: 'p', label: 'push', run: act.push },
    { key: 'l', label: 'pull', run: act.pull },
    { key: 'f', label: 'fetch', run: act.fetch },
    { key: 'r', label: 'refresh', run: act.refresh },
    { key: 'q', label: 'close', run: act.close },
  ]
  if (m.tab === 'files') {
    const discardLabel = m.mode === 'discard' ? 'confirm discard' : 'discard'
    const fileKeys = [
      { key: 'a', label: 'stage all', run: act.stageAll },
      { key: 'c', label: 'commit', run: act.startCommit },
      { key: 's', label: 'stash', run: act.stash },
    ]
    return selectedFile ? [...fileKeys, { key: 'd', label: discardLabel, run: () => act.discard(selectedFile) }, ...common] : [...fileKeys, ...common]
  }
  if (m.tab === 'branches') return [{ key: 'n', label: 'new branch', run: act.startBranch }, ...common]
  if (m.tab === 'stash') return [{ key: 's', label: 'stash', run: act.stash }, ...common]
  return [{ key: 'c', label: 'commit', run: act.startCommit }, ...common]
}

export function fileOf(m: Pick<Model, 'head' | 'selected'>): GitFile | null {
  const prefix = rowKey('files', '')
  if (m.head === null || m.selected === null || !m.selected.startsWith(prefix)) return null
  const path = m.selected.slice(prefix.length)
  return m.head.files.find(f => f.path === path) ?? null
}
