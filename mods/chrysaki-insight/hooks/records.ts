// Record keeping for the insight pane. Every function returns a new list and
// leaves its input alone, so the same code serves the $.state updaters and the
// unit tests.

import type { InsightAgent, InsightCategory, InsightContext, InsightTool, InsightTurn } from '../types'
import { truncate } from './format'

export const KEEP = 200

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// Keeps the newest `max` records. Lists run oldest first, and the view
// reverses them.
export function capped<T>(list: readonly T[], item: T, max: number = KEEP): T[] {
  return [...list, item].slice(-max)
}

export function turnRow(id: string, at: number, model: string, usage: Usage): InsightTurn {
  return {
    id,
    at,
    model,
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
  }
}

// The share of the prompt that the cache served. Null when the request had no
// input at all, so that the view shows a dash and not a false 0%.
export function cacheHit(row: Pick<InsightTurn, 'input' | 'cacheRead' | 'cacheWrite'>): number | null {
  const total = row.input + row.cacheRead + row.cacheWrite
  return total > 0 ? Math.round((row.cacheRead / total) * 100) : null
}

// --- Tools ------------------------------------------------------------------

// Fields that usually hold what a tool call is about, most telling first.
const SUMMARY_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill'] as const
const RESERVED = new Set(['tool', 'tool_use_id', 'agentId'])

// One short line that says what the call does. The engine's tool inputs vary,
// and MCP tools have no fixed shape, so this reads strings by key and falls
// back to the first string field it finds.
export function summarizeInput(input: Readonly<Record<string, unknown>>, max = 60): string {
  const pick = (key: string): string | null => {
    const v = input[key]
    return typeof v === 'string' && v.trim().length > 0 ? v : null
  }
  for (const key of SUMMARY_KEYS) {
    const v = pick(key)
    if (v !== null) return truncate(v, max)
  }
  for (const [key, value] of Object.entries(input)) {
    if (!RESERVED.has(key) && typeof value === 'string' && value.trim().length > 0) return truncate(value, max)
  }
  return ''
}

export function startTool(tools: readonly InsightTool[], row: InsightTool): InsightTool[] {
  return capped(tools, row)
}

// A record the cap already dropped is left out of the result, not re-added.
export function finishTool(tools: readonly InsightTool[], id: string, end: number, isFailed: boolean): InsightTool[] {
  return tools.map(t => (t.id === id ? { ...t, end, isFailed } : t))
}

// --- Subagents --------------------------------------------------------------

export type AgentInfo = { label?: string; type?: string }

// Finds the agent, or adds it as running from `now`. The first event of a
// subagent can be a turn.step, so this is the one way a record starts.
export function touchAgent(agents: readonly InsightAgent[], id: string, now: number, info: AgentInfo = {}): InsightAgent[] {
  const found = agents.find(a => a.id === id)
  if (found === undefined) {
    const fresh: InsightAgent = {
      id,
      label: info.label ?? '',
      type: info.type ?? '',
      start: now,
      end: null,
      steps: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      isFailed: false,
    }
    return capped(agents, fresh)
  }
  return agents.map(a =>
    a.id === id ? { ...a, label: a.label || (info.label ?? ''), type: a.type || (info.type ?? '') } : a,
  )
}

// A step after an end reopens the record. A teammate runs several turns.
export function addAgentUsage(agents: readonly InsightAgent[], id: string, usage: Usage | null): InsightAgent[] {
  return agents.map(a =>
    a.id === id
      ? {
          ...a,
          end: null,
          steps: a.steps + 1,
          input: a.input + (usage?.input_tokens ?? 0),
          output: a.output + (usage?.output_tokens ?? 0),
          cacheRead: a.cacheRead + (usage?.cache_read_input_tokens ?? 0),
          cacheWrite: a.cacheWrite + (usage?.cache_creation_input_tokens ?? 0),
        }
      : a,
  )
}

export function endAgent(agents: readonly InsightAgent[], id: string, end: number, isFailed: boolean): InsightAgent[] {
  return agents.map(a => (a.id === id ? { ...a, end, isFailed } : a))
}

export const agentTokens = (a: Pick<InsightAgent, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>): number =>
  a.input + a.output + a.cacheRead + a.cacheWrite

// --- The activity view --------------------------------------------------------

export type ActivityRow = {
  key: string
  kind: 'tool' | 'agent'
  title: string
  detail: string
  start: number
  elapsedMs: number
  isRunning: boolean
  isFailed: boolean
  tokens: number | null
}

// Merges tools and subagents into one list. Running items come first, then
// finished ones, each group newest first. `now` is a parameter so that a test
// fixes the elapsed time.
export function activityRows(tools: readonly InsightTool[], agents: readonly InsightAgent[], now: number): ActivityRow[] {
  const toolRows = tools.map((t): ActivityRow => ({
    key: `tool:${t.id}`,
    kind: 'tool',
    title: t.name,
    detail: t.summary,
    start: t.start,
    elapsedMs: Math.max(0, (t.end ?? now) - t.start),
    isRunning: t.end === null,
    isFailed: t.isFailed,
    tokens: null,
  }))
  const agentRows = agents.map((a): ActivityRow => ({
    key: `agent:${a.id}`,
    kind: 'agent',
    title: a.type || 'subagent',
    detail: a.label,
    start: a.start,
    elapsedMs: Math.max(0, (a.end ?? now) - a.start),
    isRunning: a.end === null,
    isFailed: a.isFailed,
    tokens: agentTokens(a),
  }))
  return [...toolRows, ...agentRows].sort((x, y) => Number(y.isRunning) - Number(x.isRunning) || y.start - x.start)
}

export const hasRunning = (tools: readonly InsightTool[], agents: readonly InsightAgent[]): boolean =>
  tools.some(t => t.end === null) || agents.some(a => a.end === null)

// --- The context view -----------------------------------------------------------

export type ContextBar = { name: string; tokens: number; kind: InsightCategory['kind'] }

// Used categories sort largest first. Free space, the compaction buffer and
// deferred schemas follow in that fixed order, since they are not content.
export function contextBars(context: Pick<InsightContext, 'categories'>): ContextBar[] {
  const byKind = (kind: InsightCategory['kind']): ContextBar[] => context.categories.filter(c => c.kind === kind)
  const used = byKind('used').sort((a, b) => b.tokens - a.tokens)
  return [...used, ...byKind('free'), ...byKind('buffer'), ...byKind('deferred')]
}

type Breakdown = {
  categories: readonly InsightCategory[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  model: string
}

// Keeps only the fields the pane draws, so that $.state holds a small value.
export function contextFrom(b: Breakdown, at: number): InsightContext {
  return {
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    totalTokens: b.totalTokens,
    windowTokens: b.rawMaxTokens,
    percent: b.percentage,
    model: b.model,
    at,
  }
}
