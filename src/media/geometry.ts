import type { CellSize } from './imageLayer.ts'

// Terminals report their pixel size through XTWINOPS, but multiplexers commonly swallow
// the query. This aspect (1:2.2) matches every mainstream monospace font closely enough,
// and the HiDPI density keeps prepared images sharp when the terminal downscales them.
const fallbackCell: CellSize = { widthPx: 20, heightPx: 44 }

export const parseCellOverride = (value: string | undefined): CellSize | undefined => {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/.exec(value ?? '')
  if (!match) {
    return undefined
  }
  const widthPx = Number(match[1])
  const heightPx = Number(match[2])
  if (widthPx < 1 || heightPx < 1) {
    return undefined
  }
  return { widthPx, heightPx }
}

export const cellSize = (
  resolution: { width: number; height: number } | null,
  cols: number,
  rows: number,
  override?: string
): CellSize => {
  const pinned = parseCellOverride(override)
  if (pinned) {
    return pinned
  }
  if (!resolution || cols < 1 || rows < 1 || resolution.width < 1 || resolution.height < 1) {
    return fallbackCell
  }
  return { widthPx: Math.floor(resolution.width / cols), heightPx: Math.floor(resolution.height / rows) }
}

// Shrink the placement rectangle to the image aspect ratio so the terminal never letterboxes.
export const fitCells = (
  imageWidth: number,
  imageHeight: number,
  maxCols: number,
  maxRows: number,
  cell: CellSize
): { cols: number; rows: number } => {
  if (imageWidth < 1 || imageHeight < 1) {
    return { cols: maxCols, rows: maxRows }
  }
  const scale = Math.min((maxCols * cell.widthPx) / imageWidth, (maxRows * cell.heightPx) / imageHeight)
  const cols = Math.round((imageWidth * scale) / cell.widthPx)
  const rows = Math.round((imageHeight * scale) / cell.heightPx)
  return {
    cols: Math.max(1, Math.min(maxCols, cols)),
    rows: Math.max(1, Math.min(maxRows, rows))
  }
}
