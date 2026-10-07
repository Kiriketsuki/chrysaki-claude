// Readings from this machine on 2026-10-07, while it lagged. The process
// rows are cut down to the ones the tests name.

export const PSI_IO = 'some avg10=37.26 avg60=46.47 avg300=40.85 total=786063144401\nfull avg10=7.40 avg60=12.13 avg300=16.86 total=701010361407\n'
export const PSI_MEMORY = 'some avg10=0.08 avg60=0.70 avg300=0.32 total=2584163456\nfull avg10=0.00 avg60=0.10 avg300=0.05 total=1000\n'
export const PSI_CPU = 'some avg10=0.83 avg60=0.43 avg300=0.31 total=18299830103\n'
export const PSI_CALM = 'some avg10=0.50 avg60=0.40 avg300=0.30 total=1\n'

export const SWAPS = [
  'Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority',
  '/dev/zram0                              partition\t8388604\t\t8160652\t\t100',
  '/home/swapfile                          file\t\t33554428\t9870760\t\t10',
  '',
].join('\n')

export const DOCKER = [
  '{"BlockIO":"51.7GB / 64.9GB","CPUPerc":"4.52%","MemUsage":"191MiB / 31.15GiB","Name":"miki-598f-golden-pg"}',
  '{"BlockIO":"15.8GB / 12.2GB","CPUPerc":"0.00%","MemUsage":"18.09MiB / 31.15GiB","Name":"miki-1067-golden-pg"}',
  'Cannot connect to the Docker daemon',
].join('\n')

export const DOCKER_LATER = [
  '{"BlockIO":"52.0GB / 65.2GB","CPUPerc":"5.10%","MemUsage":"192MiB / 31.15GiB","Name":"miki-598f-golden-pg"}',
  '{"BlockIO":"15.8GB / 12.2GB","CPUPerc":"0.00%","MemUsage":"18.09MiB / 31.15GiB","Name":"miki-1067-golden-pg"}',
].join('\n')

type Row = [number, number, number, string, string, number, number, number, number, number]

// [pid, ppid, uid, state, comm, rss_kb, swap_kb, cpu_ticks, io_bytes, start_ticks]
export const ROWS: Row[] = [
  [1, 0, 0, 'S', 'systemd', 12000, 0, 5000, -1, 1],
  [140, 2, 0, 'D', 'kswapd0', 0, 0, 90000, -1, 50],
  [2486, 1, 1000, 'S', 'zapzap', 40000, 338144, 9000, 0, 800],
  [2627, 2486, 1000, 'S', 'QtWebEngineProc', 20000, 0, 100, 0, 850],
  [4420, 2627, 1000, 'D', 'QtWebEngineProc', 1777384, 2637368, 100000, 4_000_000_000, 900],
  [1114989, 1, 1000, 'S', 'firefox', 706408, 318748, 500000, 9_000_000_000, 1200],
  [1765307, 2652716, 1000, 'S', 'claude', 499660, 0, 70000, 1_000_000, 3000],
  [2652716, 4573, 1000, 'S', 'ghostty', 159148, 0, 20000, 0, 2900],
  [4182270, 1, 999, 'D', 'postgres', 35108, 0, 1000, -1, 9000],
  [424690, 1765307, 1000, 'R', 'python3', 12000, 0, 10, 0, 9999],
]

export function snapshotJson(at: number, rows: Row[] = ROWS): string {
  return JSON.stringify({
    at,
    hz: 100,
    ncpu: 16,
    uid: 1000,
    ancestors: [424690, 1765307, 2652716],
    pressure: { io: PSI_IO, memory: PSI_MEMORY, cpu: PSI_CPU },
    meminfo: 'MemTotal:       32668360 kB\n',
    swaps: SWAPS,
    procs: rows,
  })
}

// Three seconds on: ZapZap read 30 MB and Firefox burned 2.4 s of CPU.
export function laterRows(): Row[] {
  return ROWS.map(r => {
    if (r[0] === 4420) return [...r.slice(0, 8), (r[8] as number) + 30_000_000, r[9]] as Row
    if (r[0] === 1114989) return [...r.slice(0, 7), (r[7] as number) + 240, ...r.slice(8)] as Row
    return r
  })
}
