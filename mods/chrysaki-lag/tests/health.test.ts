import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_LIMITS, limitsFrom, mountOf, parseDockerDf, parseHealth, warningsOf } from '../hooks/health'
import type { DockerFree, HealthMemo, HealthSnap } from '../hooks/health'
import { WARN_NOTICE_GAP_MS, parseHidden, toggleHidden, warnNoticesDue, withNotified } from '../hooks/shared'
import type { HealthFile } from '../hooks/shared'
import { DOCKER_DF, T0, mount, snap, snapJson } from './health-fixtures'

const DOCKER: DockerFree = { root: '/home/k/docker', bytes: 248e9, at: T0 }

function check(s: HealthSnap, memo: HealthMemo | null = null, docker: DockerFree | null = null, hidden: string[] = [], now = T0) {
  return warningsOf(s, memo, DEFAULT_LIMITS, docker, hidden, now)
}

function shorts(s: HealthSnap, memo: HealthMemo | null = null, docker: DockerFree | null = null): string[] {
  return check(s, memo, docker).warnings.map(w => `${w.level} ${w.short}`)
}

describe('the snapshot', () => {
  test('parses, and a bad snapshot gives null', async () => {
    expect(parseHealth(snapJson())?.mounts).toHaveLength(6)
    expect(parseHealth('{"v":2}')).toBe(null)
    expect(parseHealth('nope')).toBe(null)
  })

  test('the docker scan sums the reclaimable column', async () => {
    expect(Math.round(parseDockerDf(DOCKER_DF) / 1e9)).toBe(258)
    expect(parseDockerDf('')).toBe(0)
  })

  test('a path belongs to its longest mount', async () => {
    const mounts = snap().mounts
    expect(mountOf('/home/k/docker', mounts)).toBe('/home')
    expect(mountOf('/var/lib/docker', mounts)).toBe('/')
    expect(mountOf('/homework', mounts)).toBe('/')
  })
})

