import { describe, expect, test } from 'claude-code/testing'

import { blankCells, countColorPairs, DEFAULT_COLOR, encodeCells, encodeFrame, HALF_BLOCK, packHalfBlocks, SPACE, toBase64 } from '../hooks/cells'
import { base64Of } from './fixtures'

// a 4x4 frame: top half red, bottom half blue, the last column green all the way down
const RED = 0xff0000
const BLUE = 0x0000ff
const GREEN = 0x00ff00
const frame = {
  width: 4,
  height: 4,
  pixels: Uint32Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? GREEN : i < 8 ? RED : BLUE)),
}

describe('packHalfBlocks', () => {
  test('one cell per pixel column pair, upper pixel foreground, lower pixel background', () => {
    // 4 columns x 1 row of cells covers 4x2 pixels: samples rows 0 and 2
    const words = packHalfBlocks(frame, 4, 1)
    expect(words.length).toBe(12)
    expect([...words.slice(0, 3)]).toEqual([HALF_BLOCK, RED, BLUE])
    expect([...words.slice(9, 12)]).toEqual([SPACE, GREEN, GREEN])
  })

  test('a frame sampled 1:1 keeps every pixel pair', () => {
    const words = packHalfBlocks(frame, 4, 2)
    // row 0 of cells: pixel rows 0 and 1 (both red), so a space on red
    expect([...words.slice(0, 3)]).toEqual([SPACE, RED, RED])
    // row 1: pixel rows 2 and 3 (both blue)
    expect([...words.slice(12, 15)]).toEqual([SPACE, BLUE, BLUE])
  })

  test('the alpha byte is dropped', () => {
    const words = packHalfBlocks({ width: 1, height: 2, pixels: [0xff123456, 0x01abcdef] }, 1, 1)
    expect([...words]).toEqual([HALF_BLOCK, 0x123456, 0xabcdef])
  })

  test('upscaling repeats pixels, downscaling skips them', () => {
    const up = packHalfBlocks(frame, 8, 4)
    expect(up.length).toBe(8 * 4 * 3)
    expect(up[1]).toBe(RED)
    expect(up[(8 * 3 + 7) * 3 + 1]).toBe(GREEN)
    const down = packHalfBlocks(frame, 2, 1)
    expect([...down]).toEqual([HALF_BLOCK, RED, BLUE, HALF_BLOCK, RED, BLUE])
  })
})

describe('encoding', () => {
  test('toBase64 matches a plain implementation, with and without the runtime method', () => {
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 37) & 255)
    expect(toBase64(bytes)).toBe(base64Of(bytes))
    expect(toBase64(bytes.subarray(0, 49))).toBe(base64Of(bytes.subarray(0, 49)))
    expect(toBase64(bytes.subarray(0, 47))).toBe(base64Of(bytes.subarray(0, 47)))
    const bare = Object.assign(Object.create(null), { length: 2, 0: 255, 1: 1 }) as unknown as Uint8Array
    expect(toBase64(bare)).toBe('/wE=')
  })

  test('encodeFrame is 16 characters per cell', () => {
    expect(encodeFrame(frame, 4, 2).length).toBe(4 * 2 * 16)
    expect(encodeCells(packHalfBlocks(frame, 3, 3)).length).toBe(3 * 3 * 16)
  })

  test('a blank Raster is spaces on the default color', () => {
    const cells = blankCells(2, 1)
    expect(cells.length).toBe(32)
    const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
    const words = new Uint32Array(bytes.buffer)
    expect([...words]).toEqual([SPACE, DEFAULT_COLOR, DEFAULT_COLOR, SPACE, DEFAULT_COLOR, DEFAULT_COLOR])
  })

  test('countColorPairs counts distinct foreground/background pairs', () => {
    expect(countColorPairs(packHalfBlocks(frame, 4, 1))).toBe(2)
    expect(countColorPairs(packHalfBlocks(frame, 4, 2))).toBe(3)
  })
})
