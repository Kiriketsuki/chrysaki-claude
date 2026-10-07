// Stops a cause. A process gets SIGTERM, then SIGKILL after a grace period
// when it still runs. A container gets `docker stop`. Before each signal the
// pid is read again: a pid that now names another process is left alone.
// The engine interface cannot cross an import, so register.tsx hands these
// functions a KillHost.

import type { Cause } from '../types'

export type ProcId = { comm: string; start: number; uid: number }

export type KillHost = {
  // The process behind a pid now, or null when the pid is gone.
  identify: (pid: number) => Promise<ProcId | null>
  signal: (pid: number, sig: 'TERM' | 'KILL') => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  // Null on success, else the error text.
  dockerStop: (name: string) => Promise<string | null>
  uid: number
}

export const GRACE_MS = 5000

// The comm and start time from /proc/<pid>/stat. The comm sits in
// parentheses and can hold spaces, so the split starts after the last ')'.
export function parseStat(text: string): { comm: string; start: number } | null {
  const close = text.lastIndexOf(')')
  if (close < 0) return null
  const rest = text.slice(close + 2).split(' ')
  // rest[0] is field 3, so field 22 (starttime) is rest[19].
  const start = Number(rest[19])
  return Number.isFinite(start) ? { comm: text.slice(text.indexOf('(') + 1, close), start } : null
}

// The real uid from /proc/<pid>/status.
export function parseUid(text: string): number | null {
  const line = text.split('\n').find(l => l.startsWith('Uid:'))
  const uid = Number(line?.split(/\s+/)[1])
  return line === undefined || !Number.isFinite(uid) ? null : uid
}

function isSame(id: ProcId | null, c: Cause, uid: number): boolean {
  return id !== null && id.comm === c.comm && id.start === c.start && id.uid === uid
}

// Stops the cause and says what happened, in words for a toast.
export async function stopCause(h: KillHost, c: Cause): Promise<string> {
  if (c.kind === 'container' && c.container !== undefined) {
    const error = await h.dockerStop(c.container)
    return error === null ? `Stopped the container ${c.container}.` : `docker stop ${c.container} failed: ${error}`
  }
  if (c.kind !== 'own' || c.pid === undefined) return `${c.label} is a system process. The mod does not stop it.`
  const pid = c.pid
  if (!isSame(await h.identify(pid), c, h.uid)) return `Process ${pid} changed or ended. Nothing was stopped.`
  if (!(await h.signal(pid, 'TERM'))) return `SIGTERM to ${c.label} (${pid}) failed.`
  await h.sleep(GRACE_MS)
  if (!isSame(await h.identify(pid), c, h.uid)) return `Stopped ${c.label} (${pid}) with SIGTERM.`
  if (!(await h.signal(pid, 'KILL'))) return `${c.label} (${pid}) ignored SIGTERM, and SIGKILL failed.`
  return `${c.label} (${pid}) ignored SIGTERM for ${GRACE_MS / 1000} s. Stopped it with SIGKILL.`
}
