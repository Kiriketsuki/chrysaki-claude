import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'chrysaki-mcp',
  component: 'Pane',
  requestId: 'chrysaki-mcp',
  surface: 'terminal',
  props: { title: 'mcp', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const ROOT = '/home/dev/repo'
const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true } } as never

type World = { disabled: string[]; connected: Record<string, number>; runs: string[]; isBroken?: boolean }

// The engine sits beneath the plugin. These hooks stand in for it. The /mcp
// command changes the disabled list and the connected tools, as Claude Code does.
function engine(on: On, world: World) {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('session.root', async () => ({ value: ROOT }))
  on('session.cwd', async () => ({ value: ROOT }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('fs.read', async (_$, e) => {
    if (e.path !== '/home/dev/.claude.json') throw new Error('ENOENT')
    const config = {
      mcpServers: { 'mcp-atlassian': {}, openviking: {} },
      projects: { [ROOT]: { disabledMcpServers: world.disabled } },
    }
    return { value: JSON.stringify(config) } as never
  })
  on('session.usage', async () => {
    const mcpTools = Object.entries(world.connected).flatMap(([serverName, count]) =>
      Array.from({ length: count }, (_, i) => ({ name: `mcp__${serverName}__t${i}`, serverName, tokens: 100, isLoaded: true })))
    return { value: { startedAt: 0, rateLimits: [], context: { breakdown: { mcpTools } } } } as never
  })
  on('command.run', { command: 'mcp' }, async (_$, e) => {
    world.runs.push(e.args)
    if (world.isBroken === true) throw new Error('the /mcp command failed')
    const [verb, ...rest] = e.args.split(' ')
    const name = rest.join(' ')
    if (verb === 'disable') {
      world.disabled = [...world.disabled, name]
      delete world.connected[name]
    } else {
      world.disabled = world.disabled.filter(item => item !== name)
      world.connected[name] = 4
    }
    return { text: `MCP server "${name}" ${verb}d` }
  })
  return clock
}

test('a session start turns the on-demand server off once', async ($, on) => {
  const world: World = { disabled: [], connected: { 'mcp-atlassian': 49, openviking: 10 }, runs: [] }
  const clock = engine(on, world)
  await $.session.start(START as never)
  await clock.advance(0)
  expect(world.runs).toEqual(['disable mcp-atlassian'])

  await $.session.start(START as never)
  await clock.advance(0)
  expect(world.runs).toEqual(['disable mcp-atlassian'])
})

test('a server already off for the project gets no second disable', async ($, on) => {
  const world: World = { disabled: ['mcp-atlassian'], connected: { openviking: 10 }, runs: [] }
  const clock = engine(on, world)
  await $.session.start(START as never)
  await clock.advance(0)
  expect(world.runs).toEqual([])
})

test('the panel lists each server with its state and tools, and a key turns one on', async ($, on) => {
  const world: World = { disabled: ['mcp-atlassian'], connected: { openviking: 10 }, runs: [] }
  const clock = engine(on, world)
  await $.command.run({ command: 'mcp-panel', args: '', ...(RUN as object) } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /openviking/ })).toBeDefined()
  expect(await ui.find({ text: /10 tools · 1\.0k/ })).toBeDefined()
  expect(await ui.find({ text: /on demand/ })).toBeDefined()
  expect(await ui.find({ text: /off/ })).toBeDefined()

  await ui.press({ key: 'srv-mcp-atlassian' })
  await clock.advance(5_000)
  expect(world.runs).toEqual(['enable mcp-atlassian'])
  expect(await ui.find({ text: /4 tools/ })).toBeDefined()
  expect(await ui.find({ text: /turn off/ })).toBeDefined()
  expect(await ui.find({ text: /mcp enable mcp-atlassian: MCP server "mcp-atlassian" enabled/ })).toBeDefined()
  await ui.unmount()
})

test('a failed /mcp leaves a note in the panel', async ($, on) => {
  const world: World = { disabled: [], connected: { openviking: 10 }, runs: [], isBroken: true }
  const clock = engine(on, world)
  await $.command.run({ command: 'mcp-panel', args: '', ...(RUN as object) } as never)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'srv-openviking' })
  await clock.advance(20_000)
  expect(await ui.find({ text: /disable openviking failed/ })).toBeDefined()
  expect(world.runs).toEqual(Array.from({ length: 5 }, () => 'disable openviking'))
  await ui.unmount()
})
