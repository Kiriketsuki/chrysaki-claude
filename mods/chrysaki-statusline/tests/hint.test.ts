import { expect, mock, test } from 'claude-code/testing'

// The engine draws the mode label outside PromptHint. The hint starts after it.
const HINT = '(shift+tab to cycle) bypass permissions on · ← for agents'

test('the drawer opens to the engine line and closes again', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('store.get', async () => ({ value: undefined }))
  const stored: unknown[] = []
  on('store.set', async (_$, e) => {
    stored.push(e.value)
    return { value: undefined }
  })
  // The engine's own line beneath the plugin.
  on('ui.render', { component: 'PromptHint' }, async (h$, e) => h$.ui.resolve(e).Text({ key: 'engine-hint', children: e.props.hint }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface, component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: HINT } })
    const closed = await ui.find({ key: 'hint-drawer' })
    expect(closed?.props.label).toBe('▸')
    expect(await ui.find({ type: 'Text', text: /bypass permissions on/ })).toBeUndefined()
    await ui.press({ key: 'hint-drawer' })
    expect((await ui.find({ key: 'hint-drawer' }))?.props.label).toBe('▾')
    expect(await ui.find({ type: 'Text', text: /bypass permissions on/ })).toBeDefined()
    await ui.press({ key: 'hint-drawer' })
    expect(await ui.find({ type: 'Text', text: /bypass permissions on/ })).toBeUndefined()
    await ui.unmount()
  }
  expect(stored).toEqual([true, false, true, false])
})
