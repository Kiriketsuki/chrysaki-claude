import { describe, expect, test } from 'claude-code/testing'

import { resolveTools } from '../hooks/tools'

const LINUX_DEFAULTS = { python: 'python3', kilintPath: '/home/kiriketsuki/dev/obKidian/000-System/Scripts/kilint/bin/kilint' }
const VAULT = 'C:/Users/Kidriel/dev/obKidian'

describe('resolveTools', () => {
  test('keeps the configured values off Windows', async () => {
    expect(resolveTools(LINUX_DEFAULTS, { platform: 'linux', vaultRoot: VAULT })).toEqual(LINUX_DEFAULTS)
    expect(resolveTools(LINUX_DEFAULTS, { platform: undefined, vaultRoot: undefined })).toEqual(LINUX_DEFAULTS)
  })

  test('uses python and the vault root on Windows', async () => {
    expect(resolveTools(LINUX_DEFAULTS, { platform: 'windows', vaultRoot: VAULT })).toEqual({
      python: 'python',
      kilintPath: `${VAULT}/000-System/Scripts/kilint/bin/kilint`,
    })
  })

  test('drops a trailing separator from the vault root', async () => {
    const tools = resolveTools(LINUX_DEFAULTS, { platform: 'windows', vaultRoot: 'C:\\vault\\' })
    expect(tools.kilintPath).toBe('C:\\vault/000-System/Scripts/kilint/bin/kilint')
  })

  test('keeps a POSIX path on Windows when no vault root is set', async () => {
    expect(resolveTools(LINUX_DEFAULTS, { platform: 'windows', vaultRoot: undefined }).kilintPath).toBe(LINUX_DEFAULTS.kilintPath)
    expect(resolveTools(LINUX_DEFAULTS, { platform: 'windows', vaultRoot: '' }).kilintPath).toBe(LINUX_DEFAULTS.kilintPath)
  })

  test('keeps values the person set for Windows', async () => {
    const set = { python: 'C:/Python313/python.exe', kilintPath: 'D:/tools/kilint' }
    expect(resolveTools(set, { platform: 'windows', vaultRoot: VAULT })).toEqual(set)
  })
})
