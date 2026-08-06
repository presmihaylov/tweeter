import { createHash } from 'node:crypto'

// x.com builds the x-client-transaction-id header inside its own bundle (webpack module
// 208932 of ondemand.s.*.js). The value proves a real rendering engine ran: the page ships
// four loading animations as SVG paths, the bundle replays one of them as a CSS animation,
// pauses it, and hashes the computed style it reads back. This is a port of that code.
//
// Verified against the genuine generator in a real Chrome: 81 of 81 generated ids matched
// byte for byte, and the animation model matched on all 4 elements x 16 rows x 182 reachable
// pause times. tools/checkTransactionId.ts re-runs that check when x.com ships a new bundle.
//
// The header decodes to 70 bytes:
//   [0]      a random mask byte, sent in the clear
//   [1..48]  the 48-byte twitter-site-verification key of the page
//   [49..52] uint32 little endian, seconds since the X epoch
//   [53..68] the first 16 bytes of the SHA-256 digest
//   [69]     the constant 0x03
// Every byte after the first is XORed with the first.

const xEpochSeconds = 1682924400
const digestSalt = 'obfiowerehiring'
const trailerByte = 0x03
const animationDurationMs = 4096
const verificationKeyLength = 48

// The verification key rotates per HTML response and the SVG paths change per build, so both
// have to be read from the same document. Mixing two responses yields a wrong header.
export type PageContext = {
  verificationKey: string
  animationPaths: string[]
}

export type TransactionIdOptions = {
  path: string
  method: string
  page: PageContext
  nowMs?: number
  maskByte?: number
}

export const parsePageContext = (html: string): PageContext | undefined => {
  const verificationKey = /<meta[^>]+name="twitter-site-verification"[^>]+content="([^"]+)"/.exec(html)?.[1]
  if (!verificationKey) {
    return undefined
  }
  const animationPaths: string[] = []
  for (let index = 0; index < 4; index += 1) {
    const svg = new RegExp(`<svg[^>]*id="loading-x-anim-${index}"[\\s\\S]*?</svg>`).exec(html)?.[0]
    if (!svg) {
      return undefined
    }
    animationPaths.push(svg)
  }
  return { verificationKey, animationPaths }
}

// The bundle reads the second <path> of the <g> as childNodes[0].childNodes[1], which lands
// on the right node only because the shell HTML carries no whitespace between the tags.
export const extractAnimationPath = (svg: string): string => {
  const paths = [...svg.matchAll(/<path\b[^>]*?\bd="([^"]*)"/g)].map((match) => match[1])
  const second = paths[1]
  if (second === undefined) {
    return ''
  }
  return second
}

// "M 10,30 C..." holds 16 curve segments of 11 numbers. Each segment is one animation frame.
export const parseAnimationFrames = (pathData: string): number[][] =>
  pathData
    .substring(9)
    .split('C')
    .map((segment) => segment.replace(/[^\d]+/g, ' ').trim().split(' ').map(Number))

type Keyframes = {
  fromColor: [number, number, number]
  toColor: [number, number, number]
  toAngleDeg: number
  easing: [number, number, number, number]
}

const scaleTo = (value: number, low: number, high: number): number => (value * (high - low)) / 255 + low

const columnOf = (row: number[], index: number): number => {
  const value = row[index]
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`animation frame column ${index} is ${String(value)}, expected 0..255`)
  }
  return value
}

export const buildKeyframes = (row: number[]): Keyframes => ({
  fromColor: [columnOf(row, 0), columnOf(row, 1), columnOf(row, 2)],
  toColor: [columnOf(row, 3), columnOf(row, 4), columnOf(row, 5)],
  toAngleDeg: Math.floor(scaleTo(columnOf(row, 6), 60, 360)),
  // The bundle writes these into a CSS string with toFixed(2), so the browser only ever
  // sees two decimals. Rounding here keeps the port on the same numbers.
  easing: [7, 8, 9, 10].map((index, offset) =>
    Number(scaleTo(columnOf(row, index), offset % 2 === 0 ? 0 : -1, 1).toFixed(2))
  ) as [number, number, number, number]
})

// gfx::CubicBezier, the sample table solver Chrome uses. A high precision solve does not
// match: Chrome's answer is good to about 1e-6, which shows in the serialized matrix.
export const solveCubicBezier = (x1: number, y1: number, x2: number, y2: number, x: number): number => {
  if (x <= 0) {
    return 0
  }
  if (x >= 1) {
    return 1
  }
  const splineSize = 11
  const step = 1 / (splineSize - 1)
  const newtonIterations = 4
  const newtonMinSlope = 0.001
  const subdivisionPrecision = 0.0000001
  const subdivisionMaxIterations = 10

  const curveA = (a1: number, a2: number): number => 1 - 3 * a2 + 3 * a1
  const curveB = (a1: number, a2: number): number => 3 * a2 - 6 * a1
  const curveC = (a1: number): number => 3 * a1
  const at = (t: number, a1: number, a2: number): number => ((curveA(a1, a2) * t + curveB(a1, a2)) * t + curveC(a1)) * t
  const slopeAt = (t: number, a1: number, a2: number): number => 3 * curveA(a1, a2) * t * t + 2 * curveB(a1, a2) * t + curveC(a1)

  const samples = Array.from({ length: splineSize }, (_, index) => at(index * step, x1, x2))
  let intervalStart = 0
  let sample = 1
  for (; sample !== splineSize - 1 && (samples[sample] ?? 0) <= x; sample += 1) {
    intervalStart += step
  }
  sample -= 1
  const low = samples[sample] ?? 0
  const high = samples[sample + 1] ?? 0
  let guess = intervalStart + ((x - low) / (high - low)) * step

  const initialSlope = slopeAt(guess, x1, x2)
  if (initialSlope === 0) {
    return at(guess, y1, y2)
  }
  if (initialSlope >= newtonMinSlope) {
    for (let index = 0; index < newtonIterations; index += 1) {
      const slope = slopeAt(guess, x1, x2)
      if (slope === 0) {
        return at(guess, y1, y2)
      }
      guess -= (at(guess, x1, x2) - x) / slope
    }
    return at(guess, y1, y2)
  }
  let lowBound = intervalStart
  let highBound = intervalStart + step
  let time = 0
  let error = 0
  let iteration = 0
  do {
    time = lowBound + (highBound - lowBound) / 2
    error = at(time, x1, x2) - x
    if (error > 0) {
      highBound = time
    }
    if (error <= 0) {
      lowBound = time
    }
    iteration += 1
  } while (Math.abs(error) > subdivisionPrecision && iteration < subdivisionMaxIterations)
  return at(time, y1, y2)
}

