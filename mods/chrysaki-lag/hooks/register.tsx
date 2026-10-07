import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Cause, LagArmed, LagView } from '../types'
import { parseDockerStats, parseSnapshot, rankCauses } from './causes'
import type { Container, Snapshot } from './causes'
import { parseStat, parseUid, stopCause } from './kill'
import type { KillHost } from './kill'
import { parsePressure, parseSwaps, thresholdsFrom, verdict } from './pressure'
import type { Pressure, Swap, Thresholds } from './pressure'
import { filePath, isNoticeDue, isSampleDue, parseLagFile } from './shared'
import type { LagFile, LagTop } from './shared'
import { CONFIRM_MS, lagPane } from './view'
import type { Act } from './view'

const PANE = 'lag'

const view = atom({ plugin: 'chrysaki-lag', key: 'view' } as const, null as LagView | null)
const armed = atom({ plugin: 'chrysaki-lag', key: 'armed' } as const, null as LagArmed | null)
const stopping = atom({ plugin: 'chrysaki-lag', key: 'stopping' } as const, [] as string[])

// Each session looks at the shared file this often. Only the session that
// finds it stale samples.
const TICK_MS = 10000
// The pane resamples this often while it is open.
const PANE_MS = 3000
// A snapshot older than this gives no rates. The next one starts a new pair.
const PAIR_MAX_MS = 30000
// The desktop notice waits this long for a click: the $.process.run maximum.
const NOTICE_WAIT_MS = 600000

type Config = { thresholds: Thresholds; isNotify: boolean }

// Module state. A reload clears it, which costs one sample without rates.
let prevSnap: Snapshot | null = null
let prevContainers: Container[] | null = null
let isSampling = false
let paneTimer: Timer | null = null
let tickTimer: Timer | null = null

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log($: EngineInterface, text: string): void {
  $.ui.log(`chrysaki-lag: ${text}`, { to: 'debug' })
}

async function stateFile($: EngineInterface): Promise<string> {
  return filePath(await $.env.get('XDG_RUNTIME_DIR'))
}

async function readShared($: EngineInterface): Promise<LagFile | null> {
  const text = await $.fs.read(await stateFile($)).catch(() => null)
  return typeof text === 'string' ? parseLagFile(text) : null
}

// Pressure and swap only: four small reads.
async function lightSample($: EngineInterface): Promise<{ pressure: Pressure; swap: Swap }> {
  const get = (path: string) => $.fs.read(path).then(t => (typeof t === 'string' ? t : '')).catch(() => '')
  const [io, memory, cpu, swaps] = await Promise.all([
    get('/proc/pressure/io'), get('/proc/pressure/memory'), get('/proc/pressure/cpu'), get('/proc/swaps'),
  ])
  return { pressure: parsePressure({ io, memory, cpu }), swap: parseSwaps(swaps) }
}

// Every process from bin/lag-snapshot, and the containers from docker stats,
// ranked against the last full sample.
async function fullSample($: EngineInterface, cfg: Config): Promise<LagView | null> {
  const [snapRun, dockerRun] = await Promise.all([
    $.process.run(['python3', '-I', `${$.plugin.root}/bin/lag-snapshot`], { timeoutMs: 15000 }).catch(error => {
      log($, `snapshot failed: ${message(error)}`)
      return null
    }),
    $.process.run(['docker', 'stats', '--no-stream', '--format', '{{json .}}'], { timeoutMs: 15000 }).catch(() => null),
  ])
  const snap = snapRun !== null && snapRun.exitCode === 0 ? parseSnapshot(snapRun.stdout) : null
  if (snap === null) return null
  const hasDocker = dockerRun !== null && dockerRun.exitCode === 0
  const containers = hasDocker ? parseDockerStats(dockerRun.stdout) : []
  const isPair = prevSnap !== null && snap.at - prevSnap.at <= PAIR_MAX_MS
  const pressure = parsePressure(snap.pressure)
  const v = verdict(pressure, cfg.thresholds)
  const causes = rankCauses(v.level === 'calm' ? 'none' : v.bound, snap, isPair ? prevSnap : null, containers, isPair ? prevContainers : null)
  prevSnap = snap
  prevContainers = containers
  return { at: snap.at, level: v.level, bound: v.bound, pressure, swap: parseSwaps(snap.swaps), causes, hasDocker, note: null }
}

