import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { GitDetail, GitHead, GitLists, GitMode, GitTab } from '../types'
import * as git from './git'
import type { Outcome, Run } from './git'
import { drawBand, drawPane } from './view'
import type { Act, Model } from './view'

const PANE = 'git-pane'

const head = atom({ plugin: 'git-pane', key: 'head' } as const, null as GitHead | null)
const lists = atom({ plugin: 'git-pane', key: 'lists' } as const, null as GitLists | null)
const tab = atom({ plugin: 'git-pane', key: 'tab' } as const, 'files' as GitTab)
const selected = atom({ plugin: 'git-pane', key: 'selected' } as const, null as string | null)
const detail = atom({ plugin: 'git-pane', key: 'detail' } as const, null as GitDetail | null)
const busy = atom({ plugin: 'git-pane', key: 'busy' } as const, null as string | null)
const note = atom({ plugin: 'git-pane', key: 'note' } as const, null as string | null)
const mode = atom({ plugin: 'git-pane', key: 'mode' } as const, 'browse' as GitMode)

// The module restarts on a reload, so this flag starts false again. The pane
// then reloads its lists on the next open, refresh or turn.
let isPaneOpen = false

function runner($: EngineInterface): Run {
  return (argv, init) => $.process.run(argv, init)
}

async function refresh($: EngineInterface, isFull: boolean): Promise<void> {
  const h = await git.loadHead(runner($))
  await update($, head, () => h)
  if (isFull && h !== null) {
    const l = await git.loadLists(runner($), h.root)
    await update($, lists, () => l)
  }
}

async function openPane($: EngineInterface): Promise<void> {
  isPaneOpen = true
  await $.ui.open({ id: PANE, title: 'git', focus: true, closeOnEscape: true })
  await refresh($, true)
}

async function closePane($: EngineInterface): Promise<void> {
  isPaneOpen = false
  await $.ui.close({ id: PANE })
}

// Runs one git write with the badge in its busy state, then reloads.
async function withBusy($: EngineInterface, label: string, work: (root: string) => Promise<Outcome>): Promise<void> {
  const h = await read($, head)
  if (h === null || (await read($, busy)) !== null) return
  await update($, busy, () => label)
  const outcome = await work(h.root)
  await update($, busy, () => null)
  await update($, note, () => (outcome.isOk ? outcome.text || `${label}: done.` : `${label} failed: ${outcome.text}`))
  if (!outcome.isOk) $.ui.toast(`git ${label} failed.`)
  await refresh($, true)
}

// The commit goes through the Bash tool, so that tool hooks such as
// kilint-gate check the message as they check any commit Claude runs.
async function commit($: EngineInterface, message: string): Promise<void> {
  const h = await read($, head)
  const text = message.trim()
  if (h === null || text.length === 0) return
  await update($, busy, () => 'commit')
  const command = `git -C ${git.shQuote(h.root)} commit -m ${git.shQuote(text)}`
  const r = await $.tool.call({ tool: 'Bash', command, description: 'Commit from the git pane' })
  await update($, busy, () => null)
  if (r.deny !== undefined) {
    await update($, note, () => r.deny ?? null)
    $.ui.toast('The commit was refused. The pane shows why.')
    return
  }
  await update($, mode, () => 'browse')
  await update($, note, () => (r.isError === true ? `commit failed: ${String(r.text ?? '')}` : 'Committed.'))
  await refresh($, true)
}

async function select($: EngineInterface, key: string): Promise<void> {
  await update($, selected, () => key)
  const h = await read($, head)
  if (h === null) return
  const run = runner($)
  const [, kind = '', ...rest] = key.split(':')
  const id = rest.join(':')
  let d: GitDetail | null = null
  if (kind === 'files') {
    const f = h.files.find(x => x.path === id)
    if (f !== undefined) d = await git.fileDiff(run, h.root, f)
  }
  if (kind === 'log') d = await git.commitDiff(run, h.root, id)
  if (kind === 'branches') d = await git.branchLog(run, h.root, id)
  if (kind === 'stash') d = await git.stashDiff(run, h.root, id)
  // A later focus move wins. Drop this diff when the selection moved on.
  if ((await read($, selected)) === key) await update($, detail, () => d)
}

async function switchTab($: EngineInterface, t: GitTab): Promise<void> {
  await update($, tab, () => t)
  await update($, selected, () => null)
  await update($, detail, () => null)
  await update($, mode, () => 'browse')
  if ((await read($, lists)) === null) await refresh($, true)
}

