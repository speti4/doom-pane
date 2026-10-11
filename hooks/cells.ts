// Cells: a 0x00RRGGBB frame packed into Raster cells. Each cell is an upper
// half block whose foreground is the upper pixel and background the lower one,
// so a cell holds two pixel rows; a cell whose pixels agree is a plain space on
// that background. Pure.

/** U+2580 UPPER HALF BLOCK. */
export const HALF_BLOCK = 0x2580
export const SPACE = 0x20
/** The Raster's "terminal default" color. */
export const DEFAULT_COLOR = 0x01000000

export type Frame = { width: number; height: number; pixels: ArrayLike<number> }

/**
 * Samples `frame` into `columns` x `rows` cells (nearest neighbour over
 * `columns` x `2 * rows` pixels) as the Raster's little-endian u32 triplets.
 */
export function packHalfBlocks(frame: Frame, columns: number, rows: number): Uint32Array {
  const { width, height, pixels } = frame
  const words = new Uint32Array(columns * rows * 3)
  const pixelRows = rows * 2
  for (let cy = 0; cy < rows; cy++) {
    const upperRow = Math.floor((2 * cy * height) / pixelRows) * width
    const lowerRow = Math.floor(((2 * cy + 1) * height) / pixelRows) * width
    for (let cx = 0; cx < columns; cx++) {
      const sx = Math.floor((cx * width) / columns)
      const upper = (pixels[upperRow + sx] ?? 0) & 0xffffff
      const lower = (pixels[lowerRow + sx] ?? 0) & 0xffffff
      const at = (cy * columns + cx) * 3
      if (upper === lower) {
        words[at] = SPACE
        words[at + 1] = upper
        words[at + 2] = upper
      } else {
        words[at] = HALF_BLOCK
        words[at + 1] = upper
        words[at + 2] = lower
      }
    }
  }
  return words
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const digit = (n: number): string => BASE64.charAt(n & 63)

/** Standard padded base64 of the bytes; the runtime's own method where it has one. */
export function toBase64(bytes: Uint8Array): string {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64()
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += digit(n >> 18) + digit(n >> 12) + digit(n >> 6) + digit(n)
  }
  if (i < bytes.length) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const n = (a << 16) | (b << 8)
    out += digit(n >> 18) + digit(n >> 12) + (i + 1 < bytes.length ? digit(n >> 6) : '=') + '='
  }
  return out
}

/** The cells as `RasterProps.cells` takes them. */
export function encodeCells(words: Uint32Array): string {
  return toBase64(new Uint8Array(words.buffer, words.byteOffset, words.byteLength))
}

/** `frame` as a Raster of `columns` x `rows`. */
export function encodeFrame(frame: Frame, columns: number, rows: number): string {
  return encodeCells(packHalfBlocks(frame, columns, rows))
}

/** How many distinct foreground/background pairs the cells use (the Raster paints 1024 at once). */
export function countColorPairs(words: Uint32Array): number {
  const pairs = new Set<string>()
  for (let at = 0; at + 2 < words.length; at += 3) pairs.add(`${words[at + 1]},${words[at + 2]}`)
  return pairs.size
}

/** A blank frame of one color, for a Raster drawn before the game has a frame. */
export function blankCells(columns: number, rows: number, color = DEFAULT_COLOR): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let at = 0; at < words.length; at += 3) {
    words[at] = SPACE
    words[at + 1] = color
    words[at + 2] = color
  }
  return encodeCells(words)
}
