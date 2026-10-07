// The health check. bin/health-snapshot reads the raw values, and this file
// turns them into warnings: disk, memory, heat, power and system. No I/O
// happens here.

import type { WarnGroup, WarnLevel, Warning } from '../types'
import { parseSize } from './causes'

export type MountRow = {
  target: string
  fstype: string
  sizeKb: number
  usedKb: number
  availKb: number
  files: number
  filesFree: number
}

export type TempRow = { chip: string; device: string; label: string; c: number; maxC: number | null; critC: number | null }

export type HealthSnap = {
  at: number
  mounts: MountRow[]
  mem: { MemTotal?: number; MemAvailable?: number; SwapTotal?: number; SwapFree?: number }
  oomKills: number | null
  temps: TempRow[]
  batteries: { name: string; capacity: number; status: string }[]
  failed: { system: string[] | null; user: string[] | null }
  kernel: { release: string; hasModules: boolean }
  zombies: { count: number; parents: string[] }
  ntp: boolean | null
}

// What one check carries to the next. `hot` holds the sensors that read over
// their warn level last time, so a warning needs two readings in a row.
export type HealthMemo = { hot: string[]; oomKills: number | null; oomAt: number; oomNew: number }

// The free space Docker can give back, from `docker system df`.
export type DockerFree = { root: string; bytes: number; at: number }

export type Limits = { diskWarn: number; diskCrit: number; cpuWarn: number; cpuCrit: number }

export const DEFAULT_LIMITS: Limits = { diskWarn: 90, diskCrit: 97, cpuWarn: 95, cpuCrit: 99 }

// A tmpfs holds RAM and swap, so it warns sooner than a disk.
const TMPFS = { warn: 75, crit: 90 }
const INODES = { warn: 90, crit: 97 }
const MEM_FREE = { warn: 10, crit: 5 }
const SWAP = { warn: 80, crit: 95 }
const BATTERY = { warn: 20, crit: 10 }
const ZOMBIES = 20
// An OOM kill stays on the list this long.
const OOM_HOLD_MS = 600000
// A drive without its own limits warns at these temperatures.
const DRIVE = { warn: 75, crit: 85 }
const CPU_SENSORS: Record<string, readonly string[]> = {
  k10temp: ['Tctl', 'Tdie'],
  zenpower: ['Tdie', 'Tctl'],
  coretemp: ['Package id 0'],
}

const GROUP_ORDER: readonly WarnGroup[] = ['disk', 'memory', 'heat', 'power', 'system']

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function parseHealth(text: string): HealthSnap | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(v) || v.v !== 1 || typeof v.at !== 'number' || !Array.isArray(v.mounts) || !Array.isArray(v.temps)) return null
  return v as unknown as HealthSnap
}

// `docker system df --format '{{json .}}'`: the sum of the Reclaimable column.
export function parseDockerDf(out: string): number {
  let total = 0
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue
    try {
      const o = JSON.parse(line) as Record<string, unknown>
      total += parseSize(String(o.Reclaimable ?? '').replace(/\s*\(.*\)$/, ''))
    } catch {
      continue
    }
  }
  return total
}

// The mount that holds a path: the longest mount target that prefixes it.
export function mountOf(path: string, mounts: readonly MountRow[]): string | null {
  let best: string | null = null
  for (const m of mounts) {
    const isUnder = path === m.target || path.startsWith(m.target === '/' ? '/' : `${m.target}/`)
    if (isUnder && (best === null || m.target.length > best.length)) best = m.target
  }
  return best
}

export function gib(kb: number): string {
  const g = kb / (1024 * 1024)
  return g >= 10 ? `${Math.round(g)}G` : `${g.toFixed(1)}G`
}

function levelAt(value: number, warn: number, crit: number): WarnLevel | null {
  if (value >= crit) return 'crit'
  return value >= warn ? 'warn' : null
}

function warning(key: string, group: WarnGroup, level: WarnLevel, short: string, text: string, sig = ''): Warning {
  return { key, group, level, short, text, mark: `${key}|${level}|${sig}`, isHidden: false }
}

