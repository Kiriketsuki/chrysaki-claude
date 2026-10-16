import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { McpServer } from '../types'
import { catalog, flipArgs, onDemandNames, pluginNames, readConfig, readRepoServers, toTurnOff } from './catalog'
import type { ConfigView, ToolCount } from './catalog'
import { drawPane } from './view'
import type { Act } from './view'

const PANE = 'chrysaki-mcp'
const DEFAULT_ON_DEMAND = 'mcp-atlassian'
// A server connects some seconds after /mcp enable. The panel reads the
// tools again after this wait.
const SETTLE_MS = 5_000
// At session start the /mcp command can be absent for a moment. The mod tries
// again after each wait.
const RETRY_MS = 2_000
const TRIES = 5
const GIT_TIMEOUT_MS = 5_000

const servers = atom({ plugin: 'chrysaki-mcp', key: 'servers' } as const, [] as McpServer[])
const pending = atom({ plugin: 'chrysaki-mcp', key: 'pending' } as const, [] as string[])
const note = atom({ plugin: 'chrysaki-mcp', key: 'note' } as const, null as string | null)
const applied = atom({ plugin: 'chrysaki-mcp', key: 'applied' } as const, false)

// A reload restarts the module, so this starts fresh. The pane then reads the
// servers again at its next open.
let isPaneOpen = false

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// Claude Code keeps its global config in .claude.json, in CLAUDE_CONFIG_DIR
// when that is set and in the home folder when it is not.
async function configPath($: EngineInterface): Promise<string | null> {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  if (dir !== undefined && dir !== '') return `${dir}/.claude.json`
  const home = await $.env.get('HOME')
  return home === undefined || home === '' ? null : `${home}/.claude.json`
}

// Claude Code keys the project entry of a git worktree by the main checkout,
// so a switch in a worktree reads and writes the entry of the main checkout.
async function mainCheckout($: EngineInterface, cwd: string): Promise<string | null> {
  const ran = await $.process
    .run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: GIT_TIMEOUT_MS })
    .catch(() => null)
  const dir = ran?.exitCode === 0 ? ran.stdout.trim() : ''
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : null
}

async function readView($: EngineInterface): Promise<{ view: ConfigView; repo: string[]; plugins: string[] }> {
  const root = await $.session.root()
  const cwd = await $.session.cwd()
  const main = await mainCheckout($, cwd)
  const path = await configPath($)
  const text = path === null ? '' : await $.fs.read(path)
  const repoText = await $.fs.read(`${root}/.mcp.json`).catch(() => '')
  const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
  const candidates = [main, root, cwd].filter((dir): dir is string => dir !== null)
  return { view: readConfig(text, candidates), repo: readRepoServers(repoText), plugins: pluginNames(settings.enabledPlugins) }
}

// The MCP tools that the session has now, by server, with their schema tokens.
async function readTools($: EngineInterface): Promise<ToolCount[]> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  return (usage.context.breakdown?.mcpTools ?? []).map(tool => ({ serverName: tool.serverName, tokens: tool.tokens }))
}

// Reads the servers again. The note stays: it can hold what /mcp printed.
async function refresh($: EngineInterface, onDemand: readonly string[]): Promise<void> {
  try {
    const [{ view, repo, plugins }, tools] = await Promise.all([readView($), readTools($)])
    await update($, servers, () => catalog(view, repo, tools, onDemand, plugins))
  } catch (error) {
    await update($, note, () => `The server list was not read: ${message(error)}`)
  }
}

// Runs /mcp with the arguments and returns what it printed. The command list
// can be incomplete while the session starts, so a rejection tries again.
async function runMcp($: EngineInterface, args: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const ran = await $.command.run({ command: 'mcp', args })
      return ran.text ?? ''
    } catch (error) {
      if (attempt >= TRIES) throw error
      await $.clock.sleep(RETRY_MS)
    }
  }
}

// Turns the on-demand servers off once in each session. The /mcp command saves
// the switch in the project entry, so the mod sets it again at every start.
async function applyDefaults($: EngineInterface, onDemand: readonly string[]): Promise<void> {
  try {
    const { view } = await readView($)
    for (const name of toTurnOff(onDemand, view)) await runMcp($, `disable ${name}`)
  } catch (error) {
    await update($, note, () => `An on-demand server was not turned off: ${message(error)}`).catch(() => undefined)
  }
}

async function flip($: EngineInterface, server: McpServer, onDemand: readonly string[]): Promise<void> {
  if ((await read($, pending)).includes(server.name)) return
  await update($, pending, list => [...list, server.name])
  try {
    const printed = await runMcp($, flipArgs(server))
    await update($, note, () => `/mcp ${flipArgs(server)}: ${printed || 'ran'}`)
    await refresh($, onDemand)
    await $.clock.sleep(SETTLE_MS)
    await refresh($, onDemand)
  } catch (error) {
    await update($, note, () => `/mcp ${flipArgs(server)} failed: ${message(error)}`)
  } finally {
    await update($, pending, list => list.filter(name => name !== server.name))
  }
}

async function openPane($: EngineInterface, onDemand: readonly string[]): Promise<void> {
  isPaneOpen = true
  const placed = await $.ui.open({ id: PANE, title: 'mcp', focus: true, closeOnEscape: true })
  // A pane can open undrawn, for example on a narrow terminal. Say why, so
  // that /mcp-panel never does nothing in silence.
  if (!placed.isPlaced) $.ui.toast(`The MCP panel is open but not drawn: ${placed.reason}`)
  await update($, note, () => null)
  await refresh($, onDemand)
}

async function closePane($: EngineInterface): Promise<void> {
  isPaneOpen = false
  await $.ui.close({ id: PANE })
}

function actions($: EngineInterface, onDemand: readonly string[]): Act {
  return {
    flip: server => void flip($, server, onDemand),
    refresh: () => void update($, note, () => null).then(() => refresh($, onDemand)),
    close: () => void closePane($),
  }
}

export const register: Register = (on, options) => {
  const option = options.onDemand
  const onDemand = onDemandNames(typeof option === 'string' ? option : DEFAULT_ON_DEMAND)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mcp-panel', description: 'Open the MCP panel: each server, its tools, and a key to turn it on or off', immediate: true })
    const done = await next(e)
    // Once per session. A reload of the mod keeps the state, so it does not
    // turn off a server that you turned on in the panel.
    if (!(await read($, applied))) {
      await update($, applied, () => true)
      // Not awaited: /mcp runs after the session has started, and this hook
      // holds the start.
      void applyDefaults($, onDemand)
    }
    return done
  })

  on('command.run', { command: 'mcp-panel' }, async $ => {
    await openPane($, onDemand)
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false
    return next(e)
  })

  // A server can connect or fail during a turn. Read the list again at the end
  // of each turn while the panel shows.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (isPaneOpen && e.agentId === undefined) await refresh($, onDemand)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    return drawPane(ui, { servers: await read($, servers), pending: await read($, pending), note: await read($, note) }, actions($, onDemand))
  })
}
