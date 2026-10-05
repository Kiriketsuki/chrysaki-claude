import type { Register } from 'claude-code'

import { extractCommitMessage } from './parse'
import { blocking, denyText, parseReport } from './report'
import type { Severity } from './report'

const LINT_TIMEOUT_MS = 15000

export const register: Register = (on, options) => {
  const kilintPath = String(options.kilintPath)
  const python = String(options.python)
  const profile = String(options.profile)
  const failOn = String(options.failOn) as Severity

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const message = extractCommitMessage(e.command)
    if (message === null) return next(e)

    let violations
    try {
      const lint = await $.process.run(
        [python, kilintPath, '--format', 'json', '--no-fail', '--profile', profile, '--as', 'markdown'],
        { stdin: message + '\n', timeoutMs: LINT_TIMEOUT_MS },
      )
      violations = parseReport(lint.stdout)
    } catch (error) {
      // The gate fails open. A broken linter must not stop all commits, so
      // the person sees why the check did not run.
      const reason = error instanceof Error ? error.message : String(error)
      $.ui.toast(`kilint-gate: kilint did not run (${reason.slice(0, 80)}). The commit went ahead unchecked.`)
      return next(e)
    }

    const blockers = blocking(violations, failOn)
    if (blockers.length === 0) return next(e)

    const noun = blockers.length === 1 ? 'violation' : 'violations'
    $.ui.toast(`kilint-gate blocked a commit: ${blockers.length} ${noun}.`)
    return { deny: denyText(blockers, profile) }
  })
}
