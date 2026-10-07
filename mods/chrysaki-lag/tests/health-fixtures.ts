// A health snapshot of the author's machine on 2026-10-07, from
// bin/health-snapshot. Tests change one part at a time.

import type { HealthSnap, MountRow } from '../hooks/health'

export const T0 = Date.parse('2026-10-07T08:00:00Z')

const G = 1024 * 1024

export function mount(target: string, fstype: string, sizeG: number, usedPct: number, inodePct = 2): MountRow {
  const sizeKb = sizeG * G
  const usedKb = Math.round(sizeKb * usedPct / 100)
  return { target, fstype, sizeKb, usedKb, availKb: sizeKb - usedKb, files: 1_000_000, filesFree: 1_000_000 - inodePct * 10_000 }
}

export function snap(over: Partial<HealthSnap> = {}): HealthSnap {
  return {
    at: T0,
    mounts: [
      mount('/', 'ext4', 457, 6),
      mount('/dev/shm', 'tmpfs', 16, 3),
      mount('/home', 'ext4', 938, 84, 15),
      { ...mount('/boot', 'vfat', 1, 15), files: 0, filesFree: 0 },
      mount('/tmp', 'tmpfs', 16, 27, 14),
      mount('/run/user/1000', 'tmpfs', 3, 1),
    ],
    mem: { MemTotal: 32668360, MemAvailable: 13611496, SwapTotal: 41943032, SwapFree: 28756656 },
    oomKills: 0,
    temps: [
      { chip: 'acpitz', device: 'LNXTHERM:00', label: '', c: 93, maxC: null, critC: null },
      { chip: 'nvme', device: 'nvme1', label: 'Composite', c: 58.85, maxC: 83.85, critC: 87.85 },
      { chip: 'nvme', device: 'nvme1', label: 'Sensor 1', c: 81.85, maxC: 65261.85, critC: null },
      { chip: 'nvme', device: 'nvme0', label: 'Composite', c: 51.85, maxC: 99.85, critC: 109.85 },
      { chip: 'k10temp', device: '0000:00:18.3', label: 'Tctl', c: 92.875, maxC: null, critC: null },
      { chip: 'spd5118', device: '0-0051', label: '', c: 68.25, maxC: 55, critC: 85 },
    ],
    batteries: [{ name: 'BAT1', capacity: 99, status: 'Not charging' }],
    failed: { system: ['mnt-nas-docker\\x2dglim.automount', 'mnt-nas-docker\\x2dglim.mount'], user: ['app-slack@autostart.service'] },
    kernel: { release: '7.0.3-arch1-2', hasModules: true },
    zombies: { count: 6, parents: ['speech-dispatch', 'Hyprland'] },
    ntp: true,
    ...over,
  }
}

export function snapJson(over: Partial<HealthSnap> = {}): string {
  return JSON.stringify({ v: 1, uid: 1000, ...snap(over) })
}

// `docker system df --format '{{json .}}'` on the same day.
export const DOCKER_DF = [
  '{"Active":"14","Reclaimable":"126.1GB (77%)","Size":"163.4GB","TotalCount":"484","Type":"Images"}',
  '{"Active":"5","Reclaimable":"768.1MB (4%)","Size":"15.92GB","TotalCount":"27","Type":"Containers"}',
  '{"Active":"15","Reclaimable":"110.6GB (89%)","Size":"123.7GB","TotalCount":"213","Type":"Local Volumes"}',
  '{"Active":"0","Reclaimable":"20.27GB","Size":"32.41GB","TotalCount":"597","Type":"Build Cache"}',
].join('\n')
