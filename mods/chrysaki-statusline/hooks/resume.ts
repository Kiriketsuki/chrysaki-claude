// The resume key. A fresh session shows it when the clipboard holds the
// path of a handoff file, as the handoff key copies it.

// The file name the context-handoff skill writes: YYYY-MM-DD-HHhMM-{slug}.md
// under a handoffs directory. Overflow files do not match.
export const HANDOFF_FILE = /\/handoffs\/\d{4}-\d{2}-\d{2}-\d{2}h\d{2}-[^/]+\.md$/

// Clipboard text longer than this is not a path.
const MAX_CLIPBOARD = 1024

// The handoff path the clipboard text names, or null. The text can be the
// bare path, a quoted path, a `~/` path, or a whole `/context-resume <path>`
// line. Anything else, a second line included, is not a handoff path.
export function handoffPathFrom(text: string, home: string): string | null {
  if (text.length > MAX_CLIPBOARD) return null
  let t = text.trim()
  if (t.includes('\n')) return null
  t = t.replace(/^\/context-resume\s+/, '').replace(/\s+active$/, '')
  t = t.replace(/^(['"])(.*)\1$/, '$2')
  if (t.startsWith('~/') && home !== '') t = `${home}${t.slice(1)}`
  if (!t.startsWith('/') || !HANDOFF_FILE.test(t)) return null
  return t
}

export function resumeCommand(path: string): string {
  return `/context-resume ${path}`
}
