import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register, SessionReceiveOrigin } from 'claude-code'

import type { CommsMessage, CommsView } from '../types'
import { appended, fromEvents, fromTranscript, merged, named, peers, received, sent, shown } from './log'
import type { TranscriptEvent } from './log'
import { parseSummaries, SUMMARY_SYSTEM, summaryPrompt, toSummarize, withSummaries } from './summary'
import { drawPane } from './view'
import type { Act } from './view'

const PANE = 'chrysaki-comms'
const DEFAULT_LIMIT = 200
const DEFAULT_MODEL = 'claude-haiku-5-5'
const READ_TIMEOUT_MS = 20_000
// One model call summarizes this many messages.
const BATCH = 10
const SUMMARY_TIMEOUT_MS = 30_000
// The reply cap: a short line for each message, and room for the JSON.
const TOKENS_PER_SUMMARY = 60
const TOKENS_BASE = 100

const live = atom({ plugin: 'chrysaki-comms', key: 'live' } as const, [] as CommsMessage[])
const history = atom({ plugin: 'chrysaki-comms', key: 'history' } as const, [] as CommsMessage[])
const filter = atom({ plugin: 'chrysaki-comms', key: 'filter' } as const, null as string | null)
const note = atom({ plugin: 'chrysaki-comms', key: 'note' } as const, null as string | null)
const view = atom({ plugin: 'chrysaki-comms', key: 'view' } as const, null as CommsView | null)
const follow = atom({ plugin: 'chrysaki-comms', key: 'follow' } as const, true)
const summaries = atom({ plugin: 'chrysaki-comms', key: 'summaries' } as const, {} as Record<string, string>)
const summarizing = atom({ plugin: 'chrysaki-comms', key: 'summarizing' } as const, false)
// Why the last summary call wrote nothing. A transcript read leaves it alone.
const summaryNote = atom({ plugin: 'chrysaki-comms', key: 'summaryNote' } as const, null as string | null)

// What the options set. register reads them once.
type Ctx = {
  limit: number
  // The model alias or id, or null when the summaryModel option is off.
  model: string | null
  startView: CommsView
}

// A reload restarts the module, so these start fresh. The pane then reads the
// transcript again at its next open.
let isPaneOpen = false
let isSummaryRunning = false
// The log length at the last follow. The pane scrolls only when it grows, so
// that a turn end with no new message keeps the place that you scrolled to.
let lastCount = 0
// The texts that a summary call failed for. The compact view shows their first
// line. A refresh tries them again.
const failed = new Set<string>()

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The deliveries that another session or agent wrote. A relay event, a trigger
// or a Remote Control prompt is not a message between sessions.
function peerOf(origin: SessionReceiveOrigin): string | null {
  if (origin.kind === 'peer' || origin.kind === 'peer-send-message') return 'teammate' in origin ? origin.teammate : 'peer'
  if (origin.kind === 'coordinator') return 'teammate' in origin ? origin.teammate : 'coordinator'
  return null
}

async function log($: EngineInterface): Promise<CommsMessage[]> {
  return named(merged(await read($, history), await read($, live)))
}

const viewOf = async ($: EngineInterface, ctx: Ctx): Promise<CommsView> => (await read($, view)) ?? ctx.startView

function whyNot(result: ModelCompleteResult): string {
  if (result.isAnswered) return 'the reply was not a JSON array of summaries'
  return result.reason === 'api-error' ? `API error ${result.status ?? 'with no response'} (${result.error})` : result.reason
}

