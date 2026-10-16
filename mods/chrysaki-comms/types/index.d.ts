export type CommsDirection = 'in' | 'out'

// How the pane draws the log.
export type CommsView =
  // One line for each message: a model summary of a long message.
  | 'compact'
  // The exact words of each message.
  | 'verbose'

// One message between this session and another session or agent.
export type CommsMessage = {
  direction: CommsDirection
  // The other side: a name, an agent id, or a uds: address. The pane names an
  // address after the from-name that a received message carried with it.
  peer: string
  // The uds: address that a received message came from, or null.
  address: string | null
  text: string
  // Milliseconds since the epoch, or null for a message read back from the
  // transcript, which keeps no time on a row.
  at: number | null
  // Why a send was not delivered, or null.
  failure: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'chrysaki-comms': {
      // The messages that the send and receive hooks saw, oldest first.
      live: CommsMessage[]
      // The messages read back from the transcript, oldest first.
      history: CommsMessage[]
      // The peer that the pane shows, or null for every peer.
      filter: string | null
      note: string | null
      // The view that a key chose, or null for the view option.
      view: CommsView | null
      // True while the pane scrolls to each new message.
      follow: boolean
      // The model summary of each long message, by summaryKey of its text.
      summaries: Record<string, string>
      // True while a summary call runs.
      summarizing: boolean
      // Why the last summary call wrote nothing, or null.
      summaryNote: string | null
    }
  }
}
