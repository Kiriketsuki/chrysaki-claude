import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { InsightAgent, InsightContext, InsightTab, InsightTool, InsightTurn } from '../types'
import { addAgentUsage, capped, contextFrom, endAgent, finishTool, hasRunning, startTool, summarizeInput, touchAgent, turnRow } from './records'
import type { AgentInfo } from './records'
import { drawPane, isTab } from './view'
import type { Act, Model } from './view'

const PANE = 'chrysaki-insight'

const tab = atom({ plugin: 'chrysaki-insight', key: 'tab' } as const, 'context' as InsightTab)
const context = atom({ plugin: 'chrysaki-insight', key: 'context' } as const, null as InsightContext | null)
const turns = atom({ plugin: 'chrysaki-insight', key: 'turns' } as const, [] as InsightTurn[])
const tools = atom({ plugin: 'chrysaki-insight', key: 'tools' } as const, [] as InsightTool[])
const agents = atom({ plugin: 'chrysaki-insight', key: 'agents' } as const, [] as InsightAgent[])
const cost = atom({ plugin: 'chrysaki-insight', key: 'cost' } as const, null as number | null)
const note = atom({ plugin: 'chrysaki-insight', key: 'note' } as const, null as string | null)

// A reload restarts the module, so these start fresh. The pane then waits for
// its next open or event before it works again. State that a drawing needs
// lives in $.state instead.
let isPaneOpen = false
let isReading = false
let lastColumns = 80
let ticker: Timer | null = null
let tickCount = 0

