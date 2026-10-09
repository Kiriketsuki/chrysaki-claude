import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { EMBLEMS } from '../hooks/emblem'

function props(bodyColumns: number) {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} }
}

function setup(on: On) {
  mock.clock(on, { now: Date.parse('2098-12-31T19:35:00Z') })
  mock.env(on, { HOME: '/home/k' })
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
}

const MEASURE = { context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: [], changed: ['context'] as ('context')[] }

test('a wide terminal band draws the mark and the caption beside the header', { options: { caption: 'Tetsuhiro Dev' } }, async ($, on) => {
  setup(on)
  on('session.cwd', async () => ({ value: '/home/k/dev/chrysaki-claude' }))
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  expect(await ui.find({ key: 'emblem' })).toBeDefined()
  const mark = EMBLEMS['cube-emerald-plain']
  expect(await ui.find({ type: 'Text', text: mark?.[0]?.[0]?.[0] ?? '?' })).toBeDefined()
  const caption = await ui.find({ key: 'caption' })
  expect(caption).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: 'T' })).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('no mark under 150 columns or off the terminal, and the ⬢ glyph stays', async ($, on) => {
  setup(on)
  await $.session.measure(MEASURE)
  for (const [surface, columns] of [['terminal', 140], ['desktop', 200]] as const) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface, component: 'AbovePrompt', props: props(columns) })
    expect(await ui.find({ key: 'emblem' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: / ?⬢/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the emblem option none keeps the ⬢ glyph on a wide band', { options: { emblem: 'none' } }, async ($, on) => {
  setup(on)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  expect(await ui.find({ key: 'emblem' })).toBeUndefined()
  await ui.unmount()
})
