import { expect, test } from 'claude-code/testing'

import { TERMINAL, drawTree, scenarios } from './fixtures/draw'
import { TERMINAL_BAND } from './fixtures/terminal-band'

// The desktop work must not change one byte of the terminal band. Each
// scenario draws the band on the terminal table and compares the tree with
// the one recorded before the primitives moved behind one seam.
const ALL = scenarios()

test('the fixtures cover every scenario', () => {
  expect(Object.keys(TERMINAL_BAND).sort()).toEqual(Object.keys(ALL).sort())
})

for (const [key, d] of Object.entries(ALL)) {
  test(`the terminal band is unchanged: ${key}`, () => {
    expect(JSON.stringify(drawTree(TERMINAL, d))).toBe(TERMINAL_BAND[key])
  })
}
