// The fixed cell widths the ledger sets its columns with. Every surface reads
// the same numbers, so a column keeps its edge wherever the band draws. No
// I/O happens here.

import { CORE } from './palette'

// Empty bar cells: dim sockets in the Border colour.
export const SOCKET = CORE.border
// The column separator: two cells of padding on each side of the bar.
export const SEP = '  │  '
// The bar length when the band has room, and when it is tight.
export const BAR_LONG = 16
export const BAR_SHORT = 12
// The bar length of the narrowest desktop stack.
export const BAR_TINY = 8
// Git needs at least this many cells to share the rows of usage and context.
// Below it, git takes two rows of its own.
export const GIT_MIN = 56
// The fixed fields of the context and cache cells: figure, amount, key.
// KEY fits `⬢ h: handoff`: the painter adds the `h: ` hotkey mark.
export const FIG = 4
export const AMOUNT = 10
export const KEY = 12
// The reset field of a usage cell: the arrow, then the time.
export const RESET = 8

// The widths that change with the surface: the key field of the context row,
// and the badge of each ledger cell. The terminal sets them in its own cells.
// `sep` is the column separator, SEP.length cells unless a surface sets less.
// The desktop draws a keycap beside a hotkey label, and the keycap takes about
// two cells more than the terminal's `x: ` mark, so its fields are wider.
export type Fit = { key: number; usage: number; ctx: number; git: number; sep?: number }
export const TERMINAL_FIT: Fit = { key: KEY, usage: 6, ctx: 9, git: 8 }
export const DESKTOP_FIT: Fit = { key: KEY + 2, usage: 6, ctx: 9, git: 9 }
// The stacked desktop ledger gives every badge one width, so the bars, the
// figures and the sparks of the three blocks start at the same column.
export const STACK_FIT: Fit = { key: KEY + 2, usage: 9, ctx: 9, git: 9 }
// The desktop two-up ledger below its full width. It trims the usage badge,
// the key field and the column separator, so the bars and sparks keep room.
export const TWO_UP_FIT: Fit = { key: KEY, usage: 5, ctx: 9, git: 9, sep: 3 }
// The cells of a fit's column separator.
export const sepOf = (fit: Fit): number => fit.sep ?? SEP.length
