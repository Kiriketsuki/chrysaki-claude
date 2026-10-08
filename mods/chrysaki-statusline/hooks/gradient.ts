// A cyclic colour gradient, blended in OKLab so that two jewel tones never
// pass through grey on the way. No I/O happens here.

type Lab = [number, number, number]

function toLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
}

export function hexToOklab(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [toLinear((n >> 16) & 0xff), toLinear((n >> 8) & 0xff), toLinear(n & 0xff)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return '#' + rgb.map(v => fromLinear(v).toString(16).padStart(2, '0')).join('')
}

// The colour at `t` along a loop through `stops`: 0 and 1 are the first stop.
export function sampleLoop(stops: readonly string[], t: number): string {
  if (stops.length === 0) return '#000000'
  const labs = stops.map(hexToOklab)
  const x = (((t % 1) + 1) % 1) * labs.length
  const i = Math.floor(x)
  const from = labs[i % labs.length] as Lab
  const to = labs[(i + 1) % labs.length] as Lab
  const f = x - i
  return oklabToHex([0, 1, 2].map(k => (from[k] as number) + ((to[k] as number) - (from[k] as number)) * f) as Lab)
}