async function writeShared($: EngineInterface, f: LagFile): Promise<void> {
  await $.fs.write(await stateFile($), JSON.stringify(f)).catch(error => log($, `state write failed: ${message(error)}`))
}

function topOf(causes: readonly Cause[]): LagTop[] {
  return causes.slice(0, 3).map(c => ({ label: c.label, detail: c.detail }))
}

// The desktop notice. It waits for a click, and `open` opens the pane in
// this session.
async function notify($: EngineInterface, f: LagFile): Promise<void> {
  const title = `Machine ${f.level}: ${f.bound === 'none' ? 'no clear cause' : `${f.bound}-bound`}`
  const body = f.top.length === 0 ? 'No process stands out.' : f.top.slice(0, 2).map(t => `${t.label}: ${t.detail}`).join('\n')
  try {
    const r = await $.process.run([`${$.plugin.root}/bin/lag-notify`, title, body], { timeoutMs: NOTICE_WAIT_MS })
    if (r.stdout.trim() === 'open') await openPane($, null)
  } catch (error) {
    log($, `notice ended: ${message(error)}`)
  }
}

// The ten-second tick. The session that finds the file stale samples and
// writes it. A sustained lag past the notice gap sends one notice.
async function tick($: EngineInterface, cfg: Config): Promise<void> {
  const [file, now, me] = await Promise.all([readShared($), $.clock.now(), $.session.id()])
  if (!isSampleDue(file, now) || isSampling) return
  isSampling = true
  try {
    const light = await lightSample($)
    const v = verdict(light.pressure, cfg.thresholds)
    const base: LagFile = {
      v: 1, at: now, level: v.level, bound: v.bound, pressure: light.pressure, swap: light.swap,
      top: file?.top ?? [], topAt: file?.topAt ?? 0, notifiedAt: file?.notifiedAt ?? 0, writer: me,
    }
    if (!(cfg.isNotify && v.level === 'laggy' && v.isSustained && isNoticeDue(file, now))) {
      await writeShared($, base)
      return
    }
    const full = await fullSample($, cfg)
    const next = { ...base, top: full === null ? base.top : topOf(full.causes), topAt: now, notifiedAt: now }
    await writeShared($, next)
    // Two sessions can sample in the same moment. The last writer sends the notice.
    if ((await readShared($))?.writer === me) void notify($, next)
  } finally {
    isSampling = false
  }
}

// The pane's sample: a full one, drawn and shared.
async function paneSample($: EngineInterface, cfg: Config): Promise<void> {
  if (isSampling) return
  isSampling = true
  try {
    const v = await fullSample($, cfg)
    if (v === null) {
      await update($, view, prev => (prev === null ? null : { ...prev, note: 'The snapshot script failed. See the debug log.' }))
      return
    }
    await update($, view, prev => ({ ...v, note: prev?.note ?? null }))
    const [file, me] = await Promise.all([readShared($), $.session.id()])
    await writeShared($, {
      v: 1, at: v.at, level: v.level, bound: v.bound, pressure: v.pressure, swap: v.swap,
      top: topOf(v.causes), topAt: v.at, notifiedAt: file?.notifiedAt ?? 0, writer: me,
    })
  } finally {
    isSampling = false
  }
}

async function openPane($: EngineInterface, cfg: Config | null): Promise<void> {
  const placed = await $.ui.open({ id: PANE, title: 'lag', focus: true, closeOnEscape: true })
  if (!placed.isPlaced) $.ui.toast(`The lag pane is open but not drawn: ${placed.reason}`)
  const c = cfg ?? lastConfig
  await paneSample($, c)
  if (paneTimer === null) paneTimer = $.clock.every(PANE_MS, () => { void paneSample($, c) })
}