// Blink prints matrix components with C's %.6g, which differs from String(n) below 1e-4:
// %g gives "3.41315e-05" where JavaScript gives "0.0000341315".
export const formatMatrixNumber = (value: number): string => {
  if (value === 0) {
    return '0'
  }
  const precision = 6
  const exponent = Number(value.toExponential(precision - 1).split('e')[1])
  const strip = (text: string): string => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text)
  if (exponent < -4 || exponent >= precision) {
    const mantissa = strip(value.toExponential(precision - 1).split('e')[0] ?? '')
    return `${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
  }
  return strip(value.toFixed(Math.max(0, precision - 1 - exponent)))
}

// What getComputedStyle().color + .transform returns for the paused probe element.
export const computedStyleOf = (keyframes: Keyframes, currentTimeMs: number): string => {
  const linear = Math.min(Math.max(currentTimeMs / animationDurationMs, 0), 1)
  const [x1, y1, x2, y2] = keyframes.easing
  const progress = solveCubicBezier(x1, y1, x2, y2, linear)

  const channels = keyframes.fromColor.map((from, index) => {
    const to = keyframes.toColor[index] ?? from
    return Math.min(255, Math.max(0, Math.round(from + (to - from) * progress)))
  })
  const radians = ((keyframes.toAngleDeg * progress) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const matrix = [cos, sin, -sin, cos, 0, 0].map(formatMatrixNumber).join(', ')

  return `rgb(${channels.join(', ')})matrix(${matrix})`
}

// Every number in the style string becomes hex. Note there is no zero padding here, unlike
// the keyframe colours, and that toString(16) on a fraction gives a long hex expansion.
export const styleToAnimationKey = (style: string): string =>
  [...style.matchAll(/([\d.-]+)/g)]
    .map((match) => Number(Number(match[0]).toFixed(2)).toString(16))
    .join('')
    .replace(/[.-]/g, '')

export const computeAnimationKey = (keyBytes: Uint8Array, animationPaths: string[]): string => {
  const byteAt = (index: number): number => keyBytes[index] ?? 0
  const elementIndex = byteAt(5) % 4
  const rowIndex = byteAt(7) % 16
  const pauseMs = (byteAt(30) % 16) * (byteAt(47) % 16) * (byteAt(2) % 16)

  const svg = animationPaths[elementIndex]
  if (svg === undefined) {
    throw new Error(`the page carries ${animationPaths.length} loading animations, need ${elementIndex + 1}`)
  }
  const row = parseAnimationFrames(extractAnimationPath(svg))[rowIndex]
  if (!row) {
    throw new Error(`loading animation ${elementIndex} has no frame ${rowIndex}`)
  }
  return styleToAnimationKey(computedStyleOf(buildKeyframes(row), Math.round(pauseMs / 10) * 10))
}

export const generateTransactionId = (options: TransactionIdOptions): string => {
  const keyBytes = new Uint8Array(Buffer.from(options.page.verificationKey, 'base64'))
  if (keyBytes.length !== verificationKeyLength) {
    throw new Error(`the verification key decodes to ${keyBytes.length} bytes, expected ${verificationKeyLength}`)
  }
  const seconds = Math.floor(((options.nowMs ?? Date.now()) - xEpochSeconds * 1000) / 1000)
  const animationKey = computeAnimationKey(keyBytes, options.page.animationPaths)

  // The bundle takes (path, method) but hashes the method first.
  const preimage = [options.method, options.path, seconds].join('!') + digestSalt + animationKey
  const digest = new Uint8Array(createHash('sha256').update(preimage, 'utf8').digest())

  const out = new Uint8Array(70)
  out[0] = (options.maskByte ?? Math.floor(Math.random() * 256)) & 0xff
  out.set(keyBytes, 1)
  new DataView(out.buffer).setUint32(49, seconds >>> 0, true)
  out.set(digest.subarray(0, 16), 53)
  out[69] = trailerByte
  for (let index = 1; index < out.length; index += 1) {
    out[index] = (out[index] ?? 0) ^ (out[0] ?? 0)
  }
  return Buffer.from(out).toString('base64').replace(/=/g, '')
}

// The caller in the x.com bundle strips the query string before hashing, so the port must too.
export const transactionPathOf = (url: string): string => {
  const parsed = URL.canParse(url) ? new URL(url) : undefined
  return (parsed?.pathname ?? url.split('?')[0] ?? '').trim()
}
