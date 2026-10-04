import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const STATUS = '# branch.oid 9f25299abcdef\n# branch.head main\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b x.ts\n'

function props(bodyColumns: number) {
  return {
    hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns,
    scroll: { offset: 0, bodyRows: 12 }, view: {},
  }
}

// The engine's own session.measure step echoes { changed }. A test stands in for it.
// The engine's own band beneath the plugins draws an empty Box here.
function answerMeasure(on: On): MockClock {
  const clock = mock.clock(on, { now: Date.parse('2098-12-31T19:35:00Z') })
  mock.env(on, { HOME: '/home/k' })
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  return clock
}

const MEASURE = {
  context: { tokens: 130000, window: 200000, percent: 65 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 80, resetsAt: '2099-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 20 },
  ],
  cost: { usd: 2 },
  changed: ['context', 'rateLimits', 'cost'] as ('context' | 'rateLimits' | 'cost')[],
}

test('draws the four lines with the bash thresholds on every surface', async ($, on) => {
  answerMeasure(on)
  on('process.run', async (_$, e) => {
    const cmd = e.argv.join(' ')
    if (cmd.startsWith('git status')) return { value: { ...RAN, stdout: STATUS } }
    if (cmd.includes('--shortstat')) return { value: { ...RAN, stdout: ' 1 file changed, 5 insertions(+), 2 deletions(-)' } }
    if (cmd.includes('rev-parse')) return { value: { ...RAN, stdout: '.git\n' } }
    if (cmd.includes('get-url')) return { value: { ...RAN, stdout: 'git@github.com:someone/else.git\n' } }
    return { value: { ...RAN, exitCode: 1, stdout: '' } }
  })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }))
  await $.session.measure(MEASURE)
  // A git command from the model makes the mod read git again.
  await $.tool.call({ tool: 'Bash', command: 'git status' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface, component: 'AbovePrompt', props: props(160) })
    const five = await ui.find({ type: 'Text', text: /5h/ })
    expect(five?.props.color).toBe('#b53f4a')
    const seven = await ui.find({ type: 'Text', text: /7d/ })
    expect(seven?.props.color).toBe('#a0a4b8')
    expect(await ui.find({ type: 'Text', text: /handoff/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$2\.70/ })).toBeDefined()
    expect(await ui.find({ key: 'ctx-detail' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\u2387 main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+10$/ })).toBeDefined()
    // Both shortstat calls answer 5 insertions, so the total is 10.
    // The band composes: the band beneath still draws below the statusline.
    expect(await ui.find({ key: 'engine-band' })).toBeDefined()
  }
})

test('folds to two lines on a narrow band', async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface, component: 'AbovePrompt', props: props(80) })
    expect(await ui.find({ type: 'Text', text: /5h 80%/ })).toBeDefined()
    expect(await ui.find({ key: 'ctx-detail' })).toBeUndefined()
  }
})

test('yields to a survey', async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: { ...props(160), hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: /5h/ })).toBeUndefined()
})

// The git key: a band Button that opens the git-pane mod's /git command.
async function gitButtonTest($: Engine, on: On, commands: string[]): Promise<{ found: boolean; ran: string[] }> {
  const clock = answerMeasure(on)
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    const cmd = e.argv.join(' ')
    if (cmd.startsWith('git status')) return { value: { ...RAN, stdout: STATUS } }
    return { value: { ...RAN, exitCode: 1, stdout: '' } }
  })
  on('env.set', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: false }))
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: commands.map(name => ({ name, description: name, source: 'plugin' as const })) }))
  on('command.run', async (_$, e) => { ran.push(e.command); return { text: 'opened' } })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(160) })
  const button = await ui.find({ key: 'git-pane' })
  if (button !== undefined) await ui.press({ key: 'git-pane' })
  return { found: button !== undefined, ran }
}

test('draws the git key when /git exists and runs it on press', async ($, on) => {
  const r = await gitButtonTest($, on, ['compact', 'git'])
  expect(r.found).toBe(true)
  expect(r.ran).toEqual(['git'])
})

test('draws no git key without the git-pane mod', async ($, on) => {
  const r = await gitButtonTest($, on, ['compact'])
  expect(r.found).toBe(false)
})
