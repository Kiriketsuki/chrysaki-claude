// The state contract of chrysaki-lag, and the shapes the hooks share.

export type Psi = { avg10: number; avg60: number; avg300: number }
export type Resource = 'io' | 'memory' | 'cpu'
export type Pressure = Record<Resource, Psi>
export type Level = 'calm' | 'busy' | 'laggy'
export type Bound = Resource | 'none'

// Swap in KiB, with the zram share apart. A full zram spills to the disk.
export type Swap = { usedKb: number; totalKb: number; zramUsedKb: number; zramTotalKb: number }

// own: a process of this user, which a press stops. container: a Docker
// container, which a press stops. system: shown, never stopped.
export type CauseKind = 'own' | 'container' | 'system'

export type Cause = {
  key: string
  label: string
  detail: string
  score: number
  kind: CauseKind
  pid?: number
  start?: number
  comm?: string
  container?: string
}

// What the /lag pane draws.
export type LagView = {
  at: number
  level: Level
  bound: Bound
  pressure: Pressure
  swap: Swap
  causes: Cause[]
  // False when docker is missing or its daemon does not answer.
  hasDocker: boolean
  // The last result of a stop, or a read error.
  note: string | null
}

// A stop key pressed once. A second press within the confirm window stops it.
export type LagArmed = { key: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'chrysaki-lag': {
      view: LagView | null
      armed: LagArmed | null
      // Keys of the causes a stop runs for now.
      stopping: string[]
    }
  }
}
