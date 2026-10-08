export type InsightTab = 'context' | 'turns' | 'activity'

export type InsightCategoryKind = 'used' | 'free' | 'buffer' | 'deferred'

export type InsightCategory = {
  name: string
  tokens: number
  kind: InsightCategoryKind
}

// One reading of $.session.usage({ breakdown: 'full' }). `windowTokens` is the
// window the breakdown measures against, which can be the compaction window.
export type InsightContext = {
  categories: InsightCategory[]
  totalTokens: number
  windowTokens: number
  percent: number
  model: string
  at: number
}

// One main-thread model request, taken from a turn.step result.
export type InsightTurn = {
  id: string
  at: number
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type InsightTool = {
  id: string
  name: string
  summary: string
  // The subagent that made the call, or null on the main thread.
  agentId: string | null
  start: number
  // Null while the call runs.
  end: number | null
  isFailed: boolean
}

export type InsightAgent = {
  id: string
  label: string
  type: string
  start: number
  // Null while the subagent runs.
  end: number | null
  steps: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  isFailed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'chrysaki-insight': {
      tab: InsightTab
      context: InsightContext | null
      turns: InsightTurn[]
      tools: InsightTool[]
      agents: InsightAgent[]
      // The session cost in US dollars, or null when the host keeps no ledger.
      cost: number | null
      note: string | null
    }
  }
}
