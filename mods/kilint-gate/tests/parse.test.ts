import { describe, expect, test } from 'claude-code/testing'

import { extractCommitMessage } from '../hooks/parse'

describe('extractCommitMessage', () => {
  test('ignores commands that are not a commit', async () => {
    expect(extractCommitMessage('git status')).toBeNull()
    expect(extractCommitMessage('echo "git commit -m nope" > /dev/null')).toBeNull()
    expect(extractCommitMessage('npm test')).toBeNull()
  })

  test('reads double, single and bare -m values', async () => {
    expect(extractCommitMessage('git commit -m "feat: add the gate"')).toBe('feat: add the gate')
    expect(extractCommitMessage("git commit -m 'fix: quote it'")).toBe('fix: quote it')
    expect(extractCommitMessage('git commit -m wip')).toBe('wip')
  })

  test('joins several -m flags as paragraphs', async () => {
    expect(extractCommitMessage('git commit -m "feat: subject" -m "Body line."')).toBe('feat: subject\n\nBody line.')
  })

  test('reads glued, combined and long forms', async () => {
    expect(extractCommitMessage('git commit -am "chore: bump"')).toBe('chore: bump')
    expect(extractCommitMessage('git commit -m"glued"')).toBe('glued')
    expect(extractCommitMessage('git commit --message="feat: long"')).toBe('feat: long')
    expect(extractCommitMessage('git commit --message "feat: spaced"')).toBe('feat: spaced')
  })

  test('handles git -C and a chained push', async () => {
    const cmd = 'git -C /home/k/repo commit -m "fix: path" && git push'
    expect(extractCommitMessage(cmd)).toBe('fix: path')
  })

  test('unescapes inside double quotes', async () => {
    expect(extractCommitMessage('git commit -m "say \\"hi\\" to \\$HOME"')).toBe('say "hi" to $HOME')
  })

  test('reads the heredoc form Claude Code writes', async () => {
    const cmd = [
      'git commit -m "$(cat <<\'EOF\'',
      'feat(gate): add the kilint gate',
      '',
      'The gate lints the message before git runs.',
      '',
      'Co-Authored-By: Someone <a@b.c>',
      'EOF',
      ')"',
    ].join('\n')
    expect(extractCommitMessage(cmd)).toBe('feat(gate): add the kilint gate\n\nThe gate lints the message before git runs.')
  })

  test('skips messages it cannot read', async () => {
    expect(extractCommitMessage('git commit')).toBeNull()
    expect(extractCommitMessage('git commit -F msg.txt')).toBeNull()
    expect(extractCommitMessage('git commit --amend --no-edit')).toBeNull()
    expect(extractCommitMessage('git commit -m "$(cat msg.txt)"')).toBeNull()
    expect(extractCommitMessage('git commit -m "unclosed')).toBeNull()
  })
})
