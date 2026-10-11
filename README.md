# doom-pane

The original DOOM in a Claude Code pane. The engine is id Software's, by way of
[doomgeneric](https://github.com/ozkl/doomgeneric), compiled to plain JavaScript and run inside the mod's hooks
module; the picture is a `Raster` of half-block cells (one terminal cell holds two pixels, truecolor) repainted
with `$.ui.blit` at 35 frames a second; the keys are the pane's hotkeys. Bring your own IWAD, or let the prepare
script fetch the shareware episode.

`/doom` loads the game and opens the pane with the keyboard. `w` `s` move, `a` `d` turn, `q` `e` strafe, `f`
fires, `u` uses (doors, switches), `m` opens the menu, `r` is Enter, `b` is Backspace, `t` toggles the automap,
`p` pauses, `y` `n` answer the menu, `1`-`7` pick a weapon. Running is always on (the terminal has no Shift
hotkey). Esc hands the keys back to the prompt and pauses the game; a click on the pane (or ctrl+x, then Tab)
resumes it. `/doom` again closes the pane and keeps the game; `/doom new` restarts it; `/doom wads` lists the
prepared IWADs and `/doom <name>` plays one; `/doom help` prints the keys. Saving from DOOM's menu puts the slot
in the plugin store, and the next start mounts it back, so the load menu works across sessions.

A terminal cannot report a key release, so a held key is simulated: the first press keeps the key down for 550 ms
(past the OS repeat delay), each repeat extends it by 120 ms. The view is 4:3 and fills the pane's width (a
160-column dock gives 160×60 cells, 160×120 pixels), sampled nearest-neighbour from the engine's 320×200 frame, so
a smaller terminal font and a wider dock (drag its edge) mean a sharper picture. The `maxCells` option caps it. No
sound.

Written against Claude Code 2.1.296; the mods API may change between releases.

## Install

```
/plugin install doom-pane --marketplace speti4/claude-games
```

(the repository is private, git has to be able to clone it.)

## Prepare a WAD (once, outside Claude Code)

The mod reads files through `$.fs.read`, which rejects a file over 4 MiB, and the shareware `doom1.wad` is
4,196,020 bytes, so an IWAD is split into 2 MiB parts with a manifest beside them:

```powershell
node "$env:USERPROFILE\.claude\plugins\cache\claude-games\doom-pane\tools\prepare-wad.mjs" --shareware
node <doom-pane>\tools\prepare-wad.mjs C:\Games\DOOM\doom2.wad
```

`--shareware` downloads `doom19s.zip` from the idgames archive (2.4 MB), unpacks `DOOM1.WAD` and checks its size
and MD5. The parts go to `~/.claude/doom-wads/<name>/` (the `wadDir` option names another folder). Then `/doom`.

## Options (`/config`, then `/reload-plugins`)

| Option | Default | Meaning |
|---|---|---|
| `wadDir` | `~/.claude/doom-wads` | the folder holding one sub-folder per prepared IWAD |
| `alwaysRun` | on | hold DOOM's run key for you |
| `maxCells` | empty | cap the picture at this many cells (columns × rows); empty: whatever the pane holds, up to 512×256 |

## Rebuild the engine (developers)

`hooks/engine/doomgeneric.js` is committed; rebuilding needs Docker and Node:

```bash
tools/build-engine.sh           # clones doomgeneric at the pinned commit, patches, emcc in emscripten/emsdk:6.0.12, post-processes
tools/build-engine.sh --debug   # -O1 with assertions
```

See `THIRD-PARTY.md` for what is compiled in and how.

## Layout

```
hooks/register.tsx          the hooks: /doom, the pane, the 35 Hz tick, the hotkeys, the saves
hooks/pane.tsx              the pane's tree: Raster, status line, legend of hotkey Buttons
hooks/cells.ts              pure: a 0x00RRGGBB frame → half-block Raster cells, base64
hooks/view.ts               pure: the 4:3 view that fits the pane and the cell cap
hooks/keys.ts               pure: the bindings, DOOM key codes, the hold synthesizer
hooks/wad.ts                pure: manifest, parts, IWAD header
hooks/engine/driver.ts      one running game over the engine module: create, tick, keys, frame, exit
hooks/engine/doomgeneric.js the engine (generated, GPL-2) and its hand-written .d.ts
tools/                      prepare-wad.mjs, build-engine.sh, postprocess.mjs, dg-platform.c, dg-library.js, patches/
types/index.d.ts            the $.state contract (status)
tests/                      claude plugin test: the pure modules, the engine's load and exit, the command and the pane
```

Pure API: `$.ui`, `$.store`, `$.state`, `$.clock`, `$.fs` reads, `$.env` reads of HOME and USERPROFILE. No sound, no
network, no processes.
