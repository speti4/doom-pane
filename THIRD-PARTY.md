# Third-party code and data in doom-pane

The mod's own code (`hooks/*.ts`, `hooks/*.tsx`, `tools/`, `tests/`) is (c) 2026 speti4. Because the plugin embeds
id Software's DOOM engine, the plugin as a whole is distributed under the GNU GPL v2 (`LICENSE` in this folder is
the licence text, `COPYRIGHT` the copyright lines). The parts that come from elsewhere:

## doomgeneric: the engine

`hooks/engine/doomgeneric.js` is generated from [ozkl/doomgeneric](https://github.com/ozkl/doomgeneric) at commit
`dcb7a8d` (2026-04-12): id Software's DOOM engine (linuxdoom-1.10 by way of Chocolate Doom) with the platform layer
reduced to five functions. License: GNU GPL v2 (the text is in `LICENSE`; the copyright lines are in `COPYRIGHT`). The
generated file starts with a header that names this origin.

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
- Post-processing (`tools/postprocess.mjs`): the header, `export default createDoom`, the eager `console`
  bindings replaced (the hooks runtime's `console.log` has no `bind`), Emscripten's dead loaders for fetching a
  binary or a lazy file (`fetch`, `XMLHttpRequest`) replaced by stubs that throw, and a gate that fails the build
  on an unguarded `eval`, `new Function`, `import.meta`, `require`, `process`, `fetch`, `XMLHttpRequest` or
  `WebSocket`. The engine has no way to reach the network, and the mod gives it none.

## Emscripten: the runtime inside the generated file

The generated file carries Emscripten's JavaScript runtime and library code (the module loader, the in-memory file
system, the C library shims). Emscripten is (c) 2010-2026 the Emscripten authors, available under the MIT license
and the University of Illinois/NCSA Open Source License: https://github.com/emscripten-core/emscripten/blob/main/LICENSE

## The shareware DOOM: the bundled game data, and the default

`wads/doom1/` is id Software's shareware release of DOOM, version 1.9 (`DOOM1.WAD`, 4,196,020 bytes, MD5
`f0cefca49926d00903cf57551d901abe`, SHA-256 in the manifest): the first episode, "Knee-Deep in the Dead". It is
unchanged in content and split into 2 MiB parts because the mod reads files through `$.fs.read`, which rejects a
file over 4 MiB. It was taken from id's own `doom19s.zip` on the idgames archive (MD5
`244d181457c9be5f28b91b488e67e042`) by `tools/bundle-wads.mjs shareware`, which verifies the archive and the WAD
before splitting; the release's `README.TXT` is kept beside the parts, and `LICENSE.txt` states the terms as id
set them for the shareware: free to copy and pass on, not to sell, not to modify. (c) 1993-1995 id Software, Inc.
The Debian `doom-wad-shareware` package ships the same file on the same terms.

## Freedoom: the free game data

`wads/freedoom1/` is Freedoom Phase 1, version 0.13.0 (`freedoom1.wad`, 28,795,076 bytes, SHA-256
`7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d`), unchanged in content and split the same way.
It was taken from the project's release archive `freedoom-0.13.0.zip` (SHA-256
`3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59`,
https://github.com/freedoom/freedoom/releases/tag/v0.13.0) by `tools/bundle-wads.mjs freedoom`, which verifies the
archive before splitting. Freedoom is (c) 2001-2024 Contributors to the Freedoom project, under the 3-clause BSD
license kept beside the parts as `wads/freedoom1/COPYING.txt`. https://freedoom.github.io/

## id Software's commercial game data

Nothing of the registered games is shipped. `doom.wad`, `doom2.wad` and Final DOOM are the player's own copies,
split the same way under the `wadDir` folder (README: "Your own IWAD").

## Trademarks

DOOM is a trademark of id Software LLC, a ZeniMax Media company. Claude is a trademark of Anthropic, PBC. This
plugin is not affiliated with or endorsed by id Software, ZeniMax, Anthropic or the Freedoom project. None of this
is legal advice.
