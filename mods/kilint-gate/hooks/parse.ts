// Pulls the commit message out of a Bash command, so the gate can lint it
// before git runs. Returns null when the command commits no message the gate
// can read: no `git commit`, an editor commit, `-F`, `--no-edit`, or a message
// built from a command substitution other than a heredoc.

const GIT_COMMIT = /\bgit\b(?:\s+(?:-C|-c)\s+(?:'[^']*'|"[^"]*"|\S+)|\s+--[a-z-]+(?:=\S+)?)*\s+commit\b/
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?:\n|$)/
const TRAILER = /^(?:co-authored-by|signed-off-by|reviewed-by|refs|closes|fixes|resolves):/i
const OPERATORS = ['&&', '||', ';', '|', '\n']

type Word = { text: string; hasSubstitution: boolean }

export function extractCommitMessage(command: string): string | null {
  const commit = GIT_COMMIT.exec(command)
  if (commit === null) return null
  const rest = command.slice(commit.index + commit[0].length)

  // Claude Code writes multi-line messages as -m "$(cat <<'EOF' ... EOF)".
  const heredoc = HEREDOC.exec(rest)
  if (heredoc !== null && /(?:-m|--message)[=\s]*["']?\$\(\s*cat\b/.test(rest.slice(0, heredoc.index))) {
    return clean(heredoc[3] ?? '')
  }

  const parts: string[] = []
  const words = lex(rest)
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]
    if (word === undefined) break
    const value = messageValue(word, words[i + 1])
    if (value === undefined) continue
    if (value.word === undefined || value.word.hasSubstitution) return null
    parts.push(value.word.text)
    if (value.consumedNext) i += 1
  }
  return parts.length === 0 ? null : clean(parts.join('\n\n'))
}

// Reads one -m style flag: `-m msg`, `-mmsg`, `-am msg`, `--message msg`,
// `--message=msg`. Returns undefined for any other word.
function messageValue(word: Word, next: Word | undefined): { word: Word | undefined; consumedNext: boolean } | undefined {
  const t = word.text
  if (t === '--message' || /^-[a-zA-Z]*m$/.test(t)) return { word: next, consumedNext: true }
  if (t.startsWith('--message=')) return { word: { ...word, text: t.slice('--message='.length) }, consumedNext: false }
  const glued = /^-[a-zA-Z]*m(.+)$/.exec(t)
  if (glued !== null && !t.startsWith('--')) return { word: { ...word, text: glued[1] ?? '' }, consumedNext: false }
  return undefined
}

// A small POSIX-style lexer: quotes, backslash escapes, and a stop at the
// first unquoted control operator, which ends the git commit invocation.
function lex(input: string): Word[] {
  const words: Word[] = []
  let text = ''
  let hasSubstitution = false
  let isInWord = false
  let i = 0
  const flush = () => {
    if (isInWord) words.push({ text, hasSubstitution })
    text = ''
    hasSubstitution = false
    isInWord = false
  }
  while (i < input.length) {
    const c = input[i] ?? ''
    if (OPERATORS.some(op => input.startsWith(op, i))) break
    if (c === ' ' || c === '\t') {
      flush()
      i += 1
    } else if (c === "'") {
      const end = input.indexOf("'", i + 1)
      if (end < 0) return []
      text += input.slice(i + 1, end)
      isInWord = true
      i = end + 1
    } else if (c === '"') {
      const read = readDouble(input, i + 1)
      if (read === null) return []
      text += read.text
      hasSubstitution = hasSubstitution || read.hasSubstitution
      isInWord = true
      i = read.end + 1
    } else if (c === '\\' && input[i + 1] === '\n') {
      // A backslash-newline continues the line. It adds nothing to the word.
      i += 2
    } else if (c === '\\') {
      text += input[i + 1] ?? ''
      isInWord = true
      i += 2
    } else {
      if (c === '$' || c === '`') hasSubstitution = true
      text += c
      isInWord = true
      i += 1
    }
  }
  flush()
  return words
}

// Reads a double-quoted string from `start` to its closing quote. Inside
// double quotes, a backslash escapes only $, `, ", \ and a newline.
function readDouble(input: string, start: number): { text: string; end: number; hasSubstitution: boolean } | null {
  let text = ''
  let hasSubstitution = false
  for (let i = start; i < input.length; i += 1) {
    const c = input[i] ?? ''
    if (c === '"') return { text, end: i, hasSubstitution }
    if (c === '\\' && '$`"\\\n'.includes(input[i + 1] ?? '')) {
      text += input[i + 1] === '\n' ? '' : input[i + 1]
      i += 1
    } else {
      if (c === '$' || c === '`') hasSubstitution = true
      text += c
    }
  }
  return null
}

// Drops git trailers and surrounding blank lines. Trailers are metadata, not prose.
function clean(message: string): string | null {
  const lines = message.split('\n').filter(line => !TRAILER.test(line.trim()))
  const body = lines.join('\n').trim()
  return body.length === 0 ? null : body
}