function diskWarnings(s: HealthSnap, t: Limits, docker: DockerFree | null): Warning[] {
  const dockerMount = docker === null || docker.root === '' ? null : mountOf(docker.root, s.mounts)
  const out: Warning[] = []
  for (const m of s.mounts) {
    const isTmpfs = m.fstype === 'tmpfs'
    const pct = Math.round((m.usedKb / Math.max(1, m.usedKb + m.availKb)) * 100)
    // A small disk counts in percent only. A big one also warns on a low floor.
    const isBig = m.sizeKb >= 8 * 1024 * 1024
    const floor: WarnLevel | null = !isBig || isTmpfs ? null : m.availKb < 2 * 1024 * 1024 ? 'crit' : m.availKb < 5 * 1024 * 1024 ? 'warn' : null
    const byPct = isTmpfs ? levelAt(pct, TMPFS.warn, TMPFS.crit) : levelAt(pct, t.diskWarn, t.diskCrit)
    const level = byPct === 'crit' || floor === 'crit' ? 'crit' : byPct ?? floor
    if (level !== null) {
      const free = m.target === dockerMount && docker !== null && docker.bytes >= 1e9 ? ` · docker can free ${gib(docker.bytes / 1024)}` : ''
      const ram = isTmpfs ? ' (in RAM)' : ''
      out.push(warning(`disk:${m.target}`, 'disk', level, `${m.target} ${pct}%`, `${m.target}${ram} is ${pct}% full, ${gib(m.availKb)} free${free}`))
    }
    const ipct = m.files > 0 ? Math.round(((m.files - m.filesFree) / m.files) * 100) : 0
    const ilevel = levelAt(ipct, INODES.warn, INODES.crit)
    if (ilevel !== null) out.push(warning(`inodes:${m.target}`, 'disk', ilevel, `${m.target} inodes ${ipct}%`, `${m.target} has used ${ipct}% of its inodes`))
  }
  return out
}

function memoryWarnings(s: HealthSnap, memo: HealthMemo, now: number): Warning[] {
  const out: Warning[] = []
  const { MemTotal: total = 0, MemAvailable: avail = 0, SwapTotal: swapTotal = 0, SwapFree: swapFree = 0 } = s.mem
  if (total > 0) {
    const pct = Math.round((avail / total) * 100)
    const level = pct <= MEM_FREE.crit ? 'crit' : pct <= MEM_FREE.warn ? 'warn' : null
    if (level !== null) out.push(warning('mem', 'memory', level, `mem ${pct}% free`, `Only ${gib(avail)} of ${gib(total)} memory is available`))
  }
  if (swapTotal > 0) {
    const used = swapTotal - swapFree
    const pct = Math.round((used / swapTotal) * 100)
    const level = levelAt(pct, SWAP.warn, SWAP.crit)
    if (level !== null) out.push(warning('swap', 'memory', level, `swap ${pct}%`, `Swap is ${pct}% full, ${gib(used)} of ${gib(swapTotal)}`))
  }
  if (memo.oomNew > 0 && now - memo.oomAt < OOM_HOLD_MS) {
    const mins = Math.max(0, Math.round((now - memo.oomAt) / 60000))
    const n = memo.oomNew === 1 ? '1 process' : `${memo.oomNew} processes`
    out.push(warning('oom', 'memory', 'crit', 'oom kill', `The kernel killed ${n} for memory, ${mins} min ago`, String(memo.oomAt)))
  }
  return out
}

type Reading = { key: string; name: string; c: number; warn: number; crit: number; source: string }

// The CPU package sensor and each drive's Composite sensor.
function readings(s: HealthSnap, t: Limits): Reading[] {
  const out: Reading[] = []
  for (const [chip, labels] of Object.entries(CPU_SENSORS)) {
    const row = labels.map(l => s.temps.find(r => r.chip === chip && r.label === l)).find(r => r !== undefined)
    if (row !== undefined) out.push({ key: 'temp:cpu', name: 'cpu', c: row.c, warn: t.cpuWarn, crit: t.cpuCrit, source: `${chip} ${row.label}` })
  }
  for (const r of s.temps) {
    if (r.chip !== 'nvme' || r.label !== 'Composite') continue
    const warn = r.maxC !== null && r.maxC > 0 && r.maxC < 200 ? r.maxC : DRIVE.warn
    const crit = r.critC !== null && r.critC > warn && r.critC < 200 ? r.critC : Math.max(DRIVE.crit, warn + 5)
    out.push({ key: `temp:${r.device}`, name: r.device, c: r.c, warn, crit, source: `limit ${Math.round(warn)}°C` })
  }
  return out.slice(0, 8)
}

