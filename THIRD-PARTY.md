# Third-party code in doom-pane

## doomgeneric (the engine)

`hooks/engine/doomgeneric.js` is generated from [ozkl/doomgeneric](https://github.com/ozkl/doomgeneric) at commit
`dcb7a8d` (2026-04-12), id Software's DOOM engine (linuxdoom-1.10 by way of Chocolate Doom) with the platform
layer reduced to five functions. License: GNU GPL v2 (`LICENSE` in this folder is doomgeneric's copy), so this
plugin as a whole is distributed under the GPL v2.

How it is built (`tools/build-engine.sh`, see the README):

- Emscripten 6.0.12 (Docker image `emscripten/emsdk:6.0.12`), `-O2`, `-sWASM=0` (wasm2js: plain JavaScript, no
  WebAssembly, which a Claude Code hooks module does not have), `-sMODULARIZE=1 -sEXPORT_NAME=createDoom`,
  `-sENVIRONMENT=web`, `-sFORCE_FILESYSTEM=1` (the WAD and the saves live in Emscripten's in-memory FS),
  `-sINITIAL_MEMORY=32MiB`, `-DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200`.
- Sources: the Makefile's `SRC_DOOM` list without `doomgeneric_xlib.c`, plus `tools/dg-platform.c` (three getters)
  and the JS library `tools/dg-library.js` (the `DG_*` platform functions: a virtual clock, a key queue, a frame
  flag, the title, the save and quit callbacks). No sound module is compiled in.
- Patches (`tools/patches/`): `0001-save-and-quit-callbacks.patch` adds `DG_OnSaveGame(path)` after a savegame
  is renamed into place (`g_game.c`) and `DG_OnQuit()` at the end of `I_Quit` (`i_system.c`).
- Post-processing (`tools/postprocess.mjs`): `export default createDoom`, the eager `console` bindings replaced
  (the hooks runtime has no usable console), and a gate that fails the build on an unguarded `eval`, `new
  Function`, `import.meta`, `require` or `process`.

## The game data

No WAD is shipped. `tools/prepare-wad.mjs --shareware` downloads id Software's shareware episode
(`doom19s.zip` from the idgames archive, verified by MD5), which id's license lets anyone copy unmodified and not
sell. The registered games (`doom.wad`, `doom2.wad`, Final DOOM) are the player's own copies, split the same way.
