// Picks the interpreter and the kilint script for the platform. The manifest
// defaults are Linux values, and settings sync between a Linux machine and a
// Windows machine, so the defaults must work on both without a setting.

export type Tools = { python: string; kilintPath: string }

export type Host = {
  platform: string | undefined
  // The value of CHRYSAKI_VAULT_ROOT, the obKidian vault on this machine.
  vaultRoot: string | undefined
}

const KILINT_IN_VAULT = '000-System/Scripts/kilint/bin/kilint'
const WINDOWS = 'windows'
const POSIX_PYTHON = 'python3'
const WINDOWS_PYTHON = 'python'

// On Windows, `python3` is a .cmd shim or a Store stub, and a direct process
// start runs neither. A POSIX path such as /home/<user>/... names no file
// there, so the vault root gives the script path instead.
export function resolveTools(configured: Tools, host: Host): Tools {
  if (host.platform !== WINDOWS) return configured
  const python = configured.python === POSIX_PYTHON ? WINDOWS_PYTHON : configured.python
  const root = (host.vaultRoot ?? '').replace(/[\\/]+$/, '')
  const isPosixPath = configured.kilintPath.startsWith('/')
  const kilintPath = isPosixPath && root !== '' ? `${root}/${KILINT_IN_VAULT}` : configured.kilintPath
  return { python, kilintPath }
}