// Asks the model for a summary of each long message that the compact view
// shows and that has none yet, in batches, the newest first. One call runs at a
// time. A failure leaves a note and stops until the next refresh.
async function summarize($: EngineInterface, ctx: Ctx): Promise<void> {
  if (ctx.model === null || isSummaryRunning || !isPaneOpen) return
  if ((await viewOf($, ctx)) !== 'compact') return
  isSummaryRunning = true
  try {
    for (;;) {
      const { messages } = shown(await log($), await read($, filter), ctx.limit)
      const asks = toSummarize(messages, await read($, summaries), failed, BATCH)
      if (asks.length === 0) return
      await update($, summarizing, () => true)
      const result = await $.model.complete({
        model: ctx.model,
        system: SUMMARY_SYSTEM,
        prompt: summaryPrompt(asks),
        maxTokens: TOKENS_BASE + TOKENS_PER_SUMMARY * asks.length,
        effort: 'low',
        timeoutMs: SUMMARY_TIMEOUT_MS,
      })
      const lines = result.isAnswered ? parseSummaries(result.text, asks.length) : null
      if (lines === null) {
        for (const ask of asks) failed.add(ask.key)
        await update($, summaryNote, () => `${ctx.model} wrote no summaries: ${whyNot(result)}. The pane shows the first line of each long message. Press r to try again.`)
        return
      }
      await update($, summaries, map => withSummaries(map, asks, lines))
      await update($, summaryNote, () => null)
    }
  } catch (error) {
    await update($, summaryNote, () => `The summary call failed: ${message(error)}`).catch(() => undefined)
  } finally {
    isSummaryRunning = false
    await update($, summarizing, () => false).catch(() => undefined)
  }
}

async function scrollToEnd($: EngineInterface): Promise<void> {
  await $.ui.scroll({ in: PANE, to: 'end' }).catch(() => undefined)
}

// Stops the end of the log from pulling the window down. A scroll to `end`
// keeps up with new rows until something else moves the window, so a pause
// pins the window to the last message that shows now.
async function holdPlace($: EngineInterface, ctx: Ctx): Promise<void> {
  const { messages, hidden } = shown(await log($), await read($, filter), ctx.limit)
  if (messages.length === 0) return
  await $.ui.scroll({ in: PANE, to: { key: `msg-${hidden + messages.length - 1}` }, block: 'end' }).catch(() => undefined)
}

// Runs after the log, the filter or the view changed. With follow on, the pane
// scrolls to the end when the log grew, or always when `force` is true. The
// end then keeps up with the rows until you scroll.
async function settle($: EngineInterface, ctx: Ctx, force: boolean): Promise<void> {
  if (!isPaneOpen) return
  const count = (await log($)).length
  const hasGrown = count > lastCount
  lastCount = count
  if ((force || hasGrown) && (await read($, follow))) void scrollToEnd($)
  void summarize($, ctx)
}

// A send or a receive must never fail for the log. A failed write drops the
// row and leaves a note. A .catch on the hook would call next a second time and
// could deliver the message twice, so the guard sits here.
async function record($: EngineInterface, ctx: Ctx, rows: () => Promise<CommsMessage[]>): Promise<void> {
  try {
    const more = await rows()
    await update($, live, list => appended(list, more))
    void settle($, ctx, false)
  } catch (error) {
    await update($, note, () => `A message was not logged: ${message(error)}`).catch(() => undefined)
  }
}

// Reads the transcript file through hooks/transcript.py. A transcript can be
// far over the 4 MiB that $.fs.read takes, so the script streams it.
async function fileRows($: EngineInterface): Promise<CommsMessage[]> {
  const id = await $.session.id()
  const home = await $.env.get('HOME')
  const dirs = [await $.env.get('CLAUDE_CONFIG_DIR'), home === undefined ? undefined : `${home}/.claude`]
    .filter((dir): dir is string => dir !== undefined && dir !== '')
  const ran = await $.process.run(['python3', `${$.plugin.root}/hooks/transcript.py`, id, ...dirs], { timeoutMs: READ_TIMEOUT_MS })
  if (ran.isStdoutTruncated) throw new Error('the transcript script wrote over 4 MiB')
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `the transcript script exited with ${ran.exitCode}`)
  return fromEvents(JSON.parse(ran.stdout) as TranscriptEvent[])
}

// Falls back to the conversation in Messages API form. That form starts at the
// last compaction summary and keeps no time on a message.
async function readHistory($: EngineInterface): Promise<void> {
  try {
    const rows = await fileRows($)
    await update($, history, () => rows)
    await update($, note, () => null)
    return
  } catch (error) {
    await update($, note, () => `The transcript file was not read (${message(error)}). The pane shows the conversation since the last compaction, with no times.`)
  }
  try {
    const rows = fromTranscript(await $.session.messages({ as: 'api' }))
    await update($, history, () => rows)
  } catch (error) {
    await update($, note, () => `Transcript read failed: ${message(error)}`)
  }
}

