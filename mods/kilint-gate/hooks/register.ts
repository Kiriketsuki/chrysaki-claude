import type { EngineInterface, Register } from 'claude-code'

import { extractCommitMessage } from './parse'
import { blocking, denyText, parseReport } from './report'
import type { Severity } from './report'
import { resolveTools } from './tools'
import type { Tools } from './tools'

const LINT_TIMEOUT_MS = 15000
const STDERR_SHOWN = 80

// An older engine has no `$.session.info`. The gate then keeps the configured
// values, which is the behaviour before the platform check existed.
async function toolsFor($: EngineInterface, configured: Tools): Promise<Tools> {
  try {
    const [info, vaultRoot] = await Promise.all([$.session.info(), $.env.get('CHRYSAKI_VAULT_ROOT')])
    return resolveTools(configured, { platform: info.platform, vaultRoot })
  } catch {
    return configured
  }
}

export const register: Register = (on, options) => {
  const configured: Tools = { python: String(options.python), kilintPath: String(options.kilintPath) }
  const profile = String(options.profile)
  const failOn = String(options.failOn) as Severity

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const message = extractCommitMessage(e.command)
    if (message === null) return next(e)

    let violations
    try {
      const tools = await toolsFor($, configured)
      const lint = await $.process.run(
        [tools.python, tools.kilintPath, '--format', 'json', '--no-fail', '--profile', profile, '--as', 'markdown'],
        { stdin: message + '\n', timeoutMs: LINT_TIMEOUT_MS },
      )
      // A missing script exits non-zero with an empty report. The stderr text
      // names the cause, and the JSON parse error does not.
      if (lint.stdout.trim() === '') throw new Error(lint.stderr.trim().slice(0, STDERR_SHOWN) || `exit ${lint.exitCode} with no report`)
      violations = parseReport(lint.stdout)
    } catch (error) {
      // The gate fails open. A broken linter must not stop all commits, so
      // the person sees why the check did not run.
      const reason = error instanceof Error ? error.message : String(error)
      $.ui.toast(`kilint-gate: kilint did not run (${reason.slice(0, STDERR_SHOWN)}). The commit went ahead unchecked.`)
      return next(e)
    }

    const blockers = blocking(violations, failOn)
    if (blockers.length === 0) return next(e)

    const noun = blockers.length === 1 ? 'violation' : 'violations'
    $.ui.toast(`kilint-gate blocked a commit: ${blockers.length} ${noun}.`)
    return { deny: denyText(blockers, profile) }
  })
}
