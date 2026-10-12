// The grounds of the desktop header. The header steps its pills through
// Abyss, Raised and Elevated, tuned for the dark terminal background. The
// desktop card is lighter, so Raised and Elevated sit within 1.25:1 of it and
// the chamfer edges vanish. The desktop lifts those two grounds toward the
// Border and the Slate. Abyss and the alert fills stay as they are. No I/O
// happens here.

import { mixHex } from './gradient'
import { CORE } from './palette'

// The ground a Raised pill takes on the desktop.
export const DESK_RAISED = CORE.border
// The ground an Elevated pill takes on the desktop. It stays 1.4:1 or more
// from the Raised ground and from the card, and the lettering keeps 4.5:1.
export const DESK_ELEVATED = mixHex(CORE.border, CORE.slate, 0.4)

// The desktop ground for a header ground. Any other ground passes through.
export function deskGround(bg: string): string {
  if (bg === CORE.raised) return DESK_RAISED
  if (bg === CORE.elevated) return DESK_ELEVATED
  return bg
}
