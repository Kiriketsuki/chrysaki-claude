// Pure functions that build the message log. register.tsx feeds them the
// transcript rows and the live send and receive events.

import type { CommsMessage } from '../types'

// The envelope that a delivery from another session carries, as the engine
// writes it: <cross-session-message from="uds:..." from-name="orchestrator">.
const ENVELOPE = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/g
const ATTRIBUTE = /([\w-]+)="([^"]*)"/g

export type Envelope = { from: string; name: string | null; body: string }

export function envelopes(text: string): Envelope[] {
  return [...text.matchAll(ENVELOPE)].map(match => {
    const attributes = new Map([...(match[1] ?? '').matchAll(ATTRIBUTE)].map(a => [a[1] ?? '', a[2] ?? '']))
    return { from: attributes.get('from') ?? '', name: attributes.get('from-name') ?? null, body: (match[2] ?? '').trim() }
  })
}

// The peer of an envelope: its from-name when it has one, else its address.
const peerOf = (envelope: Envelope): string => envelope.name ?? envelope.from

const fromEnvelope = (envelope: Envelope, at: number | null): CommsMessage => ({
  direction: 'in',
  peer: peerOf(envelope),
  address: envelope.from === '' ? null : envelope.from,
  text: envelope.body,
  at,
  failure: null,
})

// A delivery with no envelope, such as a teammate's, takes the peer that the
// receive hook names.
export function received(text: string, at: number | null, fallbackPeer: string): CommsMessage[] {
  const found = envelopes(text)
  if (found.length === 0) return [{ direction: 'in', peer: fallbackPeer, address: null, text: text.trim(), at, failure: null }]
  return found.map(envelope => fromEnvelope(envelope, at))
}

export function sent(to: string, text: string, at: number | null, failure: string | null): CommsMessage {
  return { direction: 'out', peer: to, address: null, text: text.trim(), at, failure }
}

// One message in Messages API form, as `$.session.messages({ as: 'api' })`
// gives it. The row form leaves out a meta row, and a peer message that the
// person approved after a hold is one.
export type ApiBlock = { type: string; [field: string]: unknown }
export type ApiMessage = { role: 'user' | 'assistant'; content: ApiBlock[] }

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(block => (typeof block?.text === 'string' ? block.text : '')).join('\n')
      : ''

// Reads the log back from the conversation: each received envelope in a user
// text block, and each SendMessage call with a text message. A send whose
// tool result is an error carries that text as its failure.
export function fromTranscript(messages: readonly ApiMessage[]): CommsMessage[] {
  const errors = new Map<string, string>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_result' && block.is_error === true) errors.set(String(block.tool_use_id), textOf(block.content) || 'not delivered')
    }
  }
  return messages.flatMap(message =>
    message.content.flatMap(block => {
      if (message.role === 'user' && block.type === 'text' && typeof block.text === 'string') {
        return envelopes(block.text).map(envelope => fromEnvelope(envelope, null))
      }
      const input = block.input as { to?: unknown; message?: unknown } | undefined
      if (message.role === 'assistant' && block.type === 'tool_use' && block.name === 'SendMessage' && typeof input?.message === 'string') {
        return [sent(String(input.to), input.message, null, errors.get(String(block.id)) ?? null)]
      }
      return []
    }),
  )
}

// One event that hooks/transcript.py prints from the transcript file.
export type TranscriptEvent =
  | { kind: 'in'; at: number | null; text: string }
  | { kind: 'out'; at: number | null; id: string; to: string; message: string }
  | { kind: 'error'; id: string; text: string }

// The transcript file keeps a time on each row, every row from before a
// compaction, and each message delivered in the middle of a turn.
export function fromEvents(events: readonly TranscriptEvent[]): CommsMessage[] {
  const errors = new Map<string, string>()
  for (const e of events) if (e.kind === 'error') errors.set(e.id, e.text || 'not delivered')
  return events.flatMap(e => {
    if (e.kind === 'in') return envelopes(e.text).map(envelope => fromEnvelope(envelope, e.at))
    if (e.kind === 'out') return [sent(e.to, e.message, e.at, errors.get(e.id) ?? null)]
    return []
  })
}

const keyOf = (m: CommsMessage): string => `${m.direction}\n${m.peer}\n${m.text}`

// The transcript holds the live messages too, after the hooks saw them. Each
// live message drops one matching history row, and the rest of the history
// comes first, since it predates the module load.
export function merged(history: readonly CommsMessage[], live: readonly CommsMessage[]): CommsMessage[] {
  const pending = new Map<string, number>()
  for (const m of live) pending.set(keyOf(m), (pending.get(keyOf(m)) ?? 0) + 1)
  const older = history.filter(m => {
    const count = pending.get(keyOf(m)) ?? 0
    if (count === 0) return true
    pending.set(keyOf(m), count - 1)
    return false
  })
  const all = [...older, ...live]
  // With a time on every message, time orders them. A message that the hooks
  // never saw, such as one approved after a hold, then lands in its place.
  return all.every(m => m.at !== null) ? all.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)) : all
}

// Names each uds: address after the from-name that a received message carried
// with it, so that a reply sent to an address joins the thread of the name.
export function named(log: readonly CommsMessage[]): CommsMessage[] {
  const names = new Map<string, string>()
  for (const m of log) if (m.address !== null && m.peer !== m.address) names.set(m.address, m.peer)
  return log.map(m => ({ ...m, peer: names.get(m.peer) ?? m.peer }))
}

// The peers, the latest exchange first.
export function peers(log: readonly CommsMessage[]): string[] {
  const order: string[] = []
  for (const m of [...log].reverse()) if (!order.includes(m.peer)) order.push(m.peer)
  return order
}

export function shown(log: readonly CommsMessage[], filter: string | null, limit: number): { messages: CommsMessage[]; hidden: number } {
  const matching = filter === null ? log : log.filter(m => m.peer === filter)
  const messages = matching.slice(Math.max(0, matching.length - limit))
  return { messages, hidden: matching.length - messages.length }
}

// Keeps the live list bounded. A long session can exchange thousands of messages.
export const LIVE_CAP = 2000

export function appended(list: readonly CommsMessage[], more: readonly CommsMessage[]): CommsMessage[] {
  const next = [...list, ...more]
  return next.slice(Math.max(0, next.length - LIVE_CAP))
}
