import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_PERSONAL, configDirFor, parsePersonal, personalPath } from '../hooks/personal'

const HOME = '/home/k'

describe('the personal config', () => {
  test('the path takes the env override, then the XDG config folder', async () => {
    expect(personalPath('/etc/mine.json', undefined, HOME)).toBe('/etc/mine.json')
    expect(personalPath(undefined, '/x/config', HOME)).toBe('/x/config/chrysaki/claude.json')
    expect(personalPath('', '', HOME)).toBe('/home/k/.config/chrysaki/claude.json')
  })

  test('no file, a broken file or a wrong shape gives the empty config', async () => {
    expect(parsePersonal(null, HOME)).toEqual(EMPTY_PERSONAL)
    expect(parsePersonal('{ not json', HOME)).toEqual(EMPTY_PERSONAL)
    expect(parsePersonal('[1, 2]', HOME)).toEqual(EMPTY_PERSONAL)
  })

  test('a bad field drops alone and the rest reads', async () => {
    const p = parsePersonal(JSON.stringify({
      accounts: [{ email: 'Me@Mail.example', profile: 'Main' }, { email: 'no-at-sign' }],
      sharePartners: { 'A@x.example': 'B@x.example', bad: 3 },
      configDirs: [{ match: '/work/', dir: '~/.claude-work', isWork: true }, { match: '' }],
      githubAccounts: 'not a map',
      inbox: { file: 'Inbox.md' },
    }), HOME)
    expect(p.accounts).toEqual([{ email: 'me@mail.example', profile: 'Main', path: '', isWork: false }])
    expect(p.sharePartners).toEqual({ 'a@x.example': 'b@x.example' })
    expect(p.configDirs).toEqual([{ match: '/work/', dir: '/home/k/.claude-work', isWork: true }])
    expect(p.githubAccounts).toEqual({})
    expect(p.inbox).toEqual({ file: 'Inbox.md', heading: 'Inbox' })
  })

  test('the config folder: CLAUDE_CONFIG_DIR, then a matching rule, then ~/.claude', async () => {
    const p = parsePersonal(JSON.stringify({ configDirs: [{ match: '/work/', dir: '~/.claude-work', isWork: true }] }), HOME)
    expect(configDirFor(p, '/home/k/work/app', undefined, HOME)).toEqual({ dir: '/home/k/.claude-work', isWork: true })
    expect(configDirFor(p, '/home/k/dev/app', undefined, HOME)).toEqual({ dir: '/home/k/.claude', isWork: false })
    expect(configDirFor(p, '/home/k/dev/app', '/home/k/.claude-work', HOME)).toEqual({ dir: '/home/k/.claude-work', isWork: true })
    expect(configDirFor(EMPTY_PERSONAL, '/anywhere', undefined, HOME)).toEqual({ dir: '/home/k/.claude', isWork: false })
  })
})
