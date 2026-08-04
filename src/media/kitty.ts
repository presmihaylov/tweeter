// Kitty graphics protocol writer. Ghostty and kitty draw these images above the
// text cells, so OpenTUI can repaint underneath without disturbing a placement.

const START = '\x1b_G'
const END = '\x1b\\'

// Kitty caps one escape sequence payload at 4096 base64 bytes.
const CHUNK_BYTES = 4096

export type KittyPlacement = {
  imageId: number
  col: number
  row: number
  cols: number
  rows: number
}

export const chunkBase64 = (payload: string, size = CHUNK_BYTES): string[] => {
  const chunks: string[] = []
  for (let offset = 0; offset < payload.length; offset += size) {
    chunks.push(payload.slice(offset, offset + size))
  }
  if (chunks.length === 0) {
    chunks.push('')
  }
  return chunks
}

export const moveCursor = (col: number, row: number): string => `\x1b[${row};${col}H`

export const kittyDelete = (imageId: number): string => `${START}a=d,d=I,i=${imageId},q=2${END}`

export const kittyDeleteAll = (): string => `${START}a=d,d=A,q=2${END}`

// f=100 declares PNG, a=T transmits and places in one pass, C=1 keeps the cursor still,
// q=2 suppresses the terminal's acknowledgement so it never reaches the key parser.
export const kittyPlace = (png: Uint8Array, placement: KittyPlacement): string => {
  const chunks = chunkBase64(Buffer.from(png).toString('base64'))
  const head = `a=T,f=100,i=${placement.imageId},c=${placement.cols},r=${placement.rows},C=1,q=2`
  const parts: string[] = []
  chunks.forEach((chunk, index) => {
    const last = index === chunks.length - 1
    const keys = index === 0 ? `${head},m=${last ? 0 : 1}` : `m=${last ? 0 : 1}`
    parts.push(`${START}${keys};${chunk}${END}`)
  })
  // DECSC/DECRC brackets the move so OpenTUI's next frame writes from where it expected.
  return `\x1b7${moveCursor(placement.col, placement.row)}${parts.join('')}\x1b8`
}