// The context breakdown counts tokens with the token-count API, so it runs only
// when the context tab shows. The cost-only read is cheap and runs for the rest.
async function refreshContext($: EngineInterface, isFull: boolean): Promise<void> {
  if (isReading) return
  isReading = true
  try {
    const usage = isFull ? await $.session.usage({ breakdown: 'full', columns: lastColumns }) : await $.session.usage()
    await update($, cost, () => usage.cost?.usd ?? null)
    const breakdown = usage.context.breakdown
    if (breakdown !== undefined) {
      const at = await $.clock.now()
      await update($, context, () => contextFrom(breakdown, at))
      await update($, note, () => null)
    } else if (isFull) {
      await update($, note, () => 'The engine gave no context breakdown yet.')
    }
  } catch (error) {
    await update($, note, () => `Context read failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    isReading = false
  }
}

// The one-second redraw runs only while the pane shows the activity tab and an
// item runs. Any other state cancels it, so a closed pane costs no timer.
async function syncTicker($: EngineInterface): Promise<void> {
  const isWanted = isPaneOpen && (await read($, tab)) === 'activity' && hasRunning(await read($, tools), await read($, agents))
  if (isWanted && ticker === null) {
    ticker = $.clock.every(1000, () => {
      $.ui.invalidate('ui.render')
      tickCount += 1
      void (tickCount % 5 === 0 ? reconcileAgents($) : Promise.resolve()).then(() => syncTicker($))
    })
  } else if (!isWanted && ticker !== null) {
    ticker.cancel()
    ticker = null
    tickCount = 0
  }
}

// A killed subagent may never raise its turn.complete. The agent list knows
// its status, so close any running record that the list shows as finished.
async function reconcileAgents($: EngineInterface): Promise<void> {
  const open = (await read($, agents)).filter(a => a.end === null)
  if (open.length === 0) return
  const listed = await $.agent.list()
  const now = await $.clock.now()
  for (const a of open) {
    const info = listed.find(x => x.id === a.id)
    if (info !== undefined && info.status !== 'running') {
      await update($, agents, list => endAgent(list, a.id, now, info.status !== 'completed'))
    }
  }
}

async function openPane($: EngineInterface, wanted: InsightTab | null): Promise<void> {
  isPaneOpen = true
  if (wanted !== null) await update($, tab, () => wanted)
  const placed = await $.ui.open({ id: PANE, title: 'insight', focus: true, closeOnEscape: true })
  // A pane can open undrawn, for example on a narrow terminal. Say why, so
  // that /insight never does nothing in silence.
  if (!placed.isPlaced) $.ui.toast(`The insight pane is open but not drawn: ${placed.reason}`)
  await refreshContext($, (await read($, tab)) === 'context')
  await syncTicker($)
}

async function closePane($: EngineInterface): Promise<void> {
  isPaneOpen = false
  await $.ui.close({ id: PANE })
  await syncTicker($)
}

async function switchTab($: EngineInterface, t: InsightTab): Promise<void> {
  await update($, tab, () => t)
  if (t === 'context') await refreshContext($, true)
  await syncTicker($)
}

async function agentInfo($: EngineInterface, id: string): Promise<AgentInfo> {
  if ((await read($, agents)).some(a => a.id === id)) return {}
  const found = (await $.agent.list()).find(a => a.id === id)
  return found === undefined ? {} : { label: found.description, type: found.type }
}

function actions($: EngineInterface): Act {
  return {
    tab: t => void switchTab($, t),
    refresh: () => void refreshContext($, true),
    close: () => void closePane($),
  }
}

async function model($: EngineInterface, surface: Model['surface'], columns: number): Promise<Model> {
  return {
    tab: await read($, tab),
    context: await read($, context),
    turns: await read($, turns),
    tools: await read($, tools),
    agents: await read($, agents),
    cost: await read($, cost),
    note: await read($, note),
    surface,
    columns,
    now: await $.clock.now(),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'insight', description: 'Open the session insight pane: context, turns, activity', immediate: true })
    return next(e)
  })

  // `/insight turns` opens on that tab. No argument keeps the tab last shown.
  on('command.run', { command: 'insight' }, async ($, e) => {
    const word = e.args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    await openPane($, isTab(word) ? word : null)
    if (word !== '' && !isTab(word)) return { text: `No insight tab named "${word}". Use context, turns or activity.` }
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isPaneOpen = false
      await syncTicker($)
    }
    return next(e)
  })

  // Source of the turns tab. A subagent's request adds to its own record and
  // never to the main-thread list.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    if (e.agentId === undefined) {
      if (result.usage !== null) {
        const usage = result.usage
        await update($, turns, list => capped(list, turnRow(`${result.turnId}:${result.index}`, startedAt, usage.model, usage)))
      }
    } else {
      const id = e.agentId
      const info = await agentInfo($, id)
      await update($, agents, list => addAgentUsage(touchAgent(list, id, startedAt, info), id, result.usage))
      await syncTicker($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) {
      const id = e.agentId
      const now = await $.clock.now()
      const info = await agentInfo($, id)
      const isFailed = e.reason === 'error' || e.reason === 'aborted' || e.reason === 'refusal'
      await update($, agents, list => endAgent(touchAgent(list, id, now - e.durationMs, info), id, now, isFailed))
    } else if (isPaneOpen) {
      await refreshContext($, (await read($, tab)) === 'context')
    }
    await syncTicker($)
    return done
  })

  on('tool.call', async ($, e, next) => {
    const start = await $.clock.now()
    const id = e.tool_use_id
    const row: InsightTool = {
      id,
      name: String(e.tool),
      summary: summarizeInput(e as unknown as Record<string, unknown>),
      agentId: e.agentId ?? null,
      start,
      end: null,
      isFailed: false,
    }
    await update($, tools, list => startTool(list, row))
    await syncTicker($)
    let isFailed = true
    try {
      const ran = await next(e)
      isFailed = ran.deny !== undefined || ran.isError === true
      return ran
    } finally {
      const end = await $.clock.now()
      await update($, tools, list => finishTool(list, id, end, isFailed))
      await syncTicker($)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    lastColumns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const m = await model($, e.surface, lastColumns)
    return drawPane(ui, m, actions($))
  })
}