function heatWarnings(s: HealthSnap, t: Limits, memo: HealthMemo): { warnings: Warning[]; hot: string[] } {
  const warnings: Warning[] = []
  const hot: string[] = []
  for (const r of readings(s, t)) {
    const level = levelAt(r.c, r.warn, r.crit)
    if (level === null) continue
    hot.push(r.key)
    if (!memo.hot.includes(r.key)) continue
    const deg = Math.round(r.c)
    warnings.push(warning(r.key, 'heat', level, `${r.name} ${deg}°C`, `${r.name === 'cpu' ? 'CPU' : `Drive ${r.name}`} is at ${deg}°C (${r.source})`))
  }
  return { warnings, hot }
}

function powerWarnings(s: HealthSnap): Warning[] {
  return s.batteries.flatMap(b => {
    const level = b.status !== 'Discharging' ? null : b.capacity <= BATTERY.crit ? 'crit' : b.capacity <= BATTERY.warn ? 'warn' : null
    return level === null ? [] : [warning(`bat:${b.name}`, 'power', level, `bat ${b.capacity}%`, `Battery ${b.name} is at ${b.capacity}% and discharging`)]
  })
}

// systemd escapes a dash in a unit name as \x2d.
function unitName(u: string): string {
  return u.replace(/\\x([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

function systemWarnings(s: HealthSnap): Warning[] {
  const out: Warning[] = []
  const units = [...(s.failed.system ?? []).map(unitName), ...(s.failed.user ?? []).map(u => `${unitName(u)} (user)`)]
  if (units.length > 0) {
    const short = units.length === 1 ? '1 unit' : `${units.length} units`
    out.push(warning('units', 'system', 'warn', short, `Failed: ${units.join(', ')}`, units.join(',')))
  }
  if (!s.kernel.hasModules) {
    out.push(warning('reboot', 'system', 'warn', 'reboot', `Kernel ${s.kernel.release} has no modules on disk. A reboot loads the new kernel`))
  }
  if (s.zombies.count >= ZOMBIES) {
    const under = s.zombies.parents.length > 0 ? `, mostly under ${s.zombies.parents[0]}` : ''
    out.push(warning('zombies', 'system', 'warn', `${s.zombies.count} zombies`, `${s.zombies.count} zombie processes${under}`))
  }
  if (s.ntp === false) out.push(warning('ntp', 'system', 'warn', 'clock', 'The clock has no NTP sync'))
  return out
}

// The worst first: critical before warn, then disk, memory, heat, power, system.
export function sortWarnings(list: readonly Warning[]): Warning[] {
  const rank = (w: Warning) => (w.level === 'crit' ? 0 : 10) + GROUP_ORDER.indexOf(w.group)
  return [...list].sort((a, b) => rank(a) - rank(b))
}

export function nextMemo(s: HealthSnap, memo: HealthMemo | null, now: number): HealthMemo {
  const prev = memo ?? { hot: [], oomKills: null, oomAt: 0, oomNew: 0 }
  // The first check only records the count. Kills before it are old news.
  const isNewKill = s.oomKills !== null && prev.oomKills !== null && s.oomKills > prev.oomKills
  return {
    hot: prev.hot,
    oomKills: s.oomKills,
    oomAt: isNewKill ? now : prev.oomAt,
    oomNew: isNewKill ? (s.oomKills ?? 0) - (prev.oomKills ?? 0) : prev.oomNew,
  }
}

export function warningsOf(s: HealthSnap, memo: HealthMemo | null, t: Limits, docker: DockerFree | null, hidden: readonly string[], now: number): { warnings: Warning[]; memo: HealthMemo } {
  const m = nextMemo(s, memo, now)
  const heat = heatWarnings(s, t, m)
  const all = sortWarnings([...diskWarnings(s, t, docker), ...memoryWarnings(s, m, now), ...heat.warnings, ...powerWarnings(s), ...systemWarnings(s)])
  return { warnings: all.map(w => ({ ...w, isHidden: hidden.includes(w.mark) })), memo: { ...m, hot: heat.hot } }
}

// The limits from the plugin options. A value that is not a number keeps its default.
export function limitsFrom(options: Record<string, unknown>): Limits {
  const num = (key: string, fallback: number) => {
    const n = Number(options[key])
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    diskWarn: num('diskWarnAt', DEFAULT_LIMITS.diskWarn),
    diskCrit: num('diskCritAt', DEFAULT_LIMITS.diskCrit),
    cpuWarn: num('cpuTempWarnAt', DEFAULT_LIMITS.cpuWarn),
    cpuCrit: num('cpuTempCritAt', DEFAULT_LIMITS.cpuCrit),
  }
}
