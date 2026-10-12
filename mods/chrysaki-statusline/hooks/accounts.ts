// The account switcher's model. Each Claude account maps to the Firefox user
// profile that is signed in to it, so /login opens in that profile. No I/O
// happens here.

import type { FirefoxProfile, StatuslineAccount } from '../types'

// The $.store key of the account list.
export const ACCOUNTS_KEY = 'accounts'

// The Select value of the "new Firefox profile" option. No profile has it as
// a path, since every path is absolute.
export const NEW_PROFILE = 'new-firefox-profile'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmail(text: string): boolean {
  return EMAIL.test(text.trim())
}

// The store file is the user's to edit, so its value is checked, not trusted.
export function parseAccounts(v: unknown): StatuslineAccount[] | null {
  if (!Array.isArray(v)) return null
  const out: StatuslineAccount[] = []
  for (const item of v) {
    if (typeof item !== 'object' || item === null) continue
    const a = item as Record<string, unknown>
    if (typeof a.email !== 'string' || !isEmail(a.email) || typeof a.profile !== 'string') continue
    out.push({
      email: a.email.trim().toLowerCase(),
      profile: a.profile,
      path: typeof a.path === 'string' ? a.path : '',
      isWork: a.isWork === true,
    })
  }
  return out
}

// "name<TAB>path" lines from bin/firefox-profiles.
export function parseProfiles(text: string): FirefoxProfile[] {
  return text
    .split('\n')
    .map(line => line.split('\t'))
    .filter((cols): cols is [string, string] => cols.length === 2 && cols[0] !== '' && (cols[1] ?? '').startsWith('/'))
    .map(([name, path]) => ({ name, path }))
}

// Fills each account's path from the profile of the same name. A path the
// account already has wins, so a renamed profile keeps working.
export function resolvePaths(accounts: readonly StatuslineAccount[], profiles: readonly FirefoxProfile[]): StatuslineAccount[] {
  return accounts.map(a => {
    if (a.path !== '') return a
    const match = profiles.find(p => p.name === a.profile)
    return match === undefined ? a : { ...a, path: match.path }
  })
}

// Adds an account, or replaces the one with the same email.
export function upsertAccount(accounts: readonly StatuslineAccount[], next: StatuslineAccount): StatuslineAccount[] {
  const email = next.email.trim().toLowerCase()
  const entry = { ...next, email }
  const at = accounts.findIndex(a => a.email === email)
  return at === -1 ? [...accounts, entry] : accounts.map((a, i) => (i === at ? entry : a))
}

export function accountLabel(a: StatuslineAccount): string {
  return `${a.email} · ${a.profile}`
}

// The guess for a new account: a work account when the domain is not a
// common personal mail host.
export function guessWork(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return !['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com', 'yahoo.com'].includes(domain)
}
