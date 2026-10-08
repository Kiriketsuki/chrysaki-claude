import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SEED_ACCOUNTS, guessWork, parseAccounts, parseProfiles, resolvePaths, upsertAccount } from '../hooks/accounts'

const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const NOW = Date.parse('2098-12-31T19:35:00Z')
const FF = '/home/k/.mozilla/firefox'
const PROFILES = `Original profile\t${FF}/a.default-release\nWork Claude\t${FF}/b.Profile 6\nWork Claude 2\t${FF}/c.Profile 7\n`

describe('the account model', () => {
  test('profiles parse from the lister and fill in paths by name', async () => {
    const list = parseProfiles(PROFILES + 'bad line\nNo path\trelative\n')
    expect(list.map(p => p.name)).toEqual(['Original profile', 'Work Claude', 'Work Claude 2'])
    const resolved = resolvePaths(SEED_ACCOUNTS, list)
    expect(resolved.find(a => a.email === 'limj@aurrigo.com')?.path).toBe(`${FF}/c.Profile 7`)
  })

  test('the store value is checked, and an email adds once', async () => {
    expect(parseAccounts('x')).toBe(null)
    expect(parseAccounts([{ email: 'not an email', profile: 'p' }, { email: ' A@B.co ', profile: 'p' }])).toEqual([
      { email: 'a@b.co', profile: 'p', path: '', isWork: false },
    ])
    const one = upsertAccount([], { email: 'X@y.io', profile: 'p', path: '/p', isWork: true })
    expect(upsertAccount(one, { email: 'x@y.io', profile: 'q', path: '/q', isWork: true })).toEqual([
      { email: 'x@y.io', profile: 'q', path: '/q', isWork: true },
    ])
    expect(guessWork('a@gmail.com')).toBe(false)
    expect(guessWork('a@aurrigo.com')).toBe(true)
  })
})

function props(bodyColumns: number) {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} }
}

type Seen = { env: [string, string | undefined][]; ran: string[]; stored: unknown[] }

async function start($: Engine, on: On): Promise<Seen> {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/k' })
  const seen: Seen = { env: [], ran: [], stored: [] }
  on('process.run', async (_$, e) => {
    if (e.argv[0]?.endsWith('/bin/firefox-profiles')) return { value: { ...RAN, stdout: PROFILES } }
    return { value: { ...RAN, exitCode: 1, stdout: '' } }
  })
  on('fs.read', async () => ({ value: JSON.stringify({ oauthAccount: { emailAddress: 'kiriketsuki@gmail.com' } }) }))
  on('fs.exists', async () => ({ value: true }))
  on('env.set', async (_$, e) => {
    seen.env.push([e.name, e.value])
    return { value: undefined }
  })
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: [] }))
  on('command.run', async (_$, e) => {
    seen.ran.push(e.command)
    return {}
  })
  on('store.get', async () => ({ value: undefined }))
  on('store.set', async (_$, e) => {
    seen.stored.push(e.value)
    return { value: undefined }
  })
  on('session.usage', async () => ({ value: { startedAt: NOW, context: { window: 1000000 }, rateLimits: [] } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  return seen
}

test('the account segment opens the dropdown, and a pick logs in through the profile', async ($, on) => {
  const seen = await start($, on)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  expect(await ui.find({ key: 'account-pick' })).toBeUndefined()
  await ui.press({ key: 'account' })
  const pick = await ui.find({ key: 'account-pick' })
  expect(pick).toBeDefined()
  await ui.select({ key: 'account-pick', value: 'jlim@aurrigo.com' })
  expect(seen.ran).toEqual(['login'])
  expect(seen.env).toContainEqual(['CHRYSAKI_LOGIN_PROFILE', `${FF}/b.Profile 6`])
  expect(seen.env.some(([name, value]) => name === 'BROWSER' && (value ?? '').endsWith('/bin/open-in-profile'))).toBe(true)
  // The dropdown closes on a pick.
  expect(await ui.find({ key: 'account-pick' })).toBeUndefined()
  await ui.unmount()
})

test('picking the account in use runs no login', async ($, on) => {
  const seen = await start($, on)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  await ui.press({ key: 'account' })
  await ui.select({ key: 'account-pick', value: 'kiriketsuki@gmail.com' })
  expect(seen.ran).toEqual([])
  await ui.unmount()
})

test('a new account saves with the picked profile', async ($, on) => {
  const seen = await start($, on)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  await ui.press({ key: 'account' })
  await ui.press({ key: 'account-add' })
  await ui.input({ key: 'account-email', text: 'new@aurrigo.com', kind: 'change' })
  await ui.select({ key: 'account-profile', value: `${FF}/c.Profile 7` })
  await ui.press({ key: 'account-save' })
  const last = parseAccounts(seen.stored[seen.stored.length - 1])
  expect(last?.find(a => a.email === 'new@aurrigo.com')).toEqual({ email: 'new@aurrigo.com', profile: 'Work Claude 2', path: `${FF}/c.Profile 7`, isWork: true })
  // Back to the account list after a save.
  expect(await ui.find({ key: 'account-pick' })).toBeDefined()
  await ui.unmount()
})
