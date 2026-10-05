// Pure helpers: thresholds, text formats and parsers. Each one mirrors a
// block of statusline-command.sh, named in its comment.

import { ROLE } from './palette'

export type BarStyle = 'line' | 'wave' | 'hex' | 'diamond' | 'circle' | 'block'

// 5h usage: Emerald Lt, Blonde from 50, Ruby from 75.
export function fiveHourColor(pct: number): string {
  if (pct >= 75) return ROLE.error
  if (pct >= 50) return ROLE.warn
  return ROLE.emeraldLt
}

// 7d usage: Secondary, Blonde from 50, Ruby from 75.
export function sevenDayColor(pct: number): string {
  if (pct >= 75) return ROLE.error
  if (pct >= 50) return ROLE.warn
  return ROLE.sec
}

// ctx: Teal, orange from 50 percent, Ruby from 128k tokens absolute.
// The ctx thresholds go by tokens, not by percent, so a 1M window and a 200k
// window warn at the same size: amber from 250k, red from 500k.
export const CTX_AMBER_TOKENS = 250000
export const CTX_RED_TOKENS = 500000

export function ctxColor(_pct: number, tokens: number | undefined): string {
  if (tokens !== undefined && tokens >= CTX_RED_TOKENS) return ROLE.error
  if (tokens !== undefined && tokens >= CTX_AMBER_TOKENS) return ROLE.warn
  return ROLE.teal
}

// section_marker: filled parallelogram, open parallelogram, then diamond.
export function marker(pct: number, warnAt: number, critAt: number): string {
  if (pct >= critAt) return '◆'
  if (pct >= warnAt) return '▱'
  return '▰'
}

export function ctxMarker(_pct: number, tokens: number | undefined): string {
  if (tokens !== undefined && tokens >= CTX_RED_TOKENS) return '◆'
  if (tokens !== undefined && tokens >= CTX_AMBER_TOKENS) return '▱'
  return '▰'
}

export const HANDOFF_TOKENS = 100000

export function isHandoffDue(tokens: number | undefined): boolean {
  return tokens !== undefined && tokens >= HANDOFF_TOKENS
}

// compute_delta: time until a reset, as "4d 19h", "4h 25m", "12m" or "now".
export function untilReset(resetsAt: number | undefined, now: number): string {
  if (resetsAt === undefined) return ''
  const diff = Math.floor((resetsAt - now) / 1000)
  if (diff <= 0) return 'now'
  const days = Math.floor(diff / 86400)
  const hours = Math.floor((diff % 86400) / 3600)
  const minutes = Math.floor((diff % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export type BarCell = { glyph: string; isFilled: boolean }

const GLYPHS: Record<Exclude<BarStyle, 'wave'>, [string, string]> = {
  line: ['━', '─'],
  hex: ['⬢', '⬡'],
  diamond: ['◆', '◇'],
  circle: ['●', '○'],
  block: ['█', '░'],
}

// progress_bar: eight cells by default, round(pct * length / 100) filled. The
// band stretches a bar to the width of its cell with `length`. The wave style
// alternates up and down triangles and scrolls by `shift` (0 to 3).
export function barCells(pct: number, style: BarStyle, shift: number, length = 8): BarCell[] {
  const filled = Math.max(0, Math.min(length, Math.floor((pct * length + 50) / 100)))
  return Array.from({ length }, (_, i) => {
    const isFilled = i < filled
    if (style === 'wave') {
      const isUp = (i + shift) % 4 % 2 === 0
      return { glyph: isUp ? '▲' : '▼', isFilled }
    }
    const [full, empty] = GLYPHS[style]
    return { glyph: isFilled ? full : empty, isFilled }
  })
}

export function kilo(n: number): string {
  return `${Math.floor(n / 1000)}k`
}

// The smart CWD: parent/basename, or the basename alone under HOME or /.
export function smartCwd(dir: string, home: string): string {
  const parts = dir.replace(/\/+$/, '').split('/')
  const base = parts[parts.length - 1] ?? dir
  const parentPath = parts.slice(0, -1).join('/')
  const parent = parts[parts.length - 2] ?? ''
  if (parentPath === home || parentPath === '' || parent === '' || parent === '.') return base
  return `${parent}/${base}`
}

// The model label, prefixed "Claude " as the bash script does. An id such as
// claude-opus-5-5 reads as "Claude Opus 5.5".
export function modelLabel(model: string): string {
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(model)
  if (id !== null) {
    const family = (id[1] ?? '').charAt(0).toUpperCase() + (id[1] ?? '').slice(1)
    return `Claude ${family} ${id[2]}${id[3] !== undefined ? '.' + id[3] : ''}`
  }
  return /^claude/i.test(model) ? model : `Claude ${model}`
}

// The session clock: "1hr 4m 9s", "4m 9s" or "9s".
export function sessionClock(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  // Seconds only matter in the first hour. Past it they are noise.
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function costSgd(usd: number, rate: number): string {
  return (usd * rate).toFixed(2)
}

// git diff --shortstat: "3 files changed, 12 insertions(+), 4 deletions(-)".
export function parseShortstat(text: string): { insertions: number; deletions: number } {
  const ins = /(\d+) insertion/.exec(text)
  const del = /(\d+) deletion/.exec(text)
  return { insertions: Number(ins?.[1] ?? 0), deletions: Number(del?.[1] ?? 0) }
}

// owner/repo from an origin URL: HTTPS, SSH, or an SSH alias such as github-work.
export function repoPathFromRemote(url: string): string {
  const m = /github(?:\.com|-[a-z]+)[:/](.+?)(?:\.git)?\/?$/.exec(url.trim())
  return m?.[1] ?? ''
}

// The vault inbox: "- " lines under "## Ramblings" in the Scratch Book.
export function inboxDepth(scratch: string): number {
  let isInside = false
  let count = 0
  for (const line of scratch.split('\n')) {
    if (/^## Ramblings/.test(line)) isInside = true
    else if (/^## /.test(line)) isInside = false
    else if (isInside && /^- /.test(line)) count += 1
  }
  return count
}

// The zigzag-alt preset (|,\) from TILING.md: the glyph after element i of n.
// Back edge U+E0BC, forward edge U+E0B8, terminal edge U+E0B0, as chrysaki.conf.
export function rightEdge(i: number, n: number): string {
  if (i === n - 1) return ''
  return i % 2 === 0 ? '' : ''
}

// The mirror of rightEdge, for a run that reads right to left: the glyph
// before segment j of n. It reflects the left run's edge for the segment in
// the mirrored place, so the right end of the header mirrors its left end.
const MIRROR: Record<string, string> = { '\ue0b0': '\ue0b2', '\ue0bc': '\ue0be', '\ue0b8': '\ue0ba' }

export function leftEdge(j: number, n: number): string {
  const edge = rightEdge(n - 1 - j, n)
  return MIRROR[edge] ?? edge
}
