import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionReceiveOrigin } from 'claude-code'

import type { CommsMessage } from '../types'
import { appended, fromEvents, fromTranscript, merged, named, peers, received, sent } from './log'
import type { TranscriptEvent } from './log'
import { drawPane } from './view'
import type { Act } from './view'

const PANE = 'chrysaki-comms'
const DEFAULT_LIMIT = 200
const READ_TIMEOUT_MS = 20_000

const live = atom({ plugin: 'chrysaki-comms', key: 'live' } as const, [] as CommsMessage[])
const history = atom({ plugin: 'chrysaki-comms', key: 'history' } as const, [] as CommsMessage[])
const filter = atom({ plugin: 'chrysaki-comms', key: 'filter' } as const, null as string | null)
const note = atom({ plugin: 'chrysaki-comms', key: 'note' } as const, null as string | null)

// A reload restarts the module, so this starts fresh. The pane then reads the
// transcript again at its next open.
let isPaneOpen = false

// The deliveries that another session or agent wrote. A relay event, a trigger
// or a Remote Control prompt is not a message between sessions.
function peerOf(origin: SessionReceiveOrigin): string | null {
  if (origin.kind === 'peer' || origin.kind === 'peer-send-message') return 'teammate' in origin ? origin.teammate : 'peer'
  if (origin.kind === 'coordinator') return 'teammate' in origin ? origin.teammate : 'coordinator'
  return null
}

// A send or a receive must never fail for the log. A failed write drops the
// row and leaves a note. A .catch on the hook would call next a second time and
// could deliver the message twice, so the guard sits here.
async function record($: EngineInterface, rows: () => Promise<CommsMessage[]>): Promise<void> {
  try {
    const more = await rows()
    await update($, live, list => appended(list, more))
  } catch (error) {
    await update($, note, () => `A message was not logged: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined)
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
    const why = error instanceof Error ? error.message : String(error)
    await update($, note, () => `The transcript file was not read (${why}). The pane shows the conversation since the last compaction, with no times.`)
  }
  try {
    const rows = fromTranscript(await $.session.messages({ as: 'api' }))
    await update($, history, () => rows)
  } catch (error) {
    await update($, note, () => `Transcript read failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function openPane($: EngineInterface): Promise<void> {
  isPaneOpen = true
  const placed = await $.ui.open({ id: PANE, title: 'comms', focus: true, closeOnEscape: true })
  // A pane can open undrawn, for example on a narrow terminal. Say why, so
  // that /comms never does nothing in silence.
  if (!placed.isPlaced) $.ui.toast(`The comms pane is open but not drawn: ${placed.reason}`)
  await readHistory($)
}

async function closePane($: EngineInterface): Promise<void> {
  isPaneOpen = false
  await $.ui.close({ id: PANE })
}

async function log($: EngineInterface): Promise<CommsMessage[]> {
  return named(merged(await read($, history), await read($, live)))
}

function actions($: EngineInterface): Act {
  return {
    filter: peer => void update($, filter, () => peer),
    refresh: () => void readHistory($),
    close: () => void closePane($),
  }
}

export const register: Register = (on, options) => {
  const asked = Number(options.maxMessages ?? DEFAULT_LIMIT)
  const limit = Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_LIMIT

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'comms', description: 'Open the log of messages to and from other Claude sessions', immediate: true })
    return next(e)
  })

  // `/comms orchestrator` shows one peer. `/comms all` or no argument shows every peer.
  on('command.run', { command: 'comms' }, async ($, e) => {
    const word = e.args.trim()
    await openPane($)
    if (word === '' || word === 'all') {
      await update($, filter, () => null)
      return {}
    }
    const known = peers(await log($))
    const match = known.find(peer => peer.toLowerCase() === word.toLowerCase())
    if (match === undefined) return { text: `No message to or from "${word}" yet. Peers: ${known.join(', ') || 'none'}.` }
    await update($, filter, () => match)
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
      await record($, async () => [sent(e.to, e.text, await $.clock.now(), error instanceof Error ? error.message : String(error))])
      throw error
    }
    const failure = result.isDelivered ? null : result.reason
    await record($, async () => [sent(e.to, e.text, await $.clock.now(), failure)])
    return result
  })

  on('session.receive', async ($, e, next) => {
    const peer = e.agentId === undefined ? peerOf(e.origin) : null
    const result = await next(e)
    if (peer !== null && result.consumed === undefined) await record($, async () => received(e.text, await $.clock.now(), peer))
    return result
  })

  // A message delivered in the middle of a turn reaches the transcript later.
  // Read it again at the end of each turn while the pane shows.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (isPaneOpen && e.agentId === undefined) await readHistory($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    return drawPane(ui, { log: await log($), filter: await read($, filter), note: await read($, note), limit }, actions($))
  })
}
