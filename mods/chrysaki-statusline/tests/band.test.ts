import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { GEMS, facet, planLedger, ruleText } from '../hooks/ledger'
import { bandRules } from '../hooks/draw'
import { unpackCells } from '../hooks/raster'
import { usageColor } from '../hooks/format'

import { handoffPathFrom } from '../hooks/resume'

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
    // A percent takes the ramp colour it reached: 80% sits between amber and
    // red. 20% stays in the green zone and keeps the text colour.
    const five = await ui.find({ type: 'Text', text: /^ ?80%$/ })
    expect(five?.props.color).toBe(usageColor(80))
    const seven = await ui.find({ type: 'Text', text: /^ ?20%$/ })
    expect(seven?.props.color).toBe('#e0e2ea')
    expect(await ui.find({ type: 'Text', text: /handoff/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$2\.70/ })).toBeDefined()
    expect(await ui.find({ key: 'ctx-detail' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^main$/ })).toBeDefined()
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

test('every smooth bar in the band has one length, wide and medium', { options: { barStyle: 'smooth' } }, async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  for (const columns of [200, 120]) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(columns) })
    // On the terminal each smooth bar is one Raster row.
    const bars = (await ui.findAll({ type: 'Raster' })).filter(r => String(r.key).startsWith('bar-'))
    expect(bars.length).toBeGreaterThanOrEqual(3)
    expect(new Set(bars.map(b => b.props.columns)).size).toBe(1)
    expect(bars.every(b => b.props.rows === 1)).toBe(true)
    await ui.unmount()
  }
})

test('the default line style draws its bars as rule glyphs', async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  // A line-style bar is one uncoloured Text of rule glyphs. Coloured Texts
  // nested in it hold its filled and empty runs.
  const bars = (await ui.findAll({ type: 'Text', text: /^[━╸─]{3,}$/ })).filter(b => b.props.color === undefined)
  expect(bars.length).toBeGreaterThanOrEqual(3)
  expect(new Set(bars.map(b => b.text.length)).size).toBe(1)
  expect((await ui.findAll({ type: 'Raster' })).filter(r => String(r.key).startsWith('bar-')).length).toBe(0)
  await ui.unmount()
})

test('off the terminal a smooth bar draws as Text on the track', { options: { barStyle: 'smooth' } }, async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'AbovePrompt', props: props(200) })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  // 80% of 16 cells is 12 full cells and 6 eighths.
  expect(await ui.find({ type: 'Text', text: /^█{12}▊ {3}$/ })).toBeDefined()
  await ui.unmount()
})

test('the header mirrors the brand run on the right', async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  // The left run ends on the right-pointing E0B0. The mirror run starts on E0B2.
  expect(await ui.find({ type: 'Text', text: '' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / \$2\.70 / })).toBeDefined()
  await ui.unmount()
})

