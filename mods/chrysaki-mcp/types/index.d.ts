// Where the panel found a server.
export type McpSource =
  // The user scope of the Claude Code config file.
  | 'user'
  // The project entry of that file.
  | 'local'
  // The .mcp.json file at the project root.
  | 'repo'
  // Only the tool list or the disabled list, for example a claude.ai connector or a plugin server.
  | 'session'

// One MCP server as the panel shows it.
export type McpServer = {
  // The name that /mcp lists, and that /mcp enable and /mcp disable take.
  name: string
  source: McpSource
  // True when /mcp disable turned the server off for this project.
  isDisabled: boolean
  // True when the server is on the on-demand list: off at each session start.
  isOnDemand: boolean
  // The tools that the session has from the server now. Zero while the server
  // connects, fails, waits for a sign-in, or is off.
  tools: number
  // The estimated tokens of those tool schemas.
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'chrysaki-mcp': {
      // Every server, in the order that the panel lists them.
      servers: McpServer[]
      // The servers with an /mcp enable or /mcp disable in flight.
      pending: string[]
      note: string | null
      // True after the mod turned the on-demand servers off in this session.
      applied: boolean
    }
  }
}
