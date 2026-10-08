// Mirrors palette/chrysaki-core.sh in chrysaki-claude, which chrysaki-core generates.
// Regenerate this file when that one changes. Do not edit the values by hand.
export const CORE = {
  abyss: '#0f1117',
  accent: '#3a2068',
  amethyst: '#3a2068',
  amethystDim: '#1e1040',
  amethystLight: '#583090',
  base: '#161821',
  blonde: '#fbb13c',
  blondeDim: '#c4861c',
  blondeLight: '#fcc96a',
  blue: '#122858',
  blueDim: '#0c1a40',
  blueLight: '#1c3d7a',
  border: '#363a4f',
  bronze: '#b38b62',
  cerulean: '#3d95e0',
  elevated: '#2e3142',
  emerald: '#14664e',
  emeraldDim: '#0e4a38',
  emeraldLight: '#1a8a6a',
  error: '#8c2f39',
  errorDim: '#5e1f25',
  errorLight: '#b53f4a',
  info: '#122858',
  peridot: '#9da82a',
  raised: '#252836',
  rhodolite: '#9e2d6e',
  slate: '#62758a',
  success: '#14664e',
  surface: '#1c1f2b',
  teal: '#197278',
  tealDim: '#0f4f54',
  tealLight: '#20969c',
  textInverse: '#0f1117',
  textMuted: '#6a6e82',
  textPrimary: '#e0e2ea',
  textSecondary: '#a0a4b8',
  topaz: '#d47622',
  warning: '#fbb13c',
} as const

// Statusline roles. These mirror palette/integration.sh.
export const ROLE = {
  emeraldLt: CORE.emeraldLight,
  sec: CORE.textSecondary,
  muted: CORE.textMuted,
  teal: CORE.tealLight,
  blondeLt: CORE.blondeLight,
  warn: CORE.blonde,
  error: CORE.errorLight,
  hexEmpty: CORE.border,
  // No core token exists for git diff colours. integration.sh keeps them local.
  green: '#50b450',
  red: '#c05050',
  // The bash script uses terminal orange (xterm 208) for the ctx warning. Topaz is the nearest core token.
  orange: CORE.topaz,
  text: CORE.textPrimary,
} as const

// The nine-colour jewel pool from statusline-command.sh, bright then dim.
export const JEWELS = ['#1a8a6a', '#1a7764', '#1b6372', '#1c3d7a', '#2b3780', '#3a3085', '#583090', '#464888', '#32607e'] as const
export const JEWELS_DIM = ['#146850', '#145a4c', '#154b56', '#162e5c', '#202a60', '#2c2464', '#42246c', '#353666', '#26485f'] as const
