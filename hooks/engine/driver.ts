// Driver: one running game over the generated engine module. No `$` here: the
// glue hands in the WAD bytes, the saves and two callbacks, then ticks it on
// its own timer. Time is virtual: each tick advances the engine's clock one tic.
import type { KeyEvent } from '../keys'
import type { CreateDoom, DoomModule } from './doomgeneric'

export const TIC_MS = 1000 / 35
/** Where doomgeneric keeps its savegames (configdir `.` + `.savegame/`). */
export const SAVE_DIR = '/.savegame'

export type GameHooks = {
  /** A line the engine printed (stdout and stderr). */
  log: (line: string) => void
  /** A savegame was written: its file name (`doomsav0.dsg`) and bytes. */
  onSave: (file: string, bytes: Uint8Array) => void
}

export type Game = {
  readonly wadName: string
  readonly width: number
  readonly height: number
  /** Runs one tic; true when the engine drew a new frame. */
  tick(): boolean
  pushKey(event: KeyEvent): void
  /** The current frame, `width * height` pixels of 0x00RRGGBB; a live view. */
  frame(): Uint32Array
  title(): string
  /** Set once the engine stopped: an I_Error, or the person quit from the menu. */
  stopped(): { reason: 'error' | 'quit'; message: string } | undefined
}

const isExitStatus = (error: unknown): error is { name: string; status: number } =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ExitStatus'

const describe = (error: unknown, lastLines: string[]): string => {
  const tail = lastLines.filter(line => line.trim() !== '').slice(-3).join(' | ')
  if (isExitStatus(error)) return `the engine exited with status ${error.status}${tail ? `: ${tail}` : ''}`
  const message = error instanceof Error ? error.message : String(error)
  return tail ? `${message}: ${tail}` : message
}

/**
 * Creates the engine, mounts the WAD and the saves, and runs DOOM's own init
 * (which returns after the first frame). Rejects with the engine's reason.
 */
export async function createGame(
  createDoom: CreateDoom,
  wadName: string,
  wadBytes: Uint8Array,
  saves: Readonly<Record<string, Uint8Array>>,
  hooks: GameHooks,
): Promise<Game> {
  const recent: string[] = []
  const log = (line: string): void => {
    recent.push(line)
    if (recent.length > 20) recent.shift()
    hooks.log(line)
  }
  const module: DoomModule = await createDoom({ print: log, printErr: log })
  const wadPath = `/${wadName}`
  module.FS.writeFile(wadPath, wadBytes)
  try {
    module.FS.mkdir(SAVE_DIR)
  } catch {
    // already there
  }
  for (const [file, bytes] of Object.entries(saves)) module.FS.writeFile(`${SAVE_DIR}/${file}`, bytes)
  module.dg.onSave = (path, bytes) => hooks.onSave(path.slice(path.lastIndexOf('/') + 1), bytes)
  module.dg.ticksMs = 1000
  const argv = ['doom', '-iwad', wadPath, '-nogui']
  const pointers = argv.map(arg => module.stringToNewUTF8(arg))
  const argvPointer = module._malloc(4 * (pointers.length + 1))
  pointers.forEach((pointer, index) => {
    module.HEAPU32[(argvPointer >> 2) + index] = pointer
  })
  module.HEAPU32[(argvPointer >> 2) + pointers.length] = 0
  try {
    module._doomgeneric_Create(pointers.length, argvPointer)
  } catch (error) {
    throw new Error(describe(error, recent))
  }
  const width = module._DG_GetScreenWidth()
  const height = module._DG_GetScreenHeight()
  const screen = module._DG_GetScreenBuffer() >> 2
  const pixels = module.HEAPU32.subarray(screen, screen + width * height)
  let stopped: ReturnType<Game['stopped']>

  return {
    wadName,
    width,
    height,
    tick() {
      if (stopped !== undefined) return false
      module.dg.ticksMs += TIC_MS
      module.dg.frameDirty = false
      try {
        module._doomgeneric_Tick()
      } catch (error) {
        stopped = { reason: 'error', message: describe(error, recent) }
        return false
      }
      if (module.dg.quitRequested) stopped = { reason: 'quit', message: 'quit from the menu' }
      return module.dg.frameDirty
    },
    pushKey(event) {
      if (stopped === undefined) module.dg.keys.push({ pressed: event.pressed ? 1 : 0, key: event.key & 0xff })
    },
    frame: () => pixels,
    title: () => module.dg.title,
    stopped: () => stopped,
  }
}