async function discardFile($: EngineInterface, run: Run, f: Parameters<Act['discard']>[0]): Promise<void> {
  if ((await read($, mode)) !== 'discard') {
    await update($, mode, () => 'discard')
    await update($, note, () => `Press d again to discard ${f.path}. This cannot be undone.`)
    return
  }
  await update($, mode, () => 'browse')
  await withBusy($, 'discard', root => git.discard(run, root, f))
}

async function stageEverything($: EngineInterface, run: Run): Promise<void> {
  const h = await read($, head)
  if (h !== null) await withBusy($, 'stage all', root => git.stageAll(run, root, h.files))
}

async function createBranch($: EngineInterface, run: Run, name: string): Promise<void> {
  await update($, mode, () => 'browse')
  if (name.trim().length > 0) await withBusy($, 'branch', root => git.newBranch(run, root, name.trim()))
}

async function cancelPrompt($: EngineInterface): Promise<void> {
  await update($, mode, () => 'browse')
  await update($, note, () => null)
}

async function pushBranch($: EngineInterface, run: Run): Promise<void> {
  const h = await read($, head)
  await withBusy($, 'push', root => git.push(run, root, (h?.upstream ?? '') !== ''))
}

async function copyText($: EngineInterface, text: string, surface: RenderSurface): Promise<void> {
  const r = await $.ui.copy({ text, surface })
  $.ui.toast(r.isCopied ? `Copied ${text}.` : 'Copy is not available here.')
}

function actions($: EngineInterface, surface: RenderSurface): Act {
  const run = runner($)
  return {
    tab: t => void switchTab($, t),
    toggle: f => void withBusy($, 'stage', root => git.toggleStage(run, root, f)),
    stageAll: () => void stageEverything($, run),
    discard: f => void discardFile($, run, f),
    startCommit: () => void update($, mode, () => 'commit'),
    commit: message => void commit($, message),
    startBranch: () => void update($, mode, () => 'branch'),
    branch: name => void createBranch($, run, name),
    cancel: () => void cancelPrompt($),
    checkout: name => void withBusy($, 'switch', root => git.checkout(run, root, name)),
    push: () => void pushBranch($, run),
    pull: () => void withBusy($, 'pull', root => git.pull(run, root)),
    fetch: () => void withBusy($, 'fetch', root => git.fetch(run, root)),
    stash: () => void withBusy($, 'stash', root => git.stashPush(run, root)),
    pop: ref => void withBusy($, 'pop', root => git.stashPop(run, root, ref)),
    copy: text => void copyText($, text, surface),
    refresh: () => void refresh($, true),
    close: () => void closePane($),
    open: () => void openPane($),
  }
}

async function model($: EngineInterface, surface: RenderSurface, columns: number): Promise<Model> {
  return {
    head: await read($, head),
    lists: await read($, lists),
    tab: await read($, tab),
    selected: await read($, selected),
    detail: await read($, detail),
    busy: await read($, busy),
    note: await read($, note),
    mode: await read($, mode),
    surface,
    columns,
    spin: 0,
  }
}

export const register: Register = (on, options) => {
  const showBand = options.showBand !== false
  const pollMs = Math.max(0, Number(options.pollSeconds ?? 15)) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'git', description: 'Open the git pane', immediate: true })
    await refresh($, false)
    if (pollMs > 0) $.clock.every(pollMs, () => void refresh($, isPaneOpen))
    return next(e)
  })

  on('command.run', { command: 'git' }, async $ => {
    await openPane($)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false
    return next(e)
  })

  on('ui.focus', async ($, e, next) => {
    const result = await next(e)
    if (e.requestId === PANE && e.element?.startsWith('row:') === true) await select($, e.element)
    return result
  })

  // Claude edits and commits too. Reload once a turn ends, and after each
  // Bash call that runs git, so the band shows the real state.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($, isPaneOpen)
    return done
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgit\b/.test(e.command)) await refresh($, isPaneOpen)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const m = await model($, e.surface, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    return drawPane(ui, m, actions($, e.surface))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!showBand || e.props.hasSurvey) return next(e)
    // The chrysaki-statusline mod already draws a git line with a g key that
    // opens this pane. A second git line would repeat it.
    if ((await $.env.get('CHRYSAKI_STATUSLINE_MOD')) === '1') return next(e)
    const below = await next(e)
    const ui = $.ui.resolve(e)
    const m = await model($, e.surface, e.props.bodyColumns)
    const mine = drawBand(ui, m, actions($, e.surface))
    if (mine === null) return below
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {below ?? null}
        {mine}
      </Box>
    )
  })
}
