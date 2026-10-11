import { describe, expect, test } from 'claude-code/testing'

import { MAX_CELLS, MIN_COLUMNS, MIN_ROWS, RASTER_MAX_COLUMNS, sameSize, viewSize } from '../hooks/view'

describe('viewSize', () => {
  test('a wide, tall pane gets the cell cap at 4:3', () => {
    const size = viewSize({ bodyColumns: 200, bodyRows: 80, legendRows: 4 })
    expect(size.columns * size.rows).toBeLessThanOrEqual(MAX_CELLS)
    expect(size.rows).toBe(Math.floor((size.columns * 3) / 8))
    expect(size.columns).toBe(84)
  })

  test('a narrow pane is bound by its width', () => {
    const size = viewSize({ bodyColumns: 60, bodyRows: 80, legendRows: 4 })
    expect(size).toEqual({ columns: 60, rows: 22 })
  })

  test('a short pane is bound by its height and narrows to keep 4:3', () => {
    const size = viewSize({ bodyColumns: 120, bodyRows: 20, legendRows: 4 })
    expect(size.rows).toBe(16)
    expect(size.columns).toBe(42)
  })

  test('a tiny pane still gets the minimum view', () => {
    const size = viewSize({ bodyColumns: 5, bodyRows: 3, legendRows: 4 })
    expect(size).toEqual({ columns: MIN_COLUMNS, rows: MIN_ROWS })
  })

  test('a custom cap and the Raster bounds hold', () => {
    const big = viewSize({ bodyColumns: 1000, bodyRows: 1000, legendRows: 0, maxCells: 1_000_000 })
    expect(big.columns).toBe(RASTER_MAX_COLUMNS)
    expect(big.rows).toBe(192)
    const small = viewSize({ bodyColumns: 100, bodyRows: 100, legendRows: 0, maxCells: 1200 })
    expect(small.columns * small.rows).toBeLessThanOrEqual(1200)
    expect(small.columns).toBe(40)
  })

  test('sameSize compares both dimensions and tolerates undefined', () => {
    expect(sameSize({ columns: 1, rows: 2 }, { columns: 1, rows: 2 })).toBe(true)
    expect(sameSize({ columns: 1, rows: 2 }, { columns: 1, rows: 3 })).toBe(false)
    expect(sameSize(undefined, { columns: 1, rows: 2 })).toBe(false)
  })
})
