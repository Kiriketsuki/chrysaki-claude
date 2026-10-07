// The causes of the lag. A snapshot from bin/lag-snapshot holds counters.
// Two snapshots give the rates. The ranking puts the processes and the
// containers that load the bound resource first. No I/O happens here.

import type { Bound, Cause, CauseKind, Resource } from '../types'

export type { Cause, CauseKind }

export type Proc = {
  pid: number
  ppid: number
  uid: number
  state: string
  comm: string
  rssKb: number
  swapKb: number
  ticks: number
  // read_bytes plus write_bytes, or -1 where the file is not readable.
  ioBytes: number
  start: number
}

export type Snapshot = {
  at: number
  hz: number
  ncpu: number
  uid: number
  // The script, its shell and the Claude Code process that ran it.
  ancestors: number[]
  pressure: Record<Resource, string>
  meminfo: string
  swaps: string
  procs: Proc[]
}

export type Container = { name: string; cpuPct: number; memBytes: number; ioBytes: number }

const GIB_KB = 1024 * 1024
const MB = 1e6

// Processes the mod never stops: they hold the desktop or the session up.
// Matched on comm, which the kernel cuts to 15 characters.
const PROTECTED = new Set([
  'systemd', 'Hyprland', 'Xwayland', 'dbus-daemon', 'dbus-broker', 'pipewire', 'pipewire-pulse',
  'wireplumber', 'ghostty', 'kitty', 'alacritty', 'tmux: server', 'sshd', 'gnome-keyring-d', 'swaync', 'waybar',
])

// Helper processes whose comm hides the app they serve, and the short word
// for each. A row names the app above them instead: `zapzap (web)`.
const HELPERS: Readonly<Record<string, string>> = {
  'QtWebEngineProc': 'web',
  'Isolated Web Co': 'tab',
  'Web Content': 'tab',
  'WebExtensions': 'ext',
  'RDD Process': 'media',
  'Utility Process': 'helper',
  'Privileged Cont': 'tab',
  'Isolated Servic': 'helper',
  'Socket Process': 'net',
  'forkserver': 'helper',
}

// The label of a process: its comm, or the app above a helper and the
// helper's word. The walk stops at 16 steps, so a loop in the rows ends.
export function labelOf(p: Proc, byPid: ReadonlyMap<number, Proc>): string {
  const word = HELPERS[p.comm]
  if (word === undefined) return p.comm
  let up = byPid.get(p.ppid)
  for (let i = 0; i < 16 && up !== undefined && HELPERS[up.comm] !== undefined; i++) up = byPid.get(up.ppid)
  return up === undefined || up.pid <= 1 ? p.comm : `${up.comm} (${word})`
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

// The script's output is checked, not trusted. A row of the wrong shape is
// left out.
export function parseSnapshot(raw: string): Snapshot | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.procs)) return null
  const p = (o.pressure ?? {}) as Record<string, unknown>
  const procs: Proc[] = []
  for (const row of o.procs) {
    if (!Array.isArray(row) || row.length < 10) continue
    procs.push({
      pid: num(row[0]), ppid: num(row[1]), uid: num(row[2]), state: text(row[3]), comm: text(row[4]),
      rssKb: num(row[5]), swapKb: num(row[6]), ticks: num(row[7]), ioBytes: typeof row[8] === 'number' ? row[8] : -1, start: num(row[9]),
    })
  }
  return {
    at: num(o.at),
    hz: num(o.hz) || 100,
    ncpu: num(o.ncpu) || 1,
    uid: num(o.uid),
    ancestors: Array.isArray(o.ancestors) ? o.ancestors.filter((x): x is number => typeof x === 'number') : [],
    pressure: { io: text(p.io), memory: text(p.memory), cpu: text(p.cpu) },
    meminfo: text(o.meminfo),
    swaps: text(o.swaps),
    procs,
  }
}

// A docker size such as "12.1GB", "512kB" or "163.6MiB", in bytes.
export function parseSize(s: string): number {
  const m = /^([0-9.]+)\s*([kKMGT]?i?B)$/.exec(s.trim())
  if (m === null) return 0
  const n = Number(m[1])
  const unit = m[2] ?? 'B'
  const base = unit.includes('i') ? 1024 : 1000
  const power = { B: 0, k: 1, K: 1, M: 2, G: 3, T: 4 }[unit[0] as 'B' | 'k' | 'K' | 'M' | 'G' | 'T'] ?? 0
  return n * base ** power
}

// `docker stats --no-stream --format '{{json .}}'`: one JSON object a line.
export function parseDockerStats(out: string): Container[] {
  const list: Container[] = []
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    try {
      const o = JSON.parse(line) as Record<string, unknown>
      const [read = '0B', write = '0B'] = text(o.BlockIO).split('/')
      const [mem = '0B'] = text(o.MemUsage).split('/')
      list.push({
        name: text(o.Name),
        cpuPct: Number(text(o.CPUPerc).replace('%', '')) || 0,
        memBytes: parseSize(mem),
        ioBytes: parseSize(read) + parseSize(write),
      })
    } catch {
      // A line that is not JSON, such as a docker error, adds nothing.
    }
  }
  return list.filter(c => c.name !== '')
}

