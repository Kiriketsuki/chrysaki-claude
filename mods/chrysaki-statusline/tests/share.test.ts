import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { OFFER_WINDOW_MS, artifactUrlFrom, isNewPublish, liveOffer, offerFor, parseOffered, withOffered } from '../hooks/share'

const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const NOW = Date.parse('2098-12-31T19:35:00Z')
const PERSONAL = JSON.stringify({ accounts: [{ email: 'me@gmail.com', profile: 'Original profile' }, { email: 'ana@work.example', profile: 'Work Claude', isWork: true }, { email: 'ben@work.example', profile: 'Work Claude 2', isWork: true }], sharePartners: { 'ana@work.example': 'ben@work.example', 'ben@work.example': 'ana@work.example' } })
const FF = '/home/k/.mozilla/firefox'
const PROFILES = `Original profile\t${FF}/a.default-release\nWork Claude\t${FF}/b.Profile 6\nWork Claude 2\t${FF}/c.Profile 7\n`
const URL = 'https://claude.ai/artifact/De1TRyedqoXdC6pQ5EfdNy'
const PARTNERS = { 'ana@work.example': 'ben@work.example', 'ben@work.example': 'ana@work.example' }
const ACCOUNTS = [
  { email: 'ana@work.example', profile: 'Work Claude', path: `${FF}/b.Profile 6`, isWork: true },
  { email: 'ben@work.example', profile: 'Work Claude 2', path: `${FF}/c.Profile 7`, isWork: true },
]

describe('the share model', () => {
  test('only a publish with no url and no asset can make a new artifact', async () => {
    expect(isNewPublish({})).toBe(true)
    expect(isNewPublish({ action: 'publish' })).toBe(true)
    expect(isNewPublish({ action: 'publish', url: URL })).toBe(false)
    expect(isNewPublish({ action: 'publish', asset: true })).toBe(false)
    expect(isNewPublish({ action: 'read' })).toBe(false)
  })

  test('finds the artifact link in the result text', async () => {
    expect(artifactUrlFrom(`Published ⧉ ${URL}?sk=abc\nWatching it.`)).toBe(URL)
    expect(artifactUrlFrom('Published ⧉ https://claude.ai/code/artifact/0b1c-22ff')).toBe('https://claude.ai/code/artifact/0b1c-22ff')
    expect(artifactUrlFrom('no link here')).toBe(null)
  })

  test('each work account offers the share to the other', async () => {
    expect(offerFor(URL, 'Ana@work.example', ACCOUNTS, [], NOW, PARTNERS)).toEqual({ url: URL, owner: 'ana@work.example', partner: 'ben@work.example', path: `${FF}/b.Profile 6`, at: NOW })
    expect(offerFor(URL, 'ben@work.example', ACCOUNTS, [], NOW, PARTNERS)?.partner).toBe('ana@work.example')
    expect(offerFor(URL, 'me@gmail.com', ACCOUNTS, [], NOW, PARTNERS)).toBe(null)
    expect(offerFor(URL, 'ana@work.example', ACCOUNTS, [URL], NOW, PARTNERS)).toBe(null)
  })

  test('the offered list is checked, keeps the newest, and an offer lapses', async () => {
    expect(parseOffered(['a', 3, 'b'])).toEqual(['a', 'b'])
    expect(parseOffered('x')).toEqual([])
    expect(withOffered(['a', 'b'], 'a')).toEqual(['b', 'a'])
    const many = Array.from({ length: 250 }, (_, i) => `u${i}`)
    expect(withOffered(many, 'new')).toHaveLength(200)
    const o = offerFor(URL, 'ana@work.example', ACCOUNTS, [], NOW, PARTNERS)
    expect(liveOffer(o, NOW + OFFER_WINDOW_MS)).toEqual(o)
    expect(liveOffer(o, NOW + OFFER_WINDOW_MS + 1)).toBe(null)
  })
})

function props(bodyColumns: number) {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} }
}

// A session signed in as ana@work.example. The store keeps what the mod
// writes, and every process the mod starts is recorded.
async function start($: Engine, on: On): Promise<{ ran: string[][]; clock: MockClock }> {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/k' })
  const ran: string[][] = []
  const store = new Map<string, unknown>()
  on('process.run', async (_$, e) => {
    ran.push([...e.argv])
    if (e.argv[0]?.endsWith('/bin/firefox-profiles')) return { value: { ...RAN, stdout: PROFILES } }
    return { value: { ...RAN, exitCode: 1, stdout: '' } }
  })
  // The personal config names the accounts and the share pairs. Every other read is the credentials file.
  on('fs.read', async (_$, e) => ({ value: e.path === '/home/k/.config/chrysaki/claude.json' ? PERSONAL : JSON.stringify({ oauthAccount: { emailAddress: 'ana@work.example' } }) }))
  on('fs.exists', async () => ({ value: true }))
  on('env.set', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: [] }))
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.usage', async () => ({ value: { startedAt: NOW, context: { window: 1000000 }, rateLimits: [] } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  on('tool.call', { tool: 'Artifact' }, async () => ({ result: {}, text: `Published ⧉ ${URL}?sk=abc` }))
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  return { ran, clock }
}

test('a new artifact offers the share, and the key opens it in the owner profile', async ($, on) => {
  const { ran } = await start($, on)
  await $.tool.call({ tool: 'Artifact', file_path: 'page.html' } as never)
  expect(ran.some(argv => argv[2]?.endsWith('/bin/share-notify') && argv[4] === URL && argv[5] === 'ben@work.example')).toBe(true)

  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  await ui.press({ key: 'share' })
  expect(ran).toContainEqual(['setsid', '-f', 'firefox', '--profile', `${FF}/b.Profile 6`, '-new-tab', URL])
  // The press clears the offer.
  expect(await ui.find({ key: 'share' })).toBeUndefined()
  await ui.unmount()
})

test('a republish of the same artifact and an update give no offer', async ($, on) => {
  const { ran } = await start($, on)
  await $.tool.call({ tool: 'Artifact', file_path: 'page.html' } as never)
  const notices = () => ran.filter(argv => argv[2]?.endsWith('/bin/share-notify')).length
  expect(notices()).toBe(1)
  await $.tool.call({ tool: 'Artifact', file_path: 'page.html' } as never)
  await $.tool.call({ tool: 'Artifact', file_path: 'page.html', url: URL } as never)
  expect(notices()).toBe(1)
})
