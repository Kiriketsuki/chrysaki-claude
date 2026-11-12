// The live session file of a hub session. usaKi counts these files to show the
// live sessions of each seat. The shell script (statusline/hub-status.sh) writes
// the same file with the same rules. The contract:
//   <cache>/<pool>.live/<session id>.json   {"seat":"<seat>","written_at":<epoch s>}
// usaKi counts a file when written_at is at most 600 s old. This module does
// no I/O itself. The caller gives it a LiveFileHost, so a test can use a clock
// and an in-memory folder.

// A file younger than this, with the same seat, is not rewritten.
export const LIVE_HEARTBEAT_MS = 60000
// A file older than this is deleted.
export const LIVE_PRUNE_MS = 86400000
// The prune runs at most once in this period, by a stamp file in the folder.
export const LIVE_PRUNE_EVERY_MS = 600000

const POOL_RE = /^[a-z0-9-]+$/
const NAME_RE = /^[A-Za-z0-9_-]+$/

export type LiveFileHost = {
  now: () => Promise<number>
  // The text of a file, or null when it is missing.
  read: (path: string) => Promise<string | null>
  // Makes the folder with mode 700, with its parents when needed.
  makePrivateDir: (path: string) => Promise<void>
  // Writes a whole file.
  write: (path: string, text: string) => Promise<void>
  // Moves a file over the target in one step.
  move: (from: string, to: string) => Promise<void>
  // Deletes each *.json file in the folder that is older than maxAgeMs.
  prune: (dir: string, maxAgeMs: number) => Promise<void>
}

// The folder of a pool, as the shell script names it. CLIPROXY_CACHE_DIR wins,
// then XDG_CACHE_HOME, then the home folder.
export function hubLiveDir(
  pool: string,
  env: { cliproxyCache?: string; xdgCache?: string; home?: string },
): string | null {
  if (!POOL_RE.test(pool)) return null
  const set = (v: string | undefined): v is string => v !== undefined && v !== ''
  const base = set(env.cliproxyCache)
    ? env.cliproxyCache
    : set(env.xdgCache)
      ? `${env.xdgCache}/cliproxy`
      : set(env.home)
        ? `${env.home.replace(/[\\/]+$/, '')}/.cache/cliproxy`
        : null
  return base === null ? null : `${base.replace(/\/+$/, '')}/${pool}.live`
}

export function liveFileText(seat: string, nowMs: number): string {
  return `${JSON.stringify({ seat, written_at: Math.floor(nowMs / 1000) })}\n`
}

// True when the file holds this seat and is younger than the heartbeat.
function isFresh(text: string | null, seat: string, nowMs: number): boolean {
  if (text === null) return false
  try {
    const v = JSON.parse(text) as { seat?: unknown; written_at?: unknown }
    return v.seat === seat && typeof v.written_at === 'number' && nowMs - v.written_at * 1000 < LIVE_HEARTBEAT_MS
  } catch {
    return false
  }
}

// Writes or refreshes the file of one session. `dir` is null for a session
// outside the hub, and the function then does nothing. A null seat, or a seat
// or session id with a bad character, writes nothing and keeps the old file.
// The file then ages out through written_at, and the prune deletes it. This
// keeps the shell writer of the same file safe. The function never throws.
export async function syncLiveFile(
  host: LiveFileHost,
  dir: string | null,
  sessionId: string | null | undefined,
  seat: string | null,
): Promise<void> {
  if (dir === null || sessionId === null || sessionId === undefined || !NAME_RE.test(sessionId)) return
  const file = `${dir}/${sessionId}.json`
  try {
    if (seat === null || !NAME_RE.test(seat)) return
    const now = await host.now()
    if (isFresh(await host.read(file), seat, now)) return
    await host.makePrivateDir(dir)
    const tmp = `${dir}/.${sessionId}.tmp`
    await host.write(tmp, liveFileText(seat, now))
    await host.move(tmp, file)
    const stamp = `${dir}/.prune.stamp`
    const last = Number(await host.read(stamp))
    if (!(now - last < LIVE_PRUNE_EVERY_MS)) {
      await host.write(stamp, String(now))
      await host.prune(dir, LIVE_PRUNE_MS)
    }
  } catch {
    // A failed write must never fail the band. The next call tries again.
  }
}
