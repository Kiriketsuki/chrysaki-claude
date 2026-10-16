import { expect, test } from 'claude-code/testing'

import { catalog, flipArgs, onDemandNames, pluginNames, readConfig, readRepoServers, realName, stateOf, toTurnOff } from '../hooks/catalog'

const CONFIG = JSON.stringify({
  mcpServers: { 'mcp-atlassian': { type: 'stdio' }, openviking: { type: 'stdio' } },
  claudeAiMcpEverConnected: ['claude.ai Slack'],
  projects: {
    '/home/dev/repo': { mcpServers: { figma: { type: 'http' } }, disabledMcpServers: ['claude.ai Gmail'] },
  },
})

test('the onDemand option splits on commas and drops blanks and repeats', () => {
  expect(onDemandNames(' mcp-atlassian, ,claude.ai Atlassian,mcp-atlassian')).toEqual(['mcp-atlassian', 'claude.ai Atlassian'])
  expect(onDemandNames(undefined)).toEqual([])
})

test('the config gives the user servers, and the local servers and disabled list of the first project that matches', () => {
  expect(readConfig(CONFIG, ['/home/dev/repo/sub', '/home/dev/repo'])).toEqual({
    user: ['mcp-atlassian', 'openviking'],
    local: ['figma'],
    disabled: ['claude.ai Gmail'],
    connectors: ['claude.ai Slack'],
  })
  expect(readConfig(CONFIG, ['/elsewhere'])).toEqual({ user: ['mcp-atlassian', 'openviking'], local: [], disabled: [], connectors: ['claude.ai Slack'] })
  expect(readConfig('{ not json', ['/home/dev/repo'])).toEqual({ user: [], local: [], disabled: [], connectors: [] })
})

test('a .mcp.json file gives its server names, and bad text gives none', () => {
  expect(readRepoServers('{"mcpServers":{"linear":{}}}')).toEqual(['linear'])
  expect(readRepoServers('')).toEqual([])
})

test('each server shows once, with its scope, its tools and their tokens', () => {
  const view = readConfig(CONFIG, ['/home/dev/repo'])
  const tools = [
    { serverName: 'openviking', tokens: 300 },
    { serverName: 'openviking', tokens: 200 },
    { serverName: 'claude_ai_Slack', tokens: 900 },
  ]
  const rows = catalog(view, ['linear'], tools, ['mcp-atlassian'])
  expect(rows.map(row => [row.name, row.source])).toEqual([
    ['claude.ai Gmail', 'session'],
    ['claude.ai Slack', 'session'],
    ['figma', 'local'],
    ['linear', 'repo'],
    ['mcp-atlassian', 'user'],
    ['openviking', 'user'],
  ])
  const viking = rows.find(row => row.name === 'openviking')
  expect(viking?.tools).toBe(2)
  expect(viking?.tokens).toBe(500)
  expect(rows.find(row => row.name === 'mcp-atlassian')?.isOnDemand).toBe(true)
  expect(rows.find(row => row.name === 'claude.ai Gmail')?.isDisabled).toBe(true)
})

test('the mod turns off each on-demand server that is not off for the project yet', () => {
  const view = { user: [], local: [], disabled: ['claude.ai Atlassian'], connectors: [] }
  expect(toTurnOff(['mcp-atlassian', 'claude.ai Atlassian'], view)).toEqual(['mcp-atlassian'])
})

test('a flip enables a disabled server and disables any other', () => {
  const server = { name: 'claude.ai Atlassian', source: 'session', isDisabled: true, isOnDemand: true, tools: 0, tokens: 0 } as const
  expect(flipArgs(server)).toBe('enable claude.ai Atlassian')
  expect(flipArgs({ ...server, isDisabled: false })).toBe('disable claude.ai Atlassian')
})

test('the state word follows the switch, then the tools', () => {
  const server = { name: 'x', source: 'user', isDisabled: false, isOnDemand: false, tools: 0, tokens: 0 } as const
  expect(stateOf(server, true)).toBe('pending')
  expect(stateOf({ ...server, isDisabled: true }, false)).toBe('off')
  expect(stateOf(server, false)).toBe('waiting')
  expect(stateOf({ ...server, tools: 3 }, false)).toBe('on')
})

test('a cleaned tool server name maps back to the name that /mcp takes', () => {
  const known = ['claude.ai Google Drive', 'mcp-atlassian']
  const plugins = pluginNames({ 'context7@claude-plugins-official': true, 'slack@claude-plugins-official': false })
  expect(plugins).toEqual(['context7'])
  expect(realName('claude_ai_Google_Drive', known, plugins)).toBe('claude.ai Google Drive')
  expect(realName('mcp-atlassian', known, plugins)).toBe('mcp-atlassian')
  expect(realName('plugin_context7_context7', known, plugins)).toBe('plugin:context7:context7')
  expect(realName('clodeks', known, plugins)).toBe('clodeks')
})
