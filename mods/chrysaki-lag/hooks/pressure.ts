// The lag verdict. Linux pressure stall information (PSI) gives the share of
// time some task waited on a resource. That share is the lag a person feels.
// A CPU percentage misses lag from the disk and from memory. No I/O happens
// here.

import type { Bound, Level, Pressure, Psi, Resource, Swap } from '../types'

export type { Bound, Level, Pressure, Psi, Resource, Swap }

// The avg10 share, in percent, at which a resource makes the machine busy or
// laggy. The options in plugin.json set them.
export type Thresholds = { busy: number; io: number; memory: number; cpu: number }

export const DEFAULT_THRESHOLDS: Thresholds = { busy: 10, io: 25, memory: 15, cpu: 40 }

export type Verdict = {
  level: Level
  bound: Bound
  // True when the avg60 share is laggy too, so the lag is not a short spike.
  isSustained: boolean
}

const ZERO: Psi = { avg10: 0, avg60: 0, avg300: 0 }

// The `some` line of one /proc/pressure file.
export function parsePsi(text: string): Psi {
  const line = text.split('\n').find(l => l.startsWith('some ')) ?? ''
  const value = (key: string) => {
    const m = new RegExp(`${key}=([0-9.]+)`).exec(line)
    return m === null ? 0 : Number(m[1])
  }
  return line === '' ? ZERO : { avg10: value('avg10'), avg60: value('avg60'), avg300: value('avg300') }
}

export function parsePressure(texts: Record<Resource, string>): Pressure {
  return { io: parsePsi(texts.io), memory: parsePsi(texts.memory), cpu: parsePsi(texts.cpu) }
}

// /proc/swaps: the zram rows and the rest. Sizes are in KiB.
export function parseSwaps(text: string): Swap {
  const out: Swap = { usedKb: 0, totalKb: 0, zramUsedKb: 0, zramTotalKb: 0 }
  for (const line of text.split('\n').slice(1)) {
    const [name, , size, used] = line.trim().split(/\s+/)
    if (name === undefined || size === undefined || used === undefined) continue
    const s = Number(size)
    const u = Number(used)
    if (!Number.isFinite(s) || !Number.isFinite(u)) continue
    out.totalKb += s
    out.usedKb += u
    if (name.startsWith('/dev/zram')) {
      out.zramTotalKb += s
      out.zramUsedKb += u
    }
  }
  return out
}

// io and memory stalls freeze the desktop, so they weigh more than cpu.
const WEIGHT: Record<Resource, number> = { io: 1, memory: 1.2, cpu: 0.6 }
const RESOURCES: readonly Resource[] = ['io', 'memory', 'cpu']

export function verdict(p: Pressure, t: Thresholds): Verdict {
  const isLaggy = RESOURCES.some(r => p[r].avg10 >= t[r])
  const isBusy = RESOURCES.some(r => p[r].avg10 >= t.busy)
  const level: Level = isLaggy ? 'laggy' : isBusy ? 'busy' : 'calm'
  if (level === 'calm') return { level, bound: 'none', isSustained: false }
  const bound = RESOURCES.reduce((best, r) => (p[r].avg10 * WEIGHT[r] > p[best].avg10 * WEIGHT[best] ? r : best), 'io' as Resource)
  const isSustained = RESOURCES.some(r => p[r].avg60 >= t[r])
  return { level, bound, isSustained }
}

// The words for a bound resource, as the badge and the pane show them.
export const BOUND_LABEL: Record<Bound, string> = {
  io: 'disk-bound',
  memory: 'memory-bound',
  cpu: 'cpu-bound',
  none: 'calm',
}

// The thresholds from the plugin options. A value that is not a number
// keeps its default.
export function thresholdsFrom(options: Record<string, unknown>): Thresholds {
  const num = (key: string, fallback: number) => {
    const n = Number(options[key])
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    busy: num('busyAt', DEFAULT_THRESHOLDS.busy),
    io: num('ioLaggyAt', DEFAULT_THRESHOLDS.io),
    memory: num('memoryLaggyAt', DEFAULT_THRESHOLDS.memory),
    cpu: num('cpuLaggyAt', DEFAULT_THRESHOLDS.cpu),
  }
}
