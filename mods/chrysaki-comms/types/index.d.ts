export type CommsDirection = 'in' | 'out'

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
    }
  }
}
