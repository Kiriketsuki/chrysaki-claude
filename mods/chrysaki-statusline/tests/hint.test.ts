import { expect, mock, test } from 'claude-code/testing'

// The engine draws the mode label outside PromptHint. The hint starts after it.
const HINT = '(shift+tab to cycle) · ← for agents'

function bandProps() {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 200, scroll: { offset: 0, bodyRows: 12 }, view: {} }
}

test('the header chevron opens and closes the hint drawer', async ($, on) => {
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
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'chrysaki-statusline', surface, component: 'AbovePrompt', props: bandProps() })
    const hint = await $.ui.mount({ plugin: 'chrysaki-statusline', surface, component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: HINT } })
    expect((await band.find({ key: 'hint-toggle' }))?.props.label).toBe('▸')
    expect(await hint.find({ type: 'Text', text: /for agents/ })).toBeUndefined()
    await band.press({ key: 'hint-toggle' })
    expect((await band.find({ key: 'hint-toggle' }))?.props.label).toBe('▾')
    expect(await hint.find({ type: 'Text', text: /for agents/ })).toBeDefined()
    await band.press({ key: 'hint-toggle' })
    expect(await hint.find({ type: 'Text', text: /for agents/ })).toBeUndefined()
    await hint.unmount()
    await band.unmount()
  }
  expect(stored).toEqual([true, false, true, false])
})