describe('the warnings', () => {
  test('the machine on the day warns only of the failed units, with the names unescaped', async () => {
    const r = check(snap())
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatchObject({ key: 'units', level: 'warn', short: '3 units' })
    expect(r.warnings[0]?.text).toBe('Failed: mnt-nas-docker-glim.automount, mnt-nas-docker-glim.mount, app-slack@autostart.service (user)')
  })

  test('a full disk warns, then turns critical, and names the space Docker can free', async () => {
    const at = (pct: number) => snap({ mounts: [mount('/', 'ext4', 457, 6), mount('/home', 'ext4', 938, pct)] })
    expect(shorts(at(89))).toEqual(['warn 3 units'])
    expect(check(at(92), null, DOCKER).warnings[0]?.text).toBe('/home is 92% full, 75G free · docker can free 231G')
    expect(shorts(at(98))[0]).toBe('crit /home 98%')
    // The Docker space names only the mount that holds the Docker root.
    expect(check(at(92), null, { ...DOCKER, root: '/var/lib/docker' }).warnings[0]?.text).toBe('/home is 92% full, 75G free')
  })

  test('a tmpfs warns sooner, a big disk warns on a low floor, and a small one counts percent only', async () => {
    const s = snap({
      mounts: [mount('/tmp', 'tmpfs', 16, 80), mount('/data', 'ext4', 40, 88), mount('/boot', 'vfat', 1, 85), mount('/srv', 'ext4', 100, 50, 95)],
      failed: { system: [], user: [] },
    })
    const w = check(s).warnings
    expect(w.map(x => `${x.level} ${x.short}`)).toEqual(['warn /tmp 80%', 'warn /data 88%', 'warn /srv inodes 95%'])
    expect(w[0]?.text).toBe('/tmp (in RAM) is 80% full, 3.2G free')
  })

  test('low memory and a full swap warn, and a new OOM kill stays ten minutes', async () => {
    const tight = snap({ mem: { MemTotal: 32 * 1024 * 1024, MemAvailable: 1.2 * 1024 * 1024, SwapTotal: 40 * 1024 * 1024, SwapFree: 6 * 1024 * 1024 }, failed: { system: [], user: [] } })
    expect(shorts(tight)).toEqual(['crit mem 4% free', 'warn swap 85%'])

    const calm = snap({ failed: { system: [], user: [] }, oomKills: 3 })
    // The first check only records the count.
    const first = check(calm)
    expect(first.warnings).toEqual([])
    const killed = check({ ...calm, oomKills: 5 }, first.memo, null, [], T0 + 30000)
    expect(killed.warnings[0]).toMatchObject({ key: 'oom', level: 'crit', text: 'The kernel killed 2 processes for memory, 0 min ago' })
    expect(check({ ...calm, oomKills: 5 }, killed.memo, null, [], T0 + 30000 + 600000).warnings).toEqual([])
  })

  test('heat needs two readings in a row, and a drive uses its own limits', async () => {
    const hot = (cpu: number, drive: number) => snap({
      failed: { system: [], user: [] },
      temps: [
        { chip: 'k10temp', device: 'x', label: 'Tctl', c: cpu, maxC: null, critC: null },
        { chip: 'nvme', device: 'nvme1', label: 'Composite', c: drive, maxC: 83.85, critC: 87.85 },
        { chip: 'nvme', device: 'nvme1', label: 'Sensor 1', c: 99, maxC: 65261.85, critC: null },
      ],
    })
    const first = check(hot(96, 85))
    expect(first.warnings).toEqual([])
    expect(first.memo.hot).toEqual(['temp:cpu', 'temp:nvme1'])
    const second = check(hot(99.4, 85), first.memo)
    expect(second.warnings.map(w => `${w.level} ${w.short}`)).toEqual(['crit cpu 99°C', 'warn nvme1 85°C'])
    expect(second.warnings[1]?.text).toBe('Drive nvme1 is at 85°C (limit 84°C)')
    // One cool reading clears the run.
    expect(check(hot(96, 85), check(hot(60, 50), second.memo).memo).warnings).toEqual([])
  })

  test('a battery warns only while it discharges', async () => {
    const bat = (capacity: number, status: string) => snap({ failed: { system: [], user: [] }, batteries: [{ name: 'BAT1', capacity, status }] })
    expect(shorts(bat(15, 'Discharging'))).toEqual(['warn bat 15%'])
    expect(shorts(bat(8, 'Discharging'))).toEqual(['crit bat 8%'])
    expect(shorts(bat(5, 'Not charging'))).toEqual([])
  })

  test('a missing kernel, many zombies and no NTP sync warn, the critical ones first', async () => {
    const s = snap({
      kernel: { release: '7.0.3-arch1-2', hasModules: false },
      zombies: { count: 24, parents: ['speech-dispatch'] },
      ntp: false,
      batteries: [{ name: 'BAT1', capacity: 9, status: 'Discharging' }],
    })
    expect(shorts(s)).toEqual(['crit bat 9%', 'warn 3 units', 'warn reboot', 'warn 24 zombies', 'warn clock'])
    expect(check(s).warnings.find(w => w.key === 'zombies')?.text).toBe('24 zombie processes, mostly under speech-dispatch')
  })

  test('a hide holds until the level or the units change', async () => {
    const mark = check(snap()).warnings[0]?.mark ?? ''
    expect(check(snap(), null, null, [mark]).warnings[0]?.isHidden).toBe(true)
    const more = snap({ failed: { system: ['a.service'], user: [] } })
    expect(check(more, null, null, [mark]).warnings[0]?.isHidden).toBe(false)
  })

  test('the options set the limits, and a bad value keeps the default', async () => {
    expect(limitsFrom({ diskWarnAt: '85', cpuTempCritAt: 'hot' })).toEqual({ ...DEFAULT_LIMITS, diskWarn: 85 })
  })
})

describe('the notices and the hidden marks', () => {
  const crit = check(snap({ batteries: [{ name: 'BAT1', capacity: 9, status: 'Discharging' }] })).warnings
  const file = (notified: Record<string, number>, hidden: string[] = []): HealthFile => ({
    at: T0, warnings: crit.map(w => ({ ...w, isHidden: hidden.includes(w.mark) })), memo: { hot: [], oomKills: 0, oomAt: 0, oomNew: 0 }, notified, docker: null,
  })

  test('a critical warning gets one notice an hour, and a hidden one gets none', async () => {
    expect(warnNoticesDue(file({}), T0).map(w => w.key)).toEqual(['bat:BAT1'])
    expect(warnNoticesDue(file({ 'bat:BAT1': T0 - 60000 }), T0)).toEqual([])
    expect(warnNoticesDue(file({ 'bat:BAT1': T0 - WARN_NOTICE_GAP_MS }), T0)).toHaveLength(1)
    expect(warnNoticesDue(file({}, [crit[0]?.mark ?? '']), T0)).toEqual([])
  })

  test('old notice times drop out, and a toggle keeps only live marks', async () => {
    expect(withNotified({ old: T0 - WARN_NOTICE_GAP_MS, recent: T0 - 1000 }, ['bat:BAT1'], T0)).toEqual({ recent: T0 - 1000, 'bat:BAT1': T0 })
    const units = crit.find(w => w.key === 'units')?.mark ?? ''
    expect(toggleHidden(['gone|warn|'], units, crit)).toEqual([units])
    expect(toggleHidden([units], units, crit)).toEqual([])
    expect(parseHidden('{"marks":["a",3]}')).toEqual(['a'])
    expect(parseHidden('bad')).toEqual([])
  })
})
