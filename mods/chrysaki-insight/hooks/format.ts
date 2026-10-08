// Pure text formatting for the insight pane. Nothing here touches the engine,
// so the unit tests run it directly.

export function tokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// A share of a whole, in percent. One decimal below 10 so that small
// categories do not all read as 0.
export function percentOf(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return '0%'
  const value = (part / whole) * 100
  return value < 10 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (minutes < 60) return `${minutes}m${String(rest).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// Local wall-clock time, HH:MM:SS.
export function clock(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, Math.max(0, max - 1))}…`
}

export const padStart = (text: string, width: number): string => text.padStart(width)
export const padEnd = (text: string, width: number): string => truncate(text, width).padEnd(width)

export function usd(amount: number): string {
  return amount < 0.01 && amount > 0 ? '<$0.01' : `$${amount.toFixed(2)}`
}

// Splits a bar of `width` cells into filled and empty runs. A non-zero share
// always shows one filled cell, so a small category stays visible.
export function barCells(fraction: number, width: number): { filled: number; empty: number } {
  const safe = Math.max(1, Math.floor(width))
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  const raw = Math.round(clamped * safe)
  const filled = clamped > 0 ? Math.max(1, raw) : 0
  return { filled, empty: safe - filled }
}
