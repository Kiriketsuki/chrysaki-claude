// The personal config: values that belong to one person, not to the mod.
// The mod reads it from `~/.config/chrysaki/claude.json`, or from the path in
// CHRYSAKI_CLAUDE_CONFIG. Without the file every feature it feeds is off or
// generic. See personal.example.json beside the mod's README. No I/O
// happens here.

import type { PersonalConfig, StatuslineAccount } from '../types'

export const EMPTY_PERSONAL: PersonalConfig = { accounts: [], sharePartners: {}, configDirs: [], githubAccounts: {}, inbox: null }

// Where the file lives: the env override, else the XDG config folder.
export function personalPath(override: string | undefined, xdgConfig: string | undefined, home: string): string {
  if (override !== undefined && override !== '') return override
  return `${xdgConfig !== undefined && xdgConfig !== '' ? xdgConfig : `${home}/.config`}/chrysaki/claude.json`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringMap(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {}
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string' && e[0] !== ''))
}

// The config in the file's text. A field that breaks its shape is dropped
// alone, so one typo never turns off the rest.
export function parsePersonal(text: string | null, home: string): PersonalConfig {
  if (text === null) return EMPTY_PERSONAL
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return EMPTY_PERSONAL
  }
  if (!isRecord(raw)) return EMPTY_PERSONAL
  const tilde = (p: string) => (p.startsWith('~/') ? `${home}${p.slice(1)}` : p)
  const accounts: StatuslineAccount[] = Array.isArray(raw.accounts)
    ? raw.accounts.flatMap(a => (isRecord(a) && typeof a.email === 'string' && a.email.includes('@')
      ? [{ email: a.email.trim().toLowerCase(), profile: typeof a.profile === 'string' ? a.profile : '', path: '', isWork: a.isWork === true }]
      : []))
    : []
  const configDirs = Array.isArray(raw.configDirs)
    ? raw.configDirs.flatMap(r => (isRecord(r) && typeof r.match === 'string' && r.match !== '' && typeof r.dir === 'string' && r.dir !== ''
      ? [{ match: r.match, dir: tilde(r.dir), isWork: r.isWork === true }]
      : []))
    : []
  const inbox = isRecord(raw.inbox) && typeof raw.inbox.file === 'string' && raw.inbox.file !== ''
    ? { file: raw.inbox.file, heading: typeof raw.inbox.heading === 'string' && raw.inbox.heading !== '' ? raw.inbox.heading : 'Inbox' }
    : null
  const partners = stringMap(raw.sharePartners)
  return {
    accounts,
    sharePartners: Object.fromEntries(Object.entries(partners).map(([a, b]) => [a.toLowerCase(), b.toLowerCase()])),
    configDirs,
    githubAccounts: stringMap(raw.githubAccounts),
    inbox,
  }
}

// The Claude config folder for a session in `cwd`: CLAUDE_CONFIG_DIR when set,
// else the first rule whose `match` appears in the cwd, else ~/.claude.
export function configDirFor(p: PersonalConfig, cwd: string, envDir: string | undefined, home: string): { dir: string; isWork: boolean } {
  if (envDir !== undefined && envDir !== '') {
    const rule = p.configDirs.find(r => r.dir === envDir)
    return { dir: envDir, isWork: rule?.isWork ?? false }
  }
  const rule = p.configDirs.find(r => cwd.includes(r.match))
  return rule === undefined ? { dir: `${home}/.claude`, isWork: false } : { dir: rule.dir, isWork: rule.isWork }
}
