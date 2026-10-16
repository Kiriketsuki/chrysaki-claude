// Builds the server list from the Claude Code config file, the project's
// .mcp.json and the tools that the session has now. Pure functions: the hooks
// in register.tsx read the files and pass the text in.

import type { McpServer, McpSource } from '../types'

// One MCP tool as $.session.usage() counts it. The server name there is the
// cleaned form of the name, for example claude_ai_Gmail for claude.ai Gmail.
export type ToolCount = { serverName: string; tokens: number }

// What the config file says about the servers of one project.
export type ConfigView = {
  user: string[]
  local: string[]
  disabled: string[]
  // The claude.ai connectors that this account has connected at some time.
  connectors: string[]
}

const EMPTY: ConfigView = { user: [], local: [], disabled: [], connectors: [] }

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const keysOf = (value: unknown): string[] => (isObject(value) ? Object.keys(value) : [])

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

// Splits the onDemand option, a comma-separated list of server names.
export function onDemandNames(option: string | undefined): string[] {
  const names = (option ?? '').split(',').map(name => name.trim()).filter(name => name !== '')
  return [...new Set(names)]
}

// Finds the project entry. Claude Code keys a project by its root, but a
// session can start in a folder below the root, so this tries each candidate.
function projectOf(config: Json, candidates: readonly string[]): Json | null {
  const projects = config.projects
  if (!isObject(projects)) return null
  for (const path of candidates) {
    const entry = projects[path]
    if (isObject(entry)) return entry
  }
  return null
}

// Reads the user servers, the local servers and the disabled list from the
// text of the config file. Text that does not parse gives an empty view.
export function readConfig(text: string, candidates: readonly string[]): ConfigView {
  let config: unknown
  try {
    config = JSON.parse(text)
  } catch {
    return EMPTY
  }
  if (!isObject(config)) return EMPTY
  const project = projectOf(config, candidates)
  return {
    user: keysOf(config.mcpServers),
    local: keysOf(project?.mcpServers),
    disabled: stringsOf(project?.disabledMcpServers),
    connectors: stringsOf(config.claudeAiMcpEverConnected),
  }
}

// Claude Code cleans a server name for the tool names: each character that is
// not a letter, a digit, _ or - becomes _.
export const cleaned = (name: string): string => name.replace(/[^a-zA-Z0-9_-]/g, '_')

// The plugin names from the enabledPlugins setting, without the marketplace.
export function pluginNames(enabled: unknown): string[] {
  if (!isObject(enabled)) return []
  return Object.entries(enabled).filter(([, isOn]) => isOn === true).map(([id]) => id.split('@')[0] ?? id)
}

// Finds the name that /mcp takes for a cleaned name. A known name that cleans
// to it wins. A plugin server is plugin:<plugin>:<key>. A name that matches
// neither stays as it is.
export function realName(serverName: string, known: readonly string[], plugins: readonly string[]): string {
  const match = known.find(name => cleaned(name) === serverName)
  if (match !== undefined) return match
  for (const plugin of plugins) {
    const prefix = `plugin_${cleaned(plugin)}_`
    if (serverName.startsWith(prefix)) return `plugin:${plugin}:${serverName.slice(prefix.length)}`
  }
  return serverName
}

// Reads the server names from the text of a .mcp.json file.
export function readRepoServers(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return isObject(parsed) ? keysOf(parsed.mcpServers) : []
  } catch {
    return []
  }
}

// One row per server. A configured server keeps the scope it came from. A
// server that only the tool list or the disabled list names reads as session.
export function catalog(
  view: ConfigView,
  repo: readonly string[],
  counted: readonly ToolCount[],
  onDemand: readonly string[],
  plugins: readonly string[] = [],
): McpServer[] {
  const known = [...view.local, ...repo, ...view.user, ...view.disabled, ...view.connectors, ...onDemand]
  const tools = counted.map(tool => ({ ...tool, serverName: realName(tool.serverName, known, plugins) }))
  const sources = new Map<string, McpSource>()
  const add = (names: readonly string[], source: McpSource) => {
    for (const name of names) if (!sources.has(name)) sources.set(name, source)
  }
  add(view.local, 'local')
  add(repo, 'repo')
  add(view.user, 'user')
  add(tools.map(tool => tool.serverName), 'session')
  add(view.disabled, 'session')

  return [...sources].map(([name, source]) => {
    const own = tools.filter(tool => tool.serverName === name)
    return {
      name,
      source,
      isDisabled: view.disabled.includes(name),
      isOnDemand: onDemand.includes(name),
      tools: own.length,
      tokens: own.reduce((sum, tool) => sum + tool.tokens, 0),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

// The on-demand servers that the mod must turn off: each one that is not off
// for this project yet. A claude.ai connector is in no config file and can
// connect after the session starts, so the list itself decides, not the rows.
export function toTurnOff(onDemand: readonly string[], view: ConfigView): string[] {
  return onDemand.filter(name => !view.disabled.includes(name))
}

// The /mcp argument that flips one server.
export function flipArgs(server: McpServer): string {
  return `${server.isDisabled ? 'enable' : 'disable'} ${server.name}`
}

// The state word that the panel draws for one server.
export function stateOf(server: McpServer, isPending: boolean): 'off' | 'on' | 'waiting' | 'pending' {
  if (isPending) return 'pending'
  if (server.isDisabled) return 'off'
  return server.tools > 0 ? 'on' : 'waiting'
}
