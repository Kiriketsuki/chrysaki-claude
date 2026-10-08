import { expect, test } from 'claude-code/testing'

const BAD = {
  rule_id: 'WRD001', name: 'contraction', category: 'words', line: 1, col: 7,
  severity: 'error', message: 'contraction: "we\'re"', suggestion: 'write it out in full',
}
const WARN = { ...BAD, rule_id: 'VRB002', severity: 'warn', message: '-ing main verb', suggestion: '' }

function report(violations: readonly object[]): string {
  return JSON.stringify({ files: [{ path: '<stdin>', violations }], summary: {} })
}

const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

test('denies a commit whose message has an error', async ($, on) => {
  const seen: string[] = []
  on('process.run', async (_$, e) => {
    seen.push(e.init?.stdin ?? '')
    return { value: { ...RAN, stdout: report([BAD]) } }
  })
  let didRun = false
  on('tool.call', { tool: 'Bash' }, async () => {
    didRun = true
    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }
  })

  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: we\'re done"' })

  expect(didRun).toBe(false)
  expect(seen).toEqual(["feat: we're done\n"])
  expect(String(r.deny ?? r.text)).toContain('WRD001 at line 1, column 7')
})

test('lets a clean commit through', async ($, on) => {
  on('process.run', async () => ({ value: { ...RAN, stdout: report([]) } }))
  let didRun = false
  on('tool.call', { tool: 'Bash' }, async () => {
    didRun = true
    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }
  })

  const r = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: add the gate"' })

  expect(didRun).toBe(true)
  expect(r.deny).toBeUndefined()
})

test('passes warnings when failOn is error', async ($, on) => {
  on('process.run', async () => ({ value: { ...RAN, stdout: report([WARN]) } }))
  let didRun = false
  on('tool.call', { tool: 'Bash' }, async () => {
    didRun = true
    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: adding it"' })
  expect(didRun).toBe(true)
})

test('blocks warnings when failOn is warn', { options: { failOn: 'warn' } }, async ($, on) => {
  on('process.run', async () => ({ value: { ...RAN, stdout: report([WARN]) } }))
  let didRun = false
  on('tool.call', { tool: 'Bash' }, async () => {
    didRun = true
    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: adding it"' })
  expect(didRun).toBe(false)
})

test('fails open when kilint does not run', async ($, on) => {
  on('process.run', async () => ({ value: { ...RAN, exitCode: 2, stdout: "Traceback ..." } }))
  let didRun = false
  on('tool.call', { tool: 'Bash' }, async () => {
    didRun = true
    return { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })
  expect(didRun).toBe(true)
})

test('never lints other Bash commands', async ($, on) => {
  let lints = 0
  on('process.run', async () => {
    lints += 1
    return { value: { ...RAN, stdout: report([BAD]) } }
  })
  on('tool.call', { tool: 'Bash' }, async () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'git status && npm test' })
  expect(lints).toBe(0)
})
