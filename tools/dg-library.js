// Emscripten JS library: the doomgeneric platform functions, driven from the
// doom-pane hooks module through `Module.dg`. Nothing here touches console,
// timers or the DOM: the host owns time (a virtual clock) and the frame.
addToLibrary({
  $DG__postset: 'DG.init();',
  $DG: {
    init() {
      Module.dg = {
        ticksMs: 0,        // the virtual clock; the host advances it per tick
        keys: [],          // pending { pressed: 0|1, key: doomKeyCode }
        frameDirty: false, // set by DG_DrawFrame, cleared by the host
        title: '',
        quitRequested: false,
        onSave: null,      // (path: string, bytes: Uint8Array) => void
      };
    },
  },
  DG_Init__deps: ['$DG'],
  DG_Init: () => {},
  DG_DrawFrame__deps: ['$DG'],
  DG_DrawFrame: () => { Module.dg.frameDirty = true; },
  DG_SleepMs__deps: ['$DG'],
  DG_SleepMs__sig: 'vi',
  // A sleep is virtual time passing: TryRunTics waits with I_Sleep(1) until
  // the clock crosses a tic, so without this the wait could never end.
  DG_SleepMs: (ms) => { Module.dg.ticksMs += ms >>> 0; },
  DG_GetTicksMs__deps: ['$DG'],
  DG_GetTicksMs__sig: 'i',
  DG_GetTicksMs: () => Module.dg.ticksMs >>> 0,
  DG_GetKey__deps: ['$DG'],
  DG_GetKey__sig: 'ipp',
  DG_GetKey: (pressedPtr, keyPtr) => {
    const next = Module.dg.keys.shift();
    if (next === undefined) return 0;
    HEAP32[pressedPtr >> 2] = next.pressed ? 1 : 0;
    HEAPU8[keyPtr] = next.key & 0xff;
    return 1;
  },
  DG_SetWindowTitle__deps: ['$DG', '$UTF8ToString'],
  DG_SetWindowTitle__sig: 'vp',
  DG_SetWindowTitle: (ptr) => { Module.dg.title = UTF8ToString(ptr); },
  DG_OnSaveGame__deps: ['$DG', '$UTF8ToString', '$FS'],
  DG_OnSaveGame__sig: 'vp',
  DG_OnSaveGame: (ptr) => {
    const path = UTF8ToString(ptr);
    const onSave = Module.dg.onSave;
    if (typeof onSave !== 'function') return;
    try {
      onSave(path, FS.readFile(path));
    } catch (error) {
      err(`DG_OnSaveGame failed for ${path}: ${error && error.message ? error.message : error}`);
    }
  },
  DG_OnQuit__deps: ['$DG'],
  DG_OnQuit__sig: 'v',
  DG_OnQuit: () => { Module.dg.quitRequested = true; },
});
