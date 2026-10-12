import { describe, expect, test } from 'claude-code/testing'

import { parseStatus, readIdentity } from '../hooks/collect'
import { parsePersonal } from '../hooks/personal'
import type { Host } from '../hooks/collect'
import {
  barCells, capPath, ctxColor, ctxMarker, fiveHourColor, inboxDepth, isHandoffDue, marker, modelLabel,
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
    expect(ctxColor(60, 120000)).toBe(ROLE.teal)
    expect(ctxColor(25, 250000)).toBe(ROLE.warn)
    expect(ctxColor(50, 500000)).toBe(ROLE.error)
    expect(ctxMarker(60, 120000)).toBe('▰')
    expect(ctxMarker(25, 250000)).toBe('▱')
    expect(ctxMarker(50, 500000)).toBe('◆')
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
    // The line bar fills in half cells: 81% of 8 cells is 13 halves.
    expect(barCells(81, 'line', 0).map(c => c.glyph).join('')).toBe('━━━━━━╸─')
    expect(barCells(75, 'line', 0).map(c => c.glyph).join('')).toBe('━━━━━━──')
  })

  test('cwd, model and remote', async () => {
    expect(smartCwd('/home/k/dots/chrysaki', '/home/k')).toBe('dots/chrysaki')
    expect(smartCwd('/home/k/dots', '/home/k')).toBe('dots')
    expect(smartCwd('C:\\Users\\Kidriel\\dev\\obKidian', 'C:\\Users\\Kidriel')).toBe('dev/obKidian')
    expect(smartCwd('C:\\Users\\Kidriel\\obKidian\\', 'c:/users/kidriel/')).toBe('obKidian')
    expect(smartCwd('C:/Users/Kidriel/dev/obKidian', 'C:\\Users\\Kidriel')).toBe('dev/obKidian')
    expect(capPath('dev/obKidian', 12)).toBe('dev/obKidian')
    expect(capPath('dev/obKidian', 11)).toBe('…v/obKidian')
    expect(capPath('Personal/dev/obKidian', 14)).toBe('…/dev/obKidian')
    expect(capPath('dev/obKidian', 10)).toBe('…/obKidian')
    expect(capPath('dev/obKidian', 3)).toBe('…/obKidian')
    expect(capPath('obKidian', 3)).toBe('obKidian')
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
    expect(parseStatus(status)).toEqual({
      branch: 'main', hash: '9f25299', ahead: 2, behind: 0, staged: 2, unstaged: 2, untracked: 1, upstream: 'origin/main',
    })
    expect(inboxDepth('# Scratch\n## Ramblings\n- a\n- b\n## Done\n- c', 'Ramblings')).toBe(2)
    expect(inboxDepth('## Inbox\n- a\n## Ramblings\n- b', 'Inbox')).toBe(1)
  })

  test('zigzag-alt edges and base64', async () => {
    expect([0, 1, 2, 3].map(i => rightEdge(i, 4))).toEqual(['', '', '', ''])
    expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu')
    expect(toBase64(new Uint8Array([77]))).toBe('TQ==')
  })
})

describe('the account email on Windows paths', () => {
  const HOME = 'C:\\Users\\Kidriel'
  const PERSONAL = parsePersonal(JSON.stringify({ configDirs: [{ match: '/workdev/Aurrigo', dir: '~/.claude-aurrigo', isWork: true }] }), HOME)
  // A host that answers the reads of one machine and records the file it opened.
  function host(over: Partial<Host>, files: Record<string, string>): { host: Host; opened: string[] } {
    const opened: string[] = []
    const base: Host = {
      run: async () => ({ exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }),
      readFile: async path => {
        opened.push(path)
        const text = files[path.replace(/\\/g, '/')]
        if (text === undefined) throw new Error('missing')
        return text
      },
      exists: async () => true,
      model: async () => 'claude-opus-5-5',
      version: async () => '2.1.295',
      cwd: async () => 'C:\\Users\\Kidriel\\dev\\obKidian',
      home: async () => HOME,
      configDir: async () => `${HOME}\\.claude`,
      ...over,
    }
    return { host: base, opened }
  }
  const mail = (emailAddress: string) => JSON.stringify({ oauthAccount: { emailAddress } })

  test('a config dir that ends in a backslash .claude reads the .claude.json at HOME', async () => {
    const { host: h, opened } = host({}, { 'C:/Users/Kidriel/.claude.json': mail('kiriketsuki@gmail.com') })
    const id = await readIdentity(h, PERSONAL)
    expect(id.email).toBe('kiriketsuki@gmail.com')
    expect(id.isWorkAccount).toBe(false)
    expect(opened).toEqual(['C:/Users/Kidriel/.claude.json'])
  })

  test('a work config dir reads its own .claude.json and marks the work account', async () => {
    const { host: h } = host({ configDir: async () => `${HOME}\\.claude-aurrigo` }, { 'C:/Users/Kidriel/.claude-aurrigo/.claude.json': mail('limj@aurrigo.com') })
    const id = await readIdentity(h, PERSONAL)
    expect(id.email).toBe('limj@aurrigo.com')
    expect(id.isWorkAccount).toBe(true)
  })

  test('with no config dir a cwd under workdev Aurrigo picks the work config', async () => {
    const { host: h, opened } = host({ configDir: async () => undefined, cwd: async () => 'C:\\Users\\Kidriel\\workdev\\Aurrigo\\act' }, {})
    const id = await readIdentity(h, PERSONAL)
    expect(id.isWorkAccount).toBe(true)
    expect(id.email).toBe('unknown')
    expect(opened).toEqual(['C:/Users/Kidriel/.claude-aurrigo/.claude.json'])
  })
})
