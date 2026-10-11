// View: how many Raster cells the pane's body gets. A cell is one pixel wide
// and two tall; DOOM's picture is 4:3, so a view is `columns` x `3/8 columns`
// rows. Bounded by the Raster's own limits, and by `maxCells` where the person
// caps it (the `maxCells` option). Pure.

export const MIN_COLUMNS = 20
export const MIN_ROWS = 8
export const RASTER_MAX_COLUMNS = 512
export const RASTER_MAX_ROWS = 256
/** The default cap: the Raster's own bound, so the pane's size decides. */
export const MAX_CELLS = RASTER_MAX_COLUMNS * RASTER_MAX_ROWS

export type ViewSize = { columns: number; rows: number }

export type Room = {
  /** The pane body's width in cells. */
  bodyColumns: number
  /** The pane body's height in cells. */
  bodyRows: number
  /** Rows the legend takes below the picture. */
  legendRows: number
  maxCells?: number
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/** The largest 4:3 view that fits the room and the cell cap. */
export function viewSize(room: Room): ViewSize {
  const maxCells = room.maxCells ?? MAX_CELLS
  const widest = Math.floor(Math.sqrt((maxCells * 4) / 3))
  let columns = clamp(Math.min(room.bodyColumns, widest, RASTER_MAX_COLUMNS), MIN_COLUMNS, RASTER_MAX_COLUMNS)
  let rows = Math.floor((columns * 3) / 8)
  const roomRows = room.bodyRows - room.legendRows
  if (rows > roomRows) {
    rows = roomRows
    columns = Math.min(columns, Math.floor((rows * 8) / 3))
  }
  rows = clamp(Math.min(rows, Math.floor(maxCells / Math.max(columns, 1)), RASTER_MAX_ROWS), MIN_ROWS, RASTER_MAX_ROWS)
  columns = clamp(columns, MIN_COLUMNS, RASTER_MAX_COLUMNS)
  return { columns, rows }
}

/** DOOM's tic rate. */
export const TICS_PER_SECOND = 35
/**
 * How many cells a second the terminal is asked to repaint at most: past this
 * the console's output backs up and the whole process stalls for minutes
 * (Windows Terminal, 205x81: a 160x60 view at 10 fps still rewrote 15k cells
 * a frame; a 84x31 view at 35 fps, 91k cells a second, was fine). The glue
 * adapts further from how long a blit takes to be taken.
 */
export const CELLS_PER_SECOND = 100_000
/** The frame rate the adaptive pacing never goes below. */
export const MIN_FPS = 5

/** Every how many tics a frame goes to the terminal, for a view of `cells` cells under `maxFps`. */
export function ticsPerFrame(cells: number, maxFps: number, cellsPerSecond = CELLS_PER_SECOND): number {
  const byFps = Math.ceil(TICS_PER_SECOND / Math.max(1, Math.min(TICS_PER_SECOND, maxFps)))
  const byCells = Math.ceil((TICS_PER_SECOND * Math.max(1, cells)) / cellsPerSecond)
  return Math.max(1, byFps, byCells)
}

export function sameSize(a: ViewSize | undefined, b: ViewSize | undefined): boolean {
  return a !== undefined && b !== undefined && a.columns === b.columns && a.rows === b.rows
}