type Rates = { cpuPct: number; ioMBps: number }

function procRates(cur: Proc, prev: Proc | undefined, dtS: number, hz: number): Rates {
  if (prev === undefined || prev.start !== cur.start || dtS <= 0) return { cpuPct: 0, ioMBps: 0 }
  const cpuPct = ((cur.ticks - prev.ticks) / hz / dtS) * 100
  const ioMBps = cur.ioBytes >= 0 && prev.ioBytes >= 0 ? (cur.ioBytes - prev.ioBytes) / MB / dtS : 0
  return { cpuPct: Math.max(0, cpuPct), ioMBps: Math.max(0, ioMBps) }
}

function gib(kb: number): string {
  return `${(kb / GIB_KB).toFixed(1)}G`
}

// The detail parts, the bound resource first.
function detailOf(bound: Bound, r: Rates, swapKb: number, rssKb: number, isWaiting: boolean): string {
  const parts: [Resource | 'wait', string][] = []
  if (r.ioMBps >= 0.5) parts.push(['io', `${r.ioMBps.toFixed(0)} MB/s disk`])
  if (isWaiting) parts.push(['io', 'disk wait'])
  if (swapKb >= 100 * 1024) parts.push(['memory', `${gib(swapKb)} swap`])
  if (rssKb >= 300 * 1024) parts.push(['memory', `${gib(rssKb)} ram`])
  if (r.cpuPct >= 1) parts.push(['cpu', `${r.cpuPct.toFixed(0)}% cpu`])
  const first = parts.filter(([k]) => k === bound)
  const rest = parts.filter(([k]) => k !== bound)
  return [...first, ...rest].map(([, s]) => s).join(' · ')
}

function scoreOf(bound: Bound, r: Rates, swapKb: number, rssKb: number, isWaiting: boolean): number {
  const swapG = swapKb / GIB_KB
  const memG = (rssKb + swapKb) / GIB_KB
  if (bound === 'io') return r.ioMBps + (isWaiting ? 20 : 0) + swapG * 8
  if (bound === 'memory') return memG * 10 + (isWaiting ? 5 : 0)
  if (bound === 'cpu') return r.cpuPct
  return r.cpuPct / 10 + memG * 5
}

function kindOf(p: Proc, snap: Snapshot): CauseKind {
  if (p.uid !== snap.uid || p.pid <= 2 || p.ppid === 2) return 'system'
  if (PROTECTED.has(p.comm) || snap.ancestors.includes(p.pid)) return 'system'
  return 'own'
}

// The top causes for the bound resource. `prev` gives the rates. Without it,
// only swap, memory and the disk wait rank.
export function rankCauses(
  bound: Bound,
  cur: Snapshot,
  prev: Snapshot | null,
  containers: readonly Container[],
  prevContainers: readonly Container[] | null,
  limit = 8,
): Cause[] {
  const dtS = prev === null ? 0 : (cur.at - prev.at) / 1000
  const before = new Map((prev?.procs ?? []).map(p => [p.pid, p]))
  const byPid = new Map(cur.procs.map(p => [p.pid, p]))
  // The snapshot script itself is the first ancestor. It never ranks.
  const self = cur.ancestors[0]
  const causes: Cause[] = []
  for (const p of cur.procs) {
    if (p.pid === self) continue
    const r = procRates(p, before.get(p.pid), dtS, cur.hz)
    const isWaiting = p.state === 'D'
    const score = scoreOf(bound, r, p.swapKb, p.rssKb, isWaiting)
    if (score < 0.5) continue
    causes.push({
      key: `p${p.pid}:${p.start}`, label: labelOf(p, byPid), detail: detailOf(bound, r, p.swapKb, p.rssKb, isWaiting),
      score, kind: kindOf(p, cur), pid: p.pid, start: p.start, comm: p.comm,
    })
  }
  const was = new Map((prevContainers ?? []).map(c => [c.name, c]))
  for (const c of containers) {
    const old = was.get(c.name)
    const ioMBps = old === undefined || dtS <= 0 ? 0 : Math.max(0, (c.ioBytes - old.ioBytes) / MB / dtS)
    const r = { cpuPct: c.cpuPct, ioMBps }
    const memKb = c.memBytes / 1024
    const score = scoreOf(bound, r, 0, memKb, false)
    if (score < 0.5) continue
    causes.push({ key: `c${c.name}`, label: c.name, detail: `container · ${detailOf(bound, r, 0, memKb, false)}`.replace(/ · $/, ''), score, kind: 'container', container: c.name })
  }
  return causes.sort((a, b) => b.score - a.score).slice(0, limit)
}
