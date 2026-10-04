import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const ROOT = '/home/k/repo'

const STATUS = [
  '# branch.oid 1234567890abcdef',
  '# branch.head feature/5-git-pane',
  '# branch.upstream origin/feature/5-git-pane',
  '# branch.ab +1 -0',
  '1 .M N... 100644 100644 100644 aaa aaa hooks/view.tsx',
  '? notes.md',
  '',
].join('\0')

const LOG = '* \x1fb456925\x1ffeat(mods): add the kilint gate mod\x1fK\x1f1 hour ago\x1fHEAD -> feature/5-git-pane\n'
const BRANCHES = '*\x1ffeature/5-git-pane\x1forigin/feature/5-git-pane\x1fahead 1\x1f1 hour ago\n \x1fmain\x1forigin/main\x1f\x1f2 days ago\n'

const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// Answers each git command the pane runs with fixture output.
function fakeGit(argv: readonly string[]): string {
  const line = argv.join(' ')
  if (line.includes('rev-parse --show-toplevel')) return ROOT + '\n'
  if (line.includes(' status ')) return STATUS
  if (line.includes('for-each-ref')) return BRANCHES
  if (line.includes('log --graph')) return LOG
  if (line.includes('log -1')) return 'b456925 feat(mods): add the kilint gate mod (1 hour ago)\n'
  if (line.includes(' diff ')) return '@@ -1 +1 @@\n-old\n+new\n'
  return ''
}

const PANE = {
  plugin: 'git-pane',
  component: 'Pane',
  requestId: 'git-pane',
  props: { title: 'git', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the pane loads, switches tabs and stages a file on every surface', async ($, on) => {
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    ran.push(e.argv.join(' '))
    return { value: { ...OK, stdout: fakeGit(e.argv) } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'opt-r' })
    await ui.press({ key: 'tab-files' })
    expect(await ui.find({ key: 'row:files:hooks/view.tsx' })).toBeDefined()
    expect(await ui.find({ text: /feature\/5-git-pane/ })).toBeDefined()

    await ui.press({ key: 'row:files:hooks/view.tsx' })
    expect(ran).toContain(`git -C ${ROOT} add -- hooks/view.tsx`)

    await ui.press({ key: 'tab-log' })
    expect(await ui.find({ key: 'row:log:b456925' })).toBeDefined()

    await ui.press({ key: 'tab-branches' })
    expect(await ui.find({ key: 'row:branches:main' })).toBeDefined()
    await ui.unmount()
  }
})

test('a commit from the pane goes through the Bash tool', async ($, on) => {
  on('process.run', async (_$, e) => ({ value: { ...OK, stdout: fakeGit(e.argv) } }))
  const commands: string[] = []
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    commands.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'opt-r' })
  await ui.press({ key: 'tab-files' })
  await ui.press({ key: 'opt-c' })
  await ui.input({ key: 'commit-msg', text: "feat: it's done" })

  expect(commands).toEqual([`git -C '${ROOT}' commit -m 'feat: it'\\''s done'`])
  expect(await ui.find({ text: /Committed/ })).toBeDefined()
  await ui.unmount()
})

test('a refused commit shows the reason in the pane', async ($, on) => {
  on('process.run', async (_$, e) => ({ value: { ...OK, stdout: fakeGit(e.argv) } }))
  on('tool.call', { tool: 'Bash' }, async () => ({ deny: 'kilint-gate: WRD001 contraction' }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'opt-r' })
  await ui.press({ key: 'tab-files' })
  await ui.press({ key: 'opt-c' })
  await ui.input({ key: 'commit-msg', text: "feat: it's done" })

  expect(await ui.find({ text: /WRD001/ })).toBeDefined()
  await ui.unmount()
})

test('discard asks for a second press', async ($, on) => {
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    ran.push(e.argv.join(' '))
    return { value: { ...OK, stdout: fakeGit(e.argv) } }
  })
  // The engine moves the focus ring. Here the test stands in for it.
  on('ui.focus', async () => ({}))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'opt-r' })
  await ui.press({ key: 'tab-files' })
  await $.ui.focus({ component: 'Pane', requestId: 'git-pane', element: 'row:files:notes.md', origin: { kind: 'person' } })
  await ui.press({ key: 'opt-d' })
  expect(ran.some(r => r.includes('clean'))).toBe(false)
  expect(await ui.find({ text: /Press d again/ })).toBeDefined()
  await ui.press({ key: 'opt-d' })
  expect(ran).toContain(`git -C ${ROOT} clean -f -- notes.md`)
  await ui.unmount()
})

const BAND = {
  plugin: 'git-pane',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// Loads the git state through the pane, then mounts the band with an empty
// band beneath it, as the engine draws when no other mod draws there.
async function mountBand($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  on('process.run', async (_$, e) => ({ value: { ...OK, stdout: fakeGit(e.argv) } }))
  on('ui.render', { component: 'AbovePrompt' }, async (b$, e) => h(b$.ui.resolve(e).Box, {}) as RenderElement)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'opt-r' })
  await pane.unmount()
  return $.ui.mount({ ...BAND, surface: 'terminal' })
}

test('the band draws a git line on its own', async ($, on) => {
  mock.env(on, {})
  const band = await mountBand($, on)
  expect(await band.find({ key: 'git-open' })).toBeDefined()
  await band.unmount()
})

test('the band stands down while the statusline mod is loaded', async ($, on) => {
  mock.env(on, { CHRYSAKI_STATUSLINE_MOD: '1' })
  const band = await mountBand($, on)
  expect(await band.find({ key: 'git-open' })).toBeUndefined()
  await band.unmount()
})
