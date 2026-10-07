// The health check's I/O: the snapshot script, the hidden marks, and the
// `docker system df` job that runs in the background. health.ts holds the
// rules.

import type { Bound, Warning } from '../types'
import { mountOf, parseDockerDf, parseHealth, warningsOf } from './health'
import type { DockerFree, Limits, MountRow } from './health'
import { DOCKER_MS, isHealthDue, parseHidden, withNotified } from './shared'
import type { HealthFile } from './shared'

// The engine calls this file needs. register.tsx supplies them, because $
// does not cross an import.
export type CheckupHost = {
  // Runs a command. Null when it could not start or timed out.
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string } | null>
  readHidden: () => Promise<string | null>
  log: (text: string) => void
  root: string
}

// Module state. A reload drops a running job, and the next check starts one.
let dockerJob: Promise<void> | null = null
let dockerDone: DockerFree | null = null

function newer(a: DockerFree | null, b: DockerFree | null): DockerFree | null {
  if (a === null) return b
  return b === null || a.at >= b.at ? a : b
}

// The Docker root and the space Docker can give back. Without docker, the
// result has an empty root, so the job waits DOCKER_MS before a retry.
async function dockerFree(h: CheckupHost, now: number): Promise<DockerFree> {
  const info = await h.run(['docker', 'info', '-f', '{{.DockerRootDir}}'], 10000)
  if (info === null || info.exitCode !== 0) return { root: '', bytes: 0, at: now }
  const df = await h.run(['docker', 'system', 'df', '--format', '{{json .}}'], 120000)
  return { root: info.stdout.trim(), bytes: df !== null && df.exitCode === 0 ? parseDockerDf(df.stdout) : 0, at: now }
}

// The job runs when a disk warning could name the Docker space: on the Docker
// mount once a scan found the root, on any disk before that. It never runs on a
// disk-bound machine, because the scan reads the disk hard.
function isDockerDue(warnings: readonly Warning[], mounts: readonly MountRow[], docker: DockerFree | null, bound: Bound, now: number): boolean {
  if (bound === 'io' || dockerJob !== null) return false
  if (docker !== null && now - docker.at < DOCKER_MS) return false
  const disks = warnings.filter(w => w.key.startsWith('disk:'))
  if (docker === null || docker.root === '') return disks.length > 0
  const mount = mountOf(docker.root, mounts)
  return disks.some(w => w.key === `disk:${mount}`)
}

// The health file for this sample: the last one while it is fresh, a new
// check when it is due. A failed check keeps the last one.
export async function healthStep(h: CheckupHost, prev: HealthFile | null, now: number, limits: Limits, bound: Bound): Promise<HealthFile | null> {
  if (prev !== null && !isHealthDue(prev, now)) return prev
  const run = await h.run(['python3', '-I', `${h.root}/bin/health-snapshot`], 15000)
  const snap = run !== null && run.exitCode === 0 ? parseHealth(run.stdout) : null
  if (snap === null) {
    h.log('health check failed')
    return prev
  }
  const docker = newer(prev?.docker ?? null, dockerDone)
  const hidden = parseHidden((await h.readHidden()) ?? '')
  const { warnings, memo } = warningsOf(snap, prev?.memo ?? null, limits, docker, hidden, now)
  if (isDockerDue(warnings, snap.mounts, docker, bound, now)) {
    dockerJob = dockerFree(h, now).then(d => { dockerDone = d }).finally(() => { dockerJob = null })
  }
  return { at: now, warnings, memo, notified: withNotified(prev?.notified ?? {}, [], now), docker }
}
