// Typings of the generated engine module (tools/build-engine.sh): the Emscripten
// exports the driver uses and the `dg` bridge object tools/dg-library.js adds.

export type DoomKeyEvent = { pressed: 0 | 1; key: number }

export type DoomBridge = {
  /** The virtual clock in milliseconds; the driver advances it, DG_SleepMs adds to it. */
  ticksMs: number
  /** Pending key events, consumed by DG_GetKey one per call. */
  keys: DoomKeyEvent[]
  /** Set by DG_DrawFrame; the driver clears it before a tick. */
  frameDirty: boolean
  /** The last DG_SetWindowTitle. */
  title: string
  /** Set by DG_OnQuit (the patched I_Quit). */
  quitRequested: boolean
  /** Called by DG_OnSaveGame with the saved file's path and bytes. */
  onSave: ((path: string, bytes: Uint8Array) => void) | null
}

export type DoomFs = {
  writeFile(path: string, data: Uint8Array): void
  readFile(path: string): Uint8Array
  mkdir(path: string): void
  readdir(path: string): string[]
  unlink(path: string): void
}

export type DoomModule = {
  FS: DoomFs
  HEAPU8: Uint8Array
  HEAPU32: Uint32Array
  stringToNewUTF8(text: string): number
  UTF8ToString(pointer: number): string
  _malloc(bytes: number): number
  _free(pointer: number): void
  _doomgeneric_Create(argc: number, argv: number): void
  _doomgeneric_Tick(): void
  _DG_GetScreenBuffer(): number
  _DG_GetScreenWidth(): number
  _DG_GetScreenHeight(): number
  dg: DoomBridge
}

export type DoomModuleArg = {
  print?: (line: string) => void
  printErr?: (line: string) => void
}

export type CreateDoom = (arg?: DoomModuleArg) => Promise<DoomModule>

declare const createDoom: CreateDoom
export default createDoom
