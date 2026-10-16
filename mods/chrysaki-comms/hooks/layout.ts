// Splits the shown messages into the lines that the pane draws: a line for
// each new day, and a header for each run of messages from one peer.

import type { CommsMessage } from '../types'

// Two messages from one peer in this window share one header.
export const RUN_GAP_MS = 5 * 60_000

export type Item =
  | { kind: 'day'; label: string }
  | { kind: 'message'; message: CommsMessage; index: number; isRunStart: boolean }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayLabel(at: number): string {
  const d = new Date(at)
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

const dayOf = (at: number): string => new Date(at).toDateString()

// `first` is the index of the first message in the whole filtered log, so
// that each message keeps one key while earlier ones drop off.
export function layout(messages: readonly CommsMessage[], first: number): Item[] {
  const items: Item[] = []
  let previous: CommsMessage | null = null
  let lastDay: string | null = null
  messages.forEach((message, i) => {
    const day = message.at === null ? null : dayOf(message.at)
    const isNewDay = day !== null && day !== lastDay
    if (isNewDay && message.at !== null) items.push({ kind: 'day', label: dayLabel(message.at) })
    if (day !== null) lastDay = day
    const isSameSide = previous !== null && previous.direction === message.direction && previous.peer === message.peer
    const isClose = previous?.at != null && message.at !== null && message.at - previous.at <= RUN_GAP_MS
    const isUntimed = previous !== null && previous.at === null && message.at === null
    items.push({ kind: 'message', message, index: first + i, isRunStart: isNewDay || !isSameSide || !(isClose || isUntimed) })
    previous = message
  })
  return items
}
