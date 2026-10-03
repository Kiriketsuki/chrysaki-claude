import { describe, expect, test } from 'claude-code/testing'

import { parseStatus } from '../hooks/collect'
import {
  barCells, ctxColor, ctxMarker, fiveHourColor, inboxDepth, isHandoffDue, marker, modelLabel,
  parseShortstat, repoPathFromRemote, rightEdge, sevenDayColor, smartCwd, untilReset,
} from '../hooks/format'
import { ROLE } from '../hooks/palette'
import { toBase64 } from '../hooks/raster'

describe('thresholds match statusline-command.sh', () => {
  test('5h and 7d windows', async () => {
    expect(fiveHourColor(49)).toBe(ROLE.emeraldLt)
    expect(fiveHourColor(50)).toBe(ROLE.warn)
    expect(fiveHourColor(75)).toBe(ROLE.error)
    expect(sevenDayColor(10)).toBe(ROLE.sec)
    expect(sevenDayColor(60)).toBe(ROLE.warn)
    expect(sevenDayColor(90)).toBe(ROLE.error)
  })

  test('context colour, marker and handoff', async () => {
    expect(ctxColor(36, 72000)).toBe(ROLE.teal)
    expect(ctxColor(50, 100000)).toBe(ROLE.orange)
    expect(ctxColor(40, 128000)).toBe(ROLE.error)
    expect(ctxMarker(36, 72000)).toBe('▰')
    expect(ctxMarker(55, 90000)).toBe('▱')
    expect(ctxMarker(55, 130000)).toBe('◆')
    expect(isHandoffDue(99999)).toBe(false)
    expect(isHandoffDue(100000)).toBe(true)
    expect(marker(80, 50, 75)).toBe('◆')
  })
})

describe('formats', () => {
  test('reset countdown', async () => {
    const now = 1_000_000_000_000
    expect(untilReset(now + (4 * 3600 + 25 * 60) * 1000, now)).toBe('4h 25m')
    expect(untilReset(now + (4 * 86400 + 19 * 3600) * 1000, now)).toBe('4d 19h')
    expect(untilReset(now + 12 * 60 * 1000, now)).toBe('12m')
    expect(untilReset(now - 1, now)).toBe('now')
    expect(untilReset(undefined, now)).toBe('')
  })

  test('bars fill round(pct * 8 / 100) cells', async () => {
    expect(barCells(13, 'wave', 0).filter(c => c.isFilled)).toHaveLength(1)
    expect(barCells(50, 'hex', 0).filter(c => c.isFilled)).toHaveLength(4)
    expect(barCells(100, 'block', 0).every(c => c.isFilled)).toBe(true)
    expect(barCells(0, 'wave', 1)[0]?.glyph).toBe('▼')
  })

  test('cwd, model and remote', async () => {
    expect(smartCwd('/home/k/dots/chrysaki', '/home/k')).toBe('dots/chrysaki')
    expect(smartCwd('/home/k/dots', '/home/k')).toBe('dots')
    expect(modelLabel('claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(modelLabel('Sonnet 4.6')).toBe('Claude Sonnet 4.6')
    expect(repoPathFromRemote('git@github.com:Kiriketsuki/chrysaki-claude.git')).toBe('Kiriketsuki/chrysaki-claude')
    expect(repoPathFromRemote('https://github.com/a/b')).toBe('a/b')
    expect(repoPathFromRemote('git@github-work:aurrigo-software-dev/x.git')).toBe('aurrigo-software-dev/x')
  })

  test('git and vault parsers', async () => {
    expect(parseShortstat(' 2 files changed, 12 insertions(+), 4 deletions(-)')).toEqual({ insertions: 12, deletions: 4 })
    const status = [
      '# branch.oid 9f25299abcdef', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -0',
      '1 M. N... 100644 100644 100644 a b hooks/a.ts', '1 .M N... 100644 100644 100644 a b hooks/b.ts',
      '1 MM N... 100644 100644 100644 a b hooks/c.ts', '? new.txt',
    ].join('\n')
    expect(parseStatus(status)).toEqual({ branch: 'main', hash: '9f25299', ahead: 2, staged: 2, unstaged: 2 })
    expect(inboxDepth('# Scratch\n## Ramblings\n- a\n- b\n## Done\n- c')).toBe(2)
  })

  test('zigzag-alt edges and base64', async () => {
    expect([0, 1, 2, 3].map(i => rightEdge(i, 4))).toEqual(['', '', '', ''])
    expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu')
    expect(toBase64(new Uint8Array([77]))).toBe('TQ==')
  })
})