test('the handoff key runs /context-handoff and copies the written path', async ($, on) => {
  answerMeasure(on)
  const ran: string[] = []
  on('command.run', async (_$, e) => {
    ran.push(e.command)
    return {}
  })
  const copied: string[] = []
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('tool.call', { tool: 'Write' }, async () => ({ result: {}, text: 'ok' }))
  // The engine ends the turn. Here the test stands in for it, and for git.
  on('turn.complete', async () => ({ text: '' }))
  on('process.run', async () => ({ value: { ...RAN, exitCode: 1, stdout: '' } }))
  await $.session.measure(MEASURE)

  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  await ui.press({ key: 'handoff' })
  expect(ran).toEqual(['context-handoff'])

  const path = '/home/k/repo/.claude/handoffs/2026-10-05-08h50-band-layout.md'
  await $.tool.call({ tool: 'Write', file_path: path, content: '# Handoff' })
  await $.turn.complete({ turnId: 't1', reason: 'end_turn', answer: '', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never)
  expect(copied).toEqual([path])
  await ui.unmount()
})

test('a /context-handoff typed by hand also gets its path copied', async ($, on) => {
  answerMeasure(on)
  const copied: string[] = []
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('command.run', async () => ({}))
  on('tool.call', { tool: 'Write' }, async () => ({ result: {}, text: 'ok' }))
  on('turn.complete', async () => ({ text: '' }))
  on('process.run', async () => ({ value: { ...RAN, exitCode: 1, stdout: '' } }))
  await $.session.measure(MEASURE)

  await $.command.run({ command: 'context-handoff', args: '' } as never)
  const path = '/home/k/.claude/handoffs/2026-10-05-09h01-typed.md'
  // An overflow file in the same folder is not the handoff.
  await $.tool.call({ tool: 'Write', file_path: '/home/k/.claude/handoffs/overflow-typed.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: path, content: '# Handoff' })
  await $.turn.complete({ turnId: 't2', reason: 'end_turn', answer: '', usage: null } as never)
  expect(copied).toEqual([path])
})

// The resume key: a fresh session reads the clipboard with wl-paste. A handoff
// path there draws the key, and a press fills the prompt box.
async function resumeTest($: Engine, on: On, clipboard: string, draft: string): Promise<{ found: boolean; filled: string[] }> {
  const clock = answerMeasure(on)
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'wl-paste') return { value: { ...RAN, stdout: clipboard } }
    return { value: { ...RAN, exitCode: 1, stdout: '' } }
  })
  on('env.set', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: true }))
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('prompt.read', async () => ({ value: { text: draft, cursor: draft.length } }))
  const filled: string[] = []
  on('prompt.fill', async (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  const button = await ui.find({ key: 'resume' })
  if (button !== undefined) await ui.press({ key: 'resume' })
  await ui.unmount()
  return { found: button !== undefined, filled }
}

const HANDOFF = '/home/k/repo/.claude/handoffs/2026-10-05-08h55-band.md'

test('a handoff path on the clipboard draws the resume key, which fills the prompt', async ($, on) => {
  const r = await resumeTest($, on, `${HANDOFF}\n`, '')
  expect(r.found).toBe(true)
  expect(r.filled).toEqual([`/context-resume ${HANDOFF}`])
})

test('the resume key reads ~ paths and whole /context-resume lines', async () => {
  expect(handoffPathFrom('~/.claude/handoffs/2026-10-05-08h55-band.md', '/home/k')).toBe('/home/k/.claude/handoffs/2026-10-05-08h55-band.md')
  expect(handoffPathFrom(`/context-resume "${HANDOFF}" active`, '/home/k')).toBe(HANDOFF)
  expect(handoffPathFrom('/home/k/.claude/handoffs/overflow-band.md', '/home/k')).toBe(null)
  expect(handoffPathFrom(`${HANDOFF}\nsecond line`, '/home/k')).toBe(null)
})

test('other clipboard text draws no resume key', async ($, on) => {
  const r = await resumeTest($, on, 'some copied sentence', '')
  expect(r.found).toBe(false)
})

test('the resume key never writes over a draft', async ($, on) => {
  const r = await resumeTest($, on, HANDOFF, 'half a prompt')
  expect(r.found).toBe(true)
  expect(r.filled).toEqual([])
})

test('the ledger opens each row with a jewel badge and parts its columns', async ($, on) => {
  answerMeasure(on)
  on('process.run', async (_$, e) => {
    const cmd = e.argv.join(' ')
    if (cmd.startsWith('git status')) return { value: { ...RAN, stdout: STATUS } }
    return { value: { ...RAN, exitCode: 1, stdout: '' } }
  })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }))
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  for (const columns of [238, 160]) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(columns) })
    // Each badge is a hexagon gem: Emerald for 5h, Amethyst for the cache,
    // Rhodolite for the diff. Its cells run across the facet, so the light
    // catch sits inside the badge and the caps take the dim edge.
    expect(await ui.find({ type: 'Text', text: /^ +5h +$/ })).toBeDefined()
    // ' 5h  ' puts the 5 at cell 1 of 5.
    const grounds = async (text: string) => (await ui.findAll({ type: 'Text', text })).map(t => t.props.backgroundColor)
    expect(await grounds('5')).toContain(facet(GEMS.emerald, 1 / 4))
    expect(await grounds('⧗')).toContain(facet(GEMS.amethyst, 0))
    expect(await grounds('±')).toContain(facet(GEMS.rhodolite, 0))
    expect((await ui.findAll({ type: 'Text', text: '\ue0b2' })).length).toBeGreaterThanOrEqual(6)
    // A padded bar parts the columns. No dotted or box corner rule shows.
    expect(await ui.find({ type: 'Text', text: '  │  ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /[┊┐└┘]/ })).toBeUndefined()
    await ui.unmount()
  }
})