async function closePane($: EngineInterface): Promise<void> {
  paneTimer?.cancel()
  paneTimer = null
  await $.ui.close({ id: PANE })
}

function killHostOf($: EngineInterface): KillHost {
  return {
    identify: async pid => {
      const [stat, status] = await Promise.all([
        $.fs.read(`/proc/${pid}/stat`).catch(() => null),
        $.fs.read(`/proc/${pid}/status`).catch(() => null),
      ])
      if (typeof stat !== 'string' || typeof status !== 'string') return null
      const s = parseStat(stat)
      const uid = parseUid(status)
      return s === null || uid === null ? null : { ...s, uid }
    },
    signal: async (pid, sig) => (await $.process.run(['kill', `-${sig}`, String(pid)], { timeoutMs: 5000 }).catch(() => null))?.exitCode === 0,
    sleep: ms => new Promise(resolve => { $.clock.after(ms, () => resolve()) }),
    dockerStop: async name => {
      const r = await $.process.run(['docker', 'stop', '-t', '10', name], { timeoutMs: 30000 }).catch(error => ({ exitCode: 1, stderr: message(error) }))
      return r.exitCode === 0 ? null : (r.stderr.trim() || `exit ${r.exitCode}`)
    },
    uid: prevSnap?.uid ?? -1,
  }
}

// A first press arms the key. A second press inside CONFIRM_MS stops the cause.
async function press($: EngineInterface, c: Cause): Promise<void> {
  if (c.kind === 'system' || (await read($, stopping)).includes(c.key)) return
  const [a, now] = await Promise.all([read($, armed), $.clock.now()])
  if (a?.key !== c.key || now - a.at >= CONFIRM_MS) {
    await update($, armed, () => ({ key: c.key, at: now }))
    $.clock.after(CONFIRM_MS, () => { void update($, armed, x => (x?.key === c.key && x.at === now ? null : x)) })
    return
  }
  await update($, armed, () => null)
  await update($, stopping, list => [...list, c.key])
  const said = await stopCause(killHostOf($), c)
  await update($, stopping, list => list.filter(k => k !== c.key))
  await update($, view, v => (v === null ? null : { ...v, note: said }))
  $.ui.toast(said, { timeoutMs: 8000 })
  await paneSample($, lastConfig)
}

function actOf($: EngineInterface, cfg: Config): Act {
  return {
    press: c => { void press($, c) },
    refresh: () => { void paneSample($, cfg) },
    close: () => { void closePane($) },
  }
}

// The options of the last register run. openPane from a notice uses them.
let lastConfig: Config = { thresholds: thresholdsFrom({}), isNotify: true }

export const register: Register = (on, options) => {
  const cfg: Config = { thresholds: thresholdsFrom(options), isNotify: String(options.desktopNotify ?? 'on') === 'on' }
  lastConfig = cfg

  on('session.start', async ($, e, next) => {
    const done = await next(e)
    await $.command.register({ name: 'lag', description: 'Show why the machine lags, and stop a cause', immediate: true })
    tickTimer?.cancel()
    tickTimer = $.clock.every(TICK_MS, () => { void tick($, cfg) })
    $.clock.after(0, () => { void tick($, cfg) })
    return done
  })

  on('command.run', { command: 'lag' }, async $ => {
    await openPane($, cfg)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      paneTimer?.cancel()
      paneTimer = null
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const T = $.ui.resolve(e)
    const [v, a, s, now] = await Promise.all([read($, view), read($, armed), read($, stopping), $.clock.now()])
    return lagPane(T, { view: v, armed: a, stopping: s, thresholds: cfg.thresholds, columns: e.props.bodyColumns, now }, actOf($, cfg))
  })
}
