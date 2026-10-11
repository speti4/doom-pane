# doom-pane

The original DOOM as a Claude Code mod: one plugin, which is also its own marketplace (`.claude-plugin/marketplace.json`
lists `./`; GitHub `speti4/doom-pane`). It grew up in the author's `claude-games` repository, whose marketplace still
lists it by pointing here. The engine is doomgeneric compiled to plain JavaScript and run inside the hooks module; the
game data (id's shareware episode, Freedoom) ships in `wads/`.

## Rules
- Pure API only: `$.ui`, `$.store`, `$.state`, `$.clock`, `$.fs` for reading (`list`, `stat`, `read`; no
  `$.fs.write`), `$.plugin.root`. No `$.process`, no `$.http`, no `$.model`, no `$.env` beyond string-literal reads.
  The plugin must run unchanged on any machine that adds the marketplace.
- Nothing to install: the plugin ships everything it needs (engine, data) and reads it from `$.plugin.root`; the
  person runs no script, downloads nothing, needs no Node, compiler or sidecar. Data over 4 MiB travels in 2 MiB
  parts (`$.fs.read` rejects a bigger file). Third-party data carries its licence file beside it and an entry in
  `THIRD-PARTY.md`; the whole plugin is GPL-2.0 because of the engine.
- Windows-aware: no `$.audio` (silent on Windows), no emoji or ambiguous-width glyphs in a cell grid beyond the half
  block the Raster is made of.
- Every registration gets a `.catch`. Hooks on events pass through (`return next(e)`); the `command.run` hook that
  answers `/doom` answers `{ text }` with the failure; the Pane `ui.render` hook returns a one-line fallback tree,
  never `next(e)`, because a pane whose render answers nothing is closed. Three untraceable crashes unload all
  non-built-in mods.
- Game logic and drawing are pure modules (`hooks/cells.ts`, `view.ts`, `keys.ts`, `wad.ts`, `engine/driver.ts`:
  no `$`, time as an argument), so `claude plugin test` covers them; `hooks/register.tsx` holds the glue only.
- A pane opens from the person's command or press, never from a timer. State a drawing reads lives in `$.state`
  atoms (declared in `types/index.d.ts`); a render hook never writes. Timers die on a hot reload and a `/clear` ends
  the session's timers while keeping the module: `ensureTimers` restarts them from the next render, idempotently.
- The generated engine (`hooks/engine/doomgeneric.js`) is never edited by hand: `tools/build-engine.sh` (Docker)
  rebuilds it, `tools/postprocess.mjs` shapes it. The WAD parts come from `tools/bundle-wads.mjs` only.
- Code, comments, docs and UI strings in English; file, folder and command names in kebab-case.
- Keep changes minimal and reversible; bump `version` in `plugin.json` and `marketplace.json` on every published
  change (the installed copy is keyed by it).

## Workflow
- New work → `tasks/wip/<name>.md` before implementation (Hungarian prose is fine, structure in English); finished →
  `tasks/done/`. The `tasks/` folder is local and gitignored: the author's notebook, not part of the repository.
- Before a commit: `claude plugin validate .` (marketplace and plugin), `npx -p typescript tsc -p .`,
  `claude plugin test .`, `node tools/check-bundle.mjs` (and `wads/freedoom1`).
- Trial in a separate session: `claude --debug --plugin-dir <this folder>`. The folder is a protected path while
  loaded, so edit from another session. `.claude-plugin/types/` is generated on load and gitignored.
- Manual tests one step at a time, reading the debug log between steps (`ui.render (Pane) refused`, `blit … deny`,
  `High write ratio`).
- Related: the author's `claude-games` (the other games, same rules) and `claude-setup` (the API reference) repositories.
