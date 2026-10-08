import { describe, expect, test } from 'claude-code/testing'

import type { InsightAgent, InsightTool } from '../types'
import {
  KEEP,
  activityRows,
  addAgentUsage,
  cacheHit,
  capped,
  contextBars,
  contextFrom,
  endAgent,
  finishTool,
  hasRunning,
  startTool,
  summarizeInput,
  touchAgent,
  turnRow,
} from '../hooks/records'

const USAGE = { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 700, cache_creation_input_tokens: 200 }

const tool = (id: string, start: number, end: number | null = null): InsightTool => ({
  id,
  name: 'Bash',
  summary: 'ls',
  agentId: null,
  start,
  end,
  isFailed: false,
})

describe('capped', () => {
  test('keeps the newest records and leaves the input alone', () => {
    const before = Array.from({ length: KEEP }, (_, i) => i)
    const after = capped(before, 999)
    expect(after.length).toBe(KEEP)
    expect(after[0]).toBe(1)
    expect(after[KEEP - 1]).toBe(999)
    expect(before.length).toBe(KEEP)
    expect(before[0]).toBe(0)
  })
})

describe('turns', () => {
  test('turnRow maps the four counts', () => {
    expect(turnRow('t:0', 5, 'm', USAGE)).toEqual({ id: 't:0', at: 5, model: 'm', input: 100, output: 40, cacheRead: 700, cacheWrite: 200 })
  })

  test('cacheHit is the cache share of the whole prompt', () => {
    expect(cacheHit({ input: 100, cacheRead: 700, cacheWrite: 200 })).toBe(70)
    expect(cacheHit({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  })
})

describe('summarizeInput', () => {
  test('prefers the command, then the path, then the pattern', () => {
    expect(summarizeInput({ tool: 'Bash', command: 'git status', description: 'x' })).toBe('git status')
    expect(summarizeInput({ tool: 'Read', file_path: '/a/b.ts' })).toBe('/a/b.ts')
    expect(summarizeInput({ tool: 'Grep', pattern: 'foo', path: '/src' })).toBe('/src')
  })

  test('falls back to the first string field and skips reserved keys', () => {
    expect(summarizeInput({ tool: 'mcp__x__y', tool_use_id: 'u1', agentId: 'a', thing: 'hello' })).toBe('hello')
    expect(summarizeInput({ tool: 'mcp__x__y', tool_use_id: 'u1', count: 3 })).toBe('')
  })

  test('flattens and cuts a long summary', () => {
    const out = summarizeInput({ command: `echo ${'x'.repeat(100)}\nsecond` }, 20)
    expect(out.length).toBe(20)
    expect(out.endsWith('…')).toBe(true)
    expect(out.includes('\n')).toBe(false)
  })
})

describe('tool records', () => {
  test('finishTool closes one record and returns a new list', () => {
    const start = startTool([], tool('a', 10))
    const done = finishTool(start, 'a', 50, true)
    expect(done[0]).toEqual({ ...tool('a', 10), end: 50, isFailed: true })
    expect(start[0]?.end).toBeNull()
  })

  test('finishTool ignores a record the cap dropped', () => {
    expect(finishTool([tool('b', 1)], 'gone', 9, false)).toEqual([tool('b', 1)])
  })
})

describe('agent records', () => {
  test('touchAgent adds a running record once and fills a blank label later', () => {
    const first = touchAgent([], 'ag1', 100)
    expect(first).toHaveLength(1)
    expect(first[0]?.end).toBeNull()
    const second = touchAgent(first, 'ag1', 200, { label: 'Audit', type: 'Explore' })
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ start: 100, label: 'Audit', type: 'Explore' })
    const third = touchAgent(second, 'ag1', 300, { label: 'Other', type: 'general-purpose' })
    expect(third[0]).toMatchObject({ label: 'Audit', type: 'Explore' })
  })

  test('addAgentUsage sums tokens and reopens an ended record', () => {
    let list: InsightAgent[] = touchAgent([], 'ag1', 0)
    list = addAgentUsage(list, 'ag1', USAGE)
    list = endAgent(list, 'ag1', 50, false)
    expect(list[0]?.end).toBe(50)
    list = addAgentUsage(list, 'ag1', USAGE)
    expect(list[0]).toMatchObject({ end: null, steps: 2, input: 200, output: 80, cacheRead: 1400, cacheWrite: 400 })
  })

  test('addAgentUsage counts a step with no usage', () => {
    const list = addAgentUsage(touchAgent([], 'ag1', 0), 'ag1', null)
    expect(list[0]).toMatchObject({ steps: 1, input: 0 })
  })
})

describe('activityRows', () => {
  test('puts running items first, then newest first', () => {
    const tools = [tool('old', 100, 150), tool('run', 120), tool('new', 300, 310)]
    const agents = addAgentUsage(touchAgent([], 'ag', 200, { label: 'Scan', type: 'Explore' }), 'ag', USAGE)
    const rows = activityRows(tools, agents, 1000)
    expect(rows.map(r => r.key)).toEqual(['agent:ag', 'tool:run', 'tool:new', 'tool:old'])
  })

  test('elapsed time runs to now while an item runs and stops at its end', () => {
    const rows = activityRows([tool('run', 400), tool('done', 100, 160)], [], 1000)
    expect(rows.find(r => r.key === 'tool:run')?.elapsedMs).toBe(600)
    expect(rows.find(r => r.key === 'tool:done')?.elapsedMs).toBe(60)
  })

  test('an agent row carries its token total and a type title', () => {
    const agents = addAgentUsage(touchAgent([], 'ag', 0), 'ag', USAGE)
    const [row] = activityRows([], agents, 10)
    expect(row).toMatchObject({ kind: 'agent', title: 'subagent', tokens: 1040, isRunning: true })
  })

  test('hasRunning sees an open tool or agent', () => {
    expect(hasRunning([tool('a', 1, 2)], [])).toBe(false)
    expect(hasRunning([tool('a', 1)], [])).toBe(true)
    expect(hasRunning([], touchAgent([], 'ag', 0))).toBe(true)
  })
})

describe('context', () => {
  const categories = [
    { name: 'Free space', tokens: 800, color: 'x', isDeferred: false, kind: 'free' as const },
    { name: 'Messages', tokens: 50, color: 'x', isDeferred: false, kind: 'used' as const },
    { name: 'System prompt', tokens: 300, color: 'x', isDeferred: false, kind: 'used' as const },
    { name: 'MCP tools', tokens: 900, color: 'x', isDeferred: true, kind: 'deferred' as const },
    { name: 'Autocompact buffer', tokens: 100, color: 'x', isDeferred: false, kind: 'buffer' as const },
  ]

  test('contextBars sorts used rows largest first and puts the rest after', () => {
    const names = contextBars({ categories }).map(b => b.name)
    expect(names).toEqual(['System prompt', 'Messages', 'Free space', 'Autocompact buffer', 'MCP tools'])
  })

  test('contextFrom keeps only the drawn fields', () => {
    const c = contextFrom({ categories, totalTokens: 350, rawMaxTokens: 1000, percentage: 35, model: 'opus' }, 7)
    expect(c).toMatchObject({ totalTokens: 350, windowTokens: 1000, percent: 35, model: 'opus', at: 7 })
    expect(Object.keys(c.categories[0] ?? {})).toEqual(['name', 'tokens', 'kind'])
  })
})
