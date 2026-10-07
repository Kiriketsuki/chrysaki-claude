// The handoff key and the resume key. The handoff key runs /context-handoff
// and copies the path of the file it writes. The resume key reads a handoff
// path from the clipboard and puts /context-resume in the prompt box. The
// engine interface cannot cross an import, so register.tsx hands these
// functions a HandoffHost.

import type { PendingHandoff } from '../types'
import { HANDOFF_FILE, handoffPathFrom, resumeCommand } from './resume'

type Surface = PendingHandoff['surface']

export type HandoffHost = {
  now: () => Promise<number>
  surface: () => Promise<Surface>
  getHandoff: () => Promise<PendingHandoff | null>
  setHandoff: (fn: (h: PendingHandoff | null) => PendingHandoff | null) => Promise<void>
  getResume: () => Promise<string | null>
  setResume: (path: string | null) => Promise<void>
  // True once the session has a context reading.
  hasContext: () => Promise<boolean>
  runCommand: (command: string) => Promise<void>
  submit: (text: string) => Promise<void>
  run: (argv: string[], timeoutMs?: number) => Promise<{ exitCode: number; stdout: string }>
  home: () => Promise<string | undefined>
  configDir: () => Promise<string | undefined>
  list: (dir: string) => Promise<{ name: string; kind: string }[]>
  mtime: (path: string) => Promise<number>
  exists: (path: string) => Promise<boolean>
  copy: (text: string, surface: Surface) => Promise<boolean>
  promptText: () => Promise<string>
  fill: (text: string) => Promise<boolean>
  toast: (text: string, timeoutMs?: number) => void
  fail: (error: unknown) => void
}

// A pending handoff gives up after this many main-thread turns end with no
// handoff file found.
const HANDOFF_MAX_MISSES = 2

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Starts the watch for the handoff file. A watch already running keeps its start.
export async function watchHandoff(h: HandoffHost, surface: Surface): Promise<void> {
  const now = await h.now()
  const where = surface ?? (await h.surface().catch(() => null))
  await h.setHandoff(p => p ?? { since: now, surface: where, path: null, misses: 0 })
}

// The handoff button: runs /context-handoff. The tracking itself starts in
// watchHandoff, when the command runs, so a handoff typed by hand gets its
// path copied too. The pending state lives in $.state, so a hot reload
// between the press and the turn keeps it.
export async function pressHandoff(h: HandoffHost, surface: Surface): Promise<void> {
  if ((await h.getHandoff()) !== null) return
  await watchHandoff(h, surface)
  h.toast('Writing the handoff. Its path goes to the clipboard when the turn ends.')
  try {
    await h.runCommand('context-handoff')
  } catch {
    try {
      await h.submit('/context-handoff')
    } catch (error) {
      await h.setHandoff(() => null)
      h.toast(`The handoff did not start: ${message(error)}`)
    }
  }
}

// The newest handoff file written since the press, in the project's and the
// global handoffs directory. A fallback for a file no Write call named.
async function newestHandoff(h: HandoffHost, since: number): Promise<string | null> {
  const [top, home, configDir] = await Promise.all([
    h.run(['git', 'rev-parse', '--show-toplevel']).then(r => (r.exitCode === 0 ? r.stdout.trim() : '')).catch(() => ''),
    h.home(),
    h.configDir(),
  ])
  const dirs = [top ? `${top}/.claude/handoffs` : '', `${configDir ?? `${home ?? ''}/.claude`}/handoffs`].filter(d => d !== '')
  let best: { path: string; mtime: number } | null = null
  for (const dir of dirs) {
    const entries = await h.list(dir).catch(() => [])
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.kind !== 'file' || !HANDOFF_FILE.test(path)) continue
      const mtime = await h.mtime(path).catch(() => null)
      if (mtime !== null && mtime >= since - 5000 && (best === null || mtime > best.mtime)) best = { path, mtime }
    }
  }
  return best?.path ?? null
}

// Runs as each main-thread turn ends. It copies the path once a handoff file
// exists: the one a Write named, or the newest one written since the start.
export async function finishHandoff(h: HandoffHost): Promise<void> {
  const p = await h.getHandoff()
  if (p === null) return
  const path = p.path ?? (await newestHandoff(h, p.since))
  if (path === null) {
    if (p.misses + 1 < HANDOFF_MAX_MISSES) {
      await h.setHandoff(q => (q === null ? null : { ...q, misses: q.misses + 1 }))
      return
    }
    await h.setHandoff(() => null)
    h.toast('The handoff ended, but no handoff file was found to copy.')
    return
  }
  await h.setHandoff(() => null)
  const isCopied = await h.copy(path, p.surface)
  h.toast(isCopied ? `Copied the handoff path: ${path}` : `The handoff is at ${path}. Copy is not available here.`, 10000)
}

// The resume key's source: a handoff path on the clipboard. The plugin API
// has no clipboard read, so wl-paste reads it. Only a session with no context
// yet looks, so the read stops after the first turn.
export async function refreshResume(h: HandoffHost): Promise<void> {
  let path: string | null = null
  if (!(await h.hasContext())) {
    try {
      const r = await h.run(['wl-paste', '--no-newline', '--type', 'text/plain'], 2000)
      const found = r.exitCode === 0 ? handoffPathFrom(r.stdout, (await h.home()) ?? '') : null
      path = found !== null && (await h.exists(found)) ? found : null
    } catch (error) {
      h.fail(error)
    }
  }
  if (path !== (await h.getResume())) await h.setResume(path)
}

// The resume key: puts /context-resume and the path in an empty prompt box.
// It never writes over a draft the person typed.
export async function pressResume(h: HandoffHost): Promise<void> {
  const path = await h.getResume()
  if (path === null) return
  if ((await h.promptText()).trim() !== '') {
    h.toast('The prompt holds a draft. Clear it, then press resume again.')
    return
  }
  if (!(await h.fill(resumeCommand(path)))) h.toast(`The prompt did not take the command. Type: ${resumeCommand(path)}`, 10000)
}
