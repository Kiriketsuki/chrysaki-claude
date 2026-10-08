import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const PANE = {
  plugin: 'chrysaki-insight',
  component: 'Pane',
  requestId: 'chrysaki-insight',
  props: { title: 'insight', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const USAGE = { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 800, cache_creation_input_tokens: 50, model: 'test-model' }

type Env = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const CATEGORY = { color: 'x', isDeferred: false }
const SESSION = {
  startedAt: 0,
  rateLimits: [],
  cost: { usd: 1.5 },
  context: {
    window: 1000,
    breakdown: {
      categories: [
        { ...CATEGORY, name: 'Messages', tokens: 50, kind: 'used' },
        { ...CATEGORY, name: 'System prompt', tokens: 300, kind: 'used' },
        { ...CATEGORY, name: 'Free space', tokens: 600, kind: 'free' },
      ],
      totalTokens: 350,
      maxTokens: 1000,
      rawMaxTokens: 1000,
      autocompactSource: 'model',
      percentage: 35,
      model: 'test-model',
    },
  },
}

// The engine sits beneath the plugin. These hooks stand in for it.
function engine(on: On) {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', async () => ({ value: SESSION }) as never)
  on('agent.list', async () => ({ value: [{ id: 'ag1', description: 'Scan the repo', type: 'Explore', status: 'running' }] }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: USAGE }
  })
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Bash' && e.command === 'fail') return { deny: 'blocked' }
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' } as never
  })
}

async function step($: Env, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId, index, model: 'test-model', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
  for await (const chunk of stream) void chunk
  return stream.result
}

test('the context tab draws the categories largest first on every surface', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-turns' })
    await ui.press({ key: 'tab-context' })
    expect(await ui.find({ text: /System prompt/ })).toBeDefined()
    expect(await ui.find({ text: /Free space/ })).toBeDefined()
    expect(await ui.find({ text: /35%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a main-thread step adds a row to the turns tab', async ($, on) => {
  engine(on)
  await step($, 't1', 0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-turns' })
  // 800 read of 970 prompt tokens is 82 percent.
  expect(await ui.find({ text: /82%/ })).toBeDefined()
  expect(await ui.find({ text: /1 requests/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent step feeds the activity tab and not the turns tab', async ($, on) => {
  engine(on)
  await step($, 't2', 0, 'ag1')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-turns' })
  expect(await ui.find({ text: /No model request yet/ })).toBeDefined()
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ text: /Explore/ })).toBeDefined()
  expect(await ui.find({ text: /Scan the repo/ })).toBeDefined()
  await ui.unmount()
})

test('a tool call shows with its summary, and a denied call shows as failed', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Bash', command: 'echo hello', description: 'say hello' })
  await $.tool.call({ tool: 'Bash', command: 'fail', description: 'refused' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-activity' })
  expect(await ui.find({ text: /echo hello/ })).toBeDefined()
  expect(await ui.find({ text: /✗/ })).toBeDefined()
  expect(await ui.find({ text: /✓/ })).toBeDefined()
  await ui.unmount()
})

test('/insight with a tab name opens the pane on that tab', async ($, on) => {
  engine(on)
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  const run = await $.command.run({ command: 'insight', args: 'turns', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  expect(run.text).toBeUndefined()
  expect(opened).toEqual(['chrysaki-insight'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /No model request yet/ })).toBeDefined()
  await ui.unmount()
})

test('/insight with an unknown word still opens the pane and says what is valid', async ($, on) => {
  engine(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  const run = await $.command.run({ command: 'insight', args: 'bogus', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  expect(run.text).toMatch(/context, turns or activity/)
})
