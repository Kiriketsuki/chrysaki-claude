// Reads kilint's JSON report and turns the blocking violations into the
// text the model receives as the denied tool result.

export type Severity = 'error' | 'warn' | 'info'

export type Violation = {
  ruleId: string
  severity: Severity
  line: number
  col: number
  message: string
  suggestion: string
}

const RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 }

// Throws when the output is not a kilint JSON report, so the caller can tell
// a linter failure apart from a clean message.
export function parseReport(stdout: string): Violation[] {
  const report: unknown = JSON.parse(stdout)
  const files = (report as { files?: unknown }).files
  if (!Array.isArray(files)) throw new Error('the report has no files list')
  return files.flatMap(file => {
    const raw = (file as { violations?: unknown }).violations
    if (!Array.isArray(raw)) return []
    return raw.map(toViolation)
  })
}

function toViolation(raw: unknown): Violation {
  const v = raw as Record<string, unknown>
  const severity = v.severity === 'warn' || v.severity === 'info' ? v.severity : 'error'
  return {
    ruleId: String(v.rule_id ?? '?'),
    severity,
    line: Number(v.line ?? 0),
    col: Number(v.col ?? 0),
    message: String(v.message ?? ''),
    suggestion: String(v.suggestion ?? ''),
  }
}

export function blocking(violations: readonly Violation[], failOn: Severity): Violation[] {
  return violations.filter(v => RANK[v.severity] >= RANK[failOn])
}

export function denyText(violations: readonly Violation[], profile: string): string {
  const lines = violations.map(v => {
    const fix = v.suggestion.length > 0 ? ` Fix: ${v.suggestion}.` : ''
    return `- ${v.ruleId} at line ${v.line}, column ${v.col}: ${v.message}.${fix}`
  })
  return [
    `kilint-gate: the commit message fails the STE check (profile ${profile}).`,
    'Rewrite the message to fix each item below. Then run the commit again.',
    ...lines,
  ].join('\n')
}
