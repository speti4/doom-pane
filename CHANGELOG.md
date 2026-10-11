# Changelog

## 0.1.0 (2026-10-11)

The first release: the original DOOM in a Claude Code pane with nothing to install.

- id's engine by way of doomgeneric (GPL-2, commit `dcb7a8d`), compiled with Emscripten 6.0.12 to plain JavaScript
  (`-sWASM=0`, 713 KB) and run inside the hooks module. `/doom` loads the game and opens the pane; `/doom new`,
  `/doom wads`, `/doom <name>`, `/doom help`, `/doom bench`.
- Nothing to install: id's shareware episode (`wads/doom1/`, the default) and Freedoom Phase 1 0.13.0
  (`wads/freedoom1/`) ship with the plugin in 2 MiB parts, each with its licence text beside it, written and
  verified by `tools/bundle-wads.mjs`, and are read from `$.plugin.root`. An IWAD of your own goes split into
  2 MiB parts under `wadDir` (`~/.claude/doom-wads/<name>/`), with the shell alone: a folder of parts needs no
  manifest, the parts are joined in natural name order and the folder's name is the IWAD's.
- The picture is a `Raster` of half-block cells (two pixels per cell, truecolor) from the engine's 320×200 frame;
  the view keeps 4:3 and fills the pane's width (the dock opens 160 columns wide), the `maxCells` option caps it.
  Frames are paced: at most `maxFps` (20) a second within a budget of 100k cells a second, an unchanged frame is
  not sent, and a slow blit halves the rate down to 5 fps.
- Keys are the pane's hotkeys (`w a s d q e f u m r b t p y n 1-7`) with a simulated hold (550 ms, then 120 ms
  per repeat); running is always on; Esc pauses by handing the keys back. Time is virtual, one tic per tick.
- Saves from DOOM's menu go to the plugin store and come back on the next start; the game survives `/clear`.
- Licensing: the generated engine carries a header naming its source and licence, its dead network loaders are
  stubbed and gated, `LICENSE` is the GPL-2 text and `COPYRIGHT` the copyright lines with what the GPL does not
  cover, `THIRD-PARTY.md` covers doomgeneric, Emscripten, the
  shareware episode, Freedoom and the trademarks.
- Tested in Windows Terminal and on macOS.
