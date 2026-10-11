import { expect, mock, test } from 'claude-code/testing'

// The engine draws the mode label outside PromptHint. The hint starts after it.
const HINT = '(shift+tab to cycle) · ← for agents'

function bandProps() {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 200, scroll: { offset: 0, bodyRows: 12 }, view: {} }
}

test('the terminal chevron opens and closes the hint drawer, and the desktop has none', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home/k' })
  on('store.get', async () => ({ value: undefined }))
  const stored: unknown[] = []
  on('store.set', async (_$, e) => {
    stored.push(e.value)
    return { value: undefined }
  })
  // The engine's own line and band beneath the plugin.
  on('ui.render', { component: 'PromptHint' }, async (h$, e) => h$.ui.resolve(e).Text({ children: e.props.hint }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  // The terminal toggles the drawer with the header chevron.
  const band = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: bandProps() })
  const hint = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: HINT } })
  expect((await band.find({ key: 'hint-toggle' }))?.props.label).toBe('▸')
  expect(await hint.find({ type: 'Text', text: /for agents/ })).toBeUndefined()
  await band.press({ key: 'hint-toggle' })
  expect((await band.find({ key: 'hint-toggle' }))?.props.label).toBe('▾')
  expect(await hint.find({ type: 'Text', text: /for agents/ })).toBeDefined()
  await band.press({ key: 'hint-toggle' })
  expect(await hint.find({ type: 'Text', text: /for agents/ })).toBeUndefined()
  await hint.unmount()
  await band.unmount()
  // The desktop header has no chevron, so the hint always shows there.
  const deskBand = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'AbovePrompt', props: bandProps() })
  const deskHint = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: HINT } })
  expect(await deskBand.find({ key: 'hint-toggle' })).toBeUndefined()
  expect(await deskHint.find({ type: 'Text', text: /for agents/ })).toBeDefined()
  await deskHint.unmount()
  await deskBand.unmount()
  expect(stored).toEqual([true, false])
})
