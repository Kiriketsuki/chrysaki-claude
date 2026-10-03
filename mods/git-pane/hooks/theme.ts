// Chrysaki tokens and glyphs for the git pane. The hex values mirror
// chrysaki-core and the lazygit theme in dots/chrysaki/lazygit/config.yml.

export const C = {
  abyss: '#0f1117',
  base: '#161821',
  surface: '#1c1f2b',
  raised: '#252836',
  elevated: '#2e3142',
  border: '#363a4f',
  emerald: '#14664e',
  emeraldLt: '#1a8a6a',
  royal: '#122858',
  royalLt: '#1c3d7a',
  amethyst: '#3a2068',
  amethystLt: '#583090',
  amethystDim: '#1e1040',
  teal: '#197278',
  tealLt: '#20969c',
  tealDim: '#0f4f54',
  blonde: '#fbb13c',
  blondeLt: '#fcc96a',
  error: '#8c2f39',
  errorLt: '#b53f4a',
  text: '#e0e2ea',
  text2: '#a0a4b8',
  muted: '#6a6e82',
} as const

// Powerline edges, as the tmux port uses them. See chrysaki/TILING.md.
export const EDGE = {
  back: '', // \ diagonal
  forward: '', // / diagonal
  end: '', // | terminal edge
} as const

export const HEX = '⬢' // ⬢
export const HEX_HOLLOW = '⬡' // ⬡
export const DIAMOND = '◆' // ◆

// Branch colours follow branchColorPatterns in the Chrysaki lazygit config.
// Royal Blue and Amethyst are fill colours only, so no branch uses them as text.
export function branchColor(name: string): string {
  if (/^(main|master)$/.test(name)) return C.blonde
  if (/^(feat|feature)\//.test(name)) return C.emeraldLt
  if (/^(fix|bug|bugfix|hotfix)\//.test(name)) return C.errorLt
  if (/^(release|epic|saga)\//.test(name)) return C.tealLt
  return C.text2
}

// Status letter colours: the index column is staged work (Emerald), the work
// tree column is unstaged work (Blonde, lazygit's unstagedChangesColor).
export function stagedColor(x: string): string {
  return x === '.' || x === ' ' ? C.muted : C.emeraldLt
}

export function unstagedColor(y: string): string {
  return y === '.' || y === ' ' ? C.muted : C.blonde
}

// Commit graph glyphs, the same swap the lazygit branchLogCmd does with sed.
export function prettyGraph(graph: string): string {
  return graph.replace(/\*/g, '●').replace(/\|/g, '┆').replace(/-/g, '╌')
}