test('a dashed rule parts the 5h row from the 7d row', { options: { ruleAnimation: 'off' } }, async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  for (const [columns, rules] of [[238, 1], [130, 3]] as const) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(columns) })
    // A rule spans the band, so no bar or spacer matches. The header rule
    // opens with a space, so it does not match either.
    const found = await ui.findAll({ type: 'Text', text: /^─[─ ┼┴]{99,}$/ })
    expect(found.length).toBe(rules)
    expect(found[0]?.props.color).toBe('promptBorder')
    // The first rule crosses each column separator.
    expect(found[0]?.text).toContain('┼')
    await ui.unmount()
  }
})

test('the clock repaints the rule Raster without a redraw of the band', async ($, on) => {
  const clock = answerMeasure(on)
  on('env.set', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: false }))
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: [] }))
  on('store.get', async () => ({ value: undefined }))
  on('process.run', async () => ({ value: { ...RAN, exitCode: 1, stdout: '' } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  const blits: { key: string; cells: string }[] = []
  on('ui.blit', async (_$, e) => {
    if ('cells' in e) blits.push({ key: e.key, cells: e.cells })
    return { value: {} }
  })
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(238) })
  const rule = await ui.find({ type: 'Raster', key: 'rule-1' })
  expect(rule?.props.columns).toBe(bandRules(238)[0]?.width)
  const drawn = String(rule?.props.cells)
  const inks = unpackCells(drawn).filter(c => c.codePoint !== 0x20).map(c => c.fg)
  expect(new Set(inks).size).toBeGreaterThan(10)
  await clock.advance(150 * 5)
  const sent = blits.filter(b => b.key === 'rule-1')
  expect(sent.length).toBe(5)
  expect(new Set(sent.map(b => b.cells)).size).toBe(5)
  expect(sent[0]?.cells).not.toBe(drawn)
  // The band did not draw again: the mounted Raster keeps the cells it drew.
  expect(String((await ui.find({ type: 'Raster', key: 'rule-1' }))?.props.cells)).toBe(drawn)
  await ui.unmount()
})

test('off the terminal the animated rule draws a still gradient of Text', async ($, on) => {
  answerMeasure(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'AbovePrompt', props: props(238) })
  const colours = (await ui.findAll({ type: 'Text', text: /^──\s?$/ })).map(t => String(t.props.color))
  expect(colours.length).toBeGreaterThan(10)
  expect(new Set(colours).size).toBeGreaterThan(3)
  await ui.unmount()
})

test('the plan gives git the rest of a wide band and stacks it on a narrow one', async () => {
  const wide = planLedger(237)
  expect(wide.isInline).toBe(true)
  expect(wide.bar).toBe(16)
  const tight = planLedger(130)
  expect(tight.isInline).toBe(false)
  expect(tight.gitWidth).toBe(129)
})

test('a crossing on the rule always has a dash on each side', async () => {
  expect(ruleText(9, [{ at: 2, glyph: '┼' }])).toBe('──┼── ── ')
  expect(ruleText(9, [{ at: 5, glyph: '┼' }])).toBe('── ──┼── ')
  expect(ruleText(6, [{ at: 5, glyph: '┴' }])).toBe('── ──┴')
})
