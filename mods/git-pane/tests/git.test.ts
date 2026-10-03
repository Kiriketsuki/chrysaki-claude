import { describe, expect, test } from 'claude-code/testing'

import { parseBranches, parseLog, parseStatus, shQuote } from '../hooks/git'
import { branchColor, C, prettyGraph } from '../hooks/theme'

const STATUS = [
  '# branch.oid 1234567890abcdef',
  '# branch.head feature/5-git-pane',
  '# branch.upstream origin/feature/5-git-pane',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaa aaa hooks/view.tsx',
  '1 A. N... 000000 100644 100644 000 bbb hooks/my file.ts',
  '2 R. N... 100644 100644 100644 ccc ccc R100 hooks/new.ts',
  'hooks/old.ts',
  'u UU N... 100644 100644 100644 100644 d1 d2 d3 conflict.md',
  '? notes.md',
  '',
].join('\0')

describe('parseStatus', () => {
  test('reads the branch header', async () => {
    const s = parseStatus(STATUS)
    expect(s.branch).toBe('feature/5-git-pane')
    expect(s.upstream).toBe('origin/feature/5-git-pane')
    expect(s.ahead).toBe(2)
    expect(s.behind).toBe(1)
    expect(s.oid).toBe('12345678')
  })

  test('reads changed, renamed, conflicted and untracked entries', async () => {
    const files = parseStatus(STATUS).files
    expect(files.map(f => f.path)).toEqual(['hooks/view.tsx', 'hooks/my file.ts', 'hooks/new.ts', 'conflict.md', 'notes.md'])
    expect(files[0]).toMatchObject({ x: '.', y: 'M', isUntracked: false })
    expect(files[2]).toMatchObject({ orig: 'hooks/old.ts', x: 'R' })
    expect(files[3]?.isConflicted).toBe(true)
    expect(files[4]?.isUntracked).toBe(true)
  })

  test('names a detached head', async () => {
    expect(parseStatus('# branch.head (detached)\0').branch).toBe('HEAD')
  })
})

describe('parseLog', () => {
  test('splits commits from graph connector rows', async () => {
    const out = '* \x1fb456925\x1ffeat: add\x1fK\x1f1 hour ago\x1fHEAD -> main\n|\\\n* \x1fbca33b8\x1fchore: tidy\x1fK\x1f2 days ago\x1f\n'
    const log = parseLog(out)
    expect(log).toHaveLength(3)
    expect(log[0]).toMatchObject({ graph: '* ', hash: 'b456925', subject: 'feat: add', refs: 'HEAD -> main' })
    expect(log[1]?.hash).toBeNull()
  })
})

describe('parseBranches', () => {
  test('marks the current branch', async () => {
    const out = '*\x1fmain\x1forigin/main\x1f\x1f2 days ago\n \x1ffeature/5\x1f\x1f\x1f1 hour ago\n'
    const b = parseBranches(out)
    expect(b[0]).toMatchObject({ name: 'main', isHead: true, upstream: 'origin/main' })
    expect(b[1]?.isHead).toBe(false)
  })
})

describe('helpers', () => {
  test('shQuote survives a single quote', async () => {
    expect(shQuote("feat: it's done")).toBe("'feat: it'\\''s done'")
  })

  test('branch colours follow the lazygit patterns', async () => {
    expect(branchColor('main')).toBe(C.blonde)
    expect(branchColor('feature/5-x')).toBe(C.emeraldLt)
    expect(branchColor('fix/9-y')).toBe(C.errorLt)
    expect(branchColor('epic/3-z')).toBe(C.tealLt)
  })

  test('the graph uses the lazygit glyph swap', async () => {
    expect(prettyGraph('* | -')).toBe('● ┆ ╌')
  })
})