async function openPane($: EngineInterface, ctx: Ctx): Promise<void> {
  isPaneOpen = true
  const placed = await $.ui.open({ id: PANE, title: 'comms', focus: true, closeOnEscape: true })
  // A pane can open undrawn, for example on a narrow terminal. Say why, so
  // that /comms never does nothing in silence.
  if (!placed.isPlaced) $.ui.toast(`The comms pane is open but not drawn: ${placed.reason}`)
  await readHistory($)
  await settle($, ctx, true)
}

async function closePane($: EngineInterface): Promise<void> {
  isPaneOpen = false
  await $.ui.close({ id: PANE })
}

async function refresh($: EngineInterface, ctx: Ctx): Promise<void> {
  failed.clear()
  await update($, summaryNote, () => null)
  await readHistory($)
  await settle($, ctx, false)
}

function actions($: EngineInterface, ctx: Ctx): Act {
  return {
    filter: peer => void update($, filter, () => peer).then(() => settle($, ctx, true)),
    toggleView: () =>
      void viewOf($, ctx)
        .then(now => update($, view, () => (now === 'compact' ? 'verbose' : 'compact')))
        .then(() => settle($, ctx, true)),
    toggleFollow: () =>
      void update($, follow, isOn => !isOn)
        .then(() => read($, follow))
        .then(isOn => (isOn ? scrollToEnd($) : holdPlace($, ctx))),
    refresh: () => void refresh($, ctx),
    close: () => void closePane($),
  }
}

function contextOf(options: Record<string, unknown>): Ctx {
  const asked = Number(options.maxMessages ?? DEFAULT_LIMIT)
  const chosen = typeof options.summaryModel === 'string' ? options.summaryModel.trim() : DEFAULT_MODEL
  return {
    limit: Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_LIMIT,
    model: chosen === 'off' ? null : chosen === '' ? DEFAULT_MODEL : chosen,
    startView: options.view === 'verbose' ? 'verbose' : 'compact',
  }
}

export const register: Register = (on, options) => {
  const ctx = contextOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'comms', description: 'Open the log of messages to and from other Claude sessions', immediate: true })
    return next(e)
  })

  // `/comms orchestrator` shows one peer. `/comms all` or no argument shows every peer.
  on('command.run', { command: 'comms' }, async ($, e) => {
    const word = e.args.trim()
    await openPane($, ctx)
    if (word === '' || word === 'all') {
      await update($, filter, () => null)
      return {}
    }
    const known = peers(await log($))
    const match = known.find(peer => peer.toLowerCase() === word.toLowerCase())
    if (match === undefined) return { text: `No message to or from "${word}" yet. Peers: ${known.join(', ') || 'none'}.` }
    await update($, filter, () => match)
    await settle($, ctx, true)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false
    return next(e)
  })

  // Only the main conversation's messages. The transcript that the pane reads
  // back is the main conversation's too.
  on('session.send', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    let result
    try {
      result = await next(e)
    } catch (error) {
      await record($, ctx, async () => [sent(e.to, e.text, await $.clock.now(), message(error))])
      throw error
    }
    const failure = result.isDelivered ? null : result.reason
    await record($, ctx, async () => [sent(e.to, e.text, await $.clock.now(), failure)])
    return result
  })

  on('session.receive', async ($, e, next) => {
    const peer = e.agentId === undefined ? peerOf(e.origin) : null
    const result = await next(e)
    if (peer !== null && result.consumed === undefined) await record($, ctx, async () => received(e.text, await $.clock.now(), peer))
    return result
  })

  // A message delivered in the middle of a turn reaches the transcript later.
  // Read it again at the end of each turn while the pane shows.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (isPaneOpen && e.agentId === undefined) {
      await readHistory($)
      await settle($, ctx, false)
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    return drawPane(
      ui,
      {
        log: await log($),
        filter: await read($, filter),
        notes: [await read($, note), await read($, summaryNote)].filter((text): text is string => text !== null),
        limit: ctx.limit,
        view: await viewOf($, ctx),
        follow: await read($, follow),
        summaries: await read($, summaries),
        isSummarizing: await read($, summarizing),
      },
      actions($, ctx),
    )
  })
}
