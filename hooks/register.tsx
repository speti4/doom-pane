import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, Timer } from 'claude-code'

import type { Status } from '../types'
import { blankCells, encodeFrame } from './cells'
import createDoom from './engine/doomgeneric.js'
import { createGame, type Game } from './engine/driver'
import { KEYS, lapse, noHolds, press, releaseAll, type Binding, type Holds } from './keys'
import { CHROME_ROWS, drawElsewhere, drawPane, RASTER_KEY } from './pane'
import { MIN_FPS, sameSize, ticsPerFrame, TICS_PER_SECOND, viewSize, type ViewSize } from './view'
import { assembleWad, describeWad, fromBase64, planWad, type WadPlan } from './wad'

const PANE = 'doom'
const TICK_MS = 28
const PANE_CHECK_TICKS = 70
const DENIES_BEFORE_REDRAW = 3
const DENIES_BEFORE_STOP = 40
/** The IWAD the plugin ships, played when nothing else is asked for or remembered. */
const BUNDLED_WAD = 'freedoom1.wad'
const OWN_WAD_HINT = 'an IWAD of your own goes split into 2 MiB parts under <wadDir>/<name>/ (README: "Your own IWAD")'

const statusAtom = atom({ plugin: 'doom-pane', key: 'status' } as const, { kind: 'idle' } as Status)

type Dollar = EngineInterface
type Ui = Pick<EngineInterface, 'ui'>
type Options = { wadDir: string; alwaysRun: boolean; maxCells: number | undefined; maxFps: number }
const DEFAULT_MAX_FPS = 20
type WadEntry = { dir: string; plan: WadPlan; source: 'bundled' | 'own' }

// Module state: the running engine, its timer, the key holds and the view the
// pane last drew. A hot reload drops it all; the status line then says so.
let opts: Options = { wadDir: '', alwaysRun: true, maxCells: undefined, maxFps: DEFAULT_MAX_FPS }
let game: Game | undefined
let tickTimer: Timer | undefined
/** When the tick last ran: a timer that stops firing (a /clear ends the session's timers, not this module) is dead. */
let lastTickAt = 0
const TICK_STALE_MS = 1000
let isTicking = false
let holds: Holds = noHolds
let view: ViewSize | undefined
let isFocused = false
let denies = 0
let tickCount = 0
// Frame pacing: a frame goes out every `blitEvery` tics at most, and only when
// the engine drew since the last one and the cells differ from the last sent.
// `baseBlitEvery` is the view's budget; a blit that takes long to be taken (the
// main thread stuck writing to the console) doubles the interval, a run of
// quick ones brings it back down one step at a time.
let baseBlitEvery = 2
let blitEvery = 2
let quickBlits = 0
let hasNewFrame = false
let lastCells = ''
const QUICK_BLITS_TO_SPEED_UP = 60
const SLOWEST_BLIT_EVERY = Math.ceil(TICS_PER_SECOND / MIN_FPS)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The failure note; in a `.catch` handler `$` itself may reject (a re-entry), so the log is best effort.
function logFailure($: Ui, event: string, message: string | undefined): void {
  try {
    $.ui.log(`${event} hook failed: ${message ?? 'no message'}`, { to: 'debug' })
  } catch {
    // nothing to do: the handler passes the call through regardless
  }
}

function debug($: Ui, text: string): void {
  try {
    $.ui.log(text, { to: 'debug' })
  } catch {
    // best effort
  }
}

async function setStatus($: Dollar, status: Status): Promise<void> {
  await update($, statusAtom, () => status)
}

/** The person's own IWADs: the `wadDir` option, else `~/.claude/doom-wads`. */
async function ownWadRoot($: Dollar): Promise<string> {
  if (opts.wadDir !== '') return opts.wadDir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  // forward slashes throughout: Windows takes them, and the paths shown to the person stay uniform
  return `${home.split('\\').join('/')}/.claude/doom-wads`
}

/** The IWADs the plugin ships, under its own folder. */
function bundledWadRoot($: Dollar): string | undefined {
  try {
    const root = $.plugin.root
    return typeof root === 'string' && root !== '' ? `${root}/wads` : undefined
  } catch {
    return undefined
  }
}

/** The WAD folders under one root, each a folder of parts with or without a manifest. */
async function listWadsUnder($: Dollar, root: string, source: WadEntry['source']): Promise<WadEntry[]> {
  const wads: WadEntry[] = []
  let entries: Awaited<ReturnType<typeof $.fs.list>> = []
  try {
    entries = await $.fs.list(root)
  } catch (error) {
    debug($, `wad folder ${root} not readable: ${messageOf(error)}`)
    return wads
  }
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const dir = `${root}/${entry.name}`
    try {
      const files = (await $.fs.list(dir)).filter(file => file.kind === 'file').map(file => file.name)
      const manifestText = files.includes('manifest.json') ? await $.fs.read(`${dir}/manifest.json`) : undefined
      wads.push({ dir, plan: planWad(entry.name, files, manifestText), source })
    } catch (error) {
      debug($, `${dir}: ${messageOf(error)}`)
    }
  }
  return wads
}

/** Every playable IWAD: the bundled ones first, then the person's own. */
async function listWads($: Dollar): Promise<{ ownRoot: string; wads: WadEntry[] }> {
  const ownRoot = await ownWadRoot($)
  const bundledRoot = bundledWadRoot($)
  const bundled = bundledRoot === undefined ? [] : await listWadsUnder($, bundledRoot, 'bundled')
  const own = await listWadsUnder($, ownRoot, 'own')
  return { ownRoot, wads: [...bundled, ...own] }
}

async function readWad($: Dollar, entry: WadEntry): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for (const file of entry.plan.files) {
    const { base64 } = await $.fs.read(`${entry.dir}/${file}`, { as: 'bytes' })
    parts.push(fromBase64(base64))
  }
  return assembleWad(entry.plan, parts)
}

async function readSaves($: Dollar, wad: string): Promise<Record<string, Uint8Array>> {
  const saves: Record<string, Uint8Array> = {}
  try {
    const stored = await $.store.get(`saves:${wad}`)
    if (typeof stored === 'object' && stored !== null) {
      for (const [file, base64] of Object.entries(stored as Record<string, unknown>)) {
        if (typeof base64 === 'string' && /^doomsav\d\.dsg$/.test(file)) saves[file] = fromBase64(base64)
      }
    }
  } catch (error) {
    debug($, `saves for ${wad} not read: ${messageOf(error)}`)
  }
  return saves
}

async function writeSave($: Dollar, wad: string, file: string, bytes: Uint8Array): Promise<void> {
  try {
    const key = `saves:${wad}`
    const stored = await $.store.get(key)
    const saves: Record<string, string> = typeof stored === 'object' && stored !== null ? { ...(stored as Record<string, string>) } : {}
    saves[file] = new Uint8Array(bytes).toBase64()
    await $.store.set(key, saves)
    $.ui.toast(`DOOM saved (${file})`)
  } catch (error) {
    debug($, `save ${file} not stored: ${messageOf(error)}`)
  }
}

function stopTicks(): void {
  tickTimer?.cancel()
  tickTimer = undefined
}

function dropGame(): void {
  stopTicks()
  game = undefined
  holds = noHolds
  denies = 0
}

const findWad = (wads: readonly WadEntry[], name: string): WadEntry | undefined => {
  const lower = name.toLowerCase()
  return wads.find(w => w.plan.name === lower || w.plan.name === `${lower}.wad`)
}

/** Loads `name` (or the last played, or the bundled Freedoom) and starts the engine. */
async function loadGame($: Dollar, name?: string): Promise<{ text: string }> {
  const { ownRoot, wads } = await listWads($)
  if (wads.length === 0) {
    await setStatus($, { kind: 'no-wad', dir: ownRoot })
    return { text: `doom-pane: no IWAD found. The plugin's own wads folder is missing (reinstall it), and ${ownRoot} holds none: ${OWN_WAD_HINT}.` }
  }
  let entry: WadEntry | undefined
  if (name !== undefined) {
    entry = findWad(wads, name)
    if (entry === undefined) return { text: `doom-pane: no IWAD named ${name}. /doom wads lists them; ${OWN_WAD_HINT}.` }
  } else {
    const last = await $.store.get('lastWad').catch(() => undefined)
    entry = (typeof last === 'string' ? findWad(wads, last) : undefined) ?? findWad(wads, BUNDLED_WAD) ?? wads[0]
  }
  if (entry === undefined) return { text: 'doom-pane: no WAD to load.' }
  const wad = entry.plan.name
  dropGame()
  await setStatus($, { kind: 'loading', wad })
  const started = performance.now()
  try {
    const bytes = await readWad($, entry)
    const read = performance.now()
    const saves = await readSaves($, wad)
    game = await createGame(createDoom, wad, bytes, saves, {
      log: line => debug($, `engine: ${line}`),
      onSave: (file, saved) => void writeSave($, wad, file, saved),
    })
    debug($, `${wad}: read ${Math.round(read - started)} ms, engine up ${Math.round(performance.now() - read)} ms`)
  } catch (error) {
    dropGame()
    await setStatus($, { kind: 'error', message: messageOf(error) })
    return { text: `doom-pane: ${wad} did not start: ${messageOf(error)}` }
  }
  if (opts.alwaysRun) game.pushKey({ pressed: true, key: KEYS.RSHIFT })
  await setStatus($, { kind: 'running', wad })
  await $.store.set('lastWad', wad).catch(() => undefined)
  return { text: `${describeWad(wad)} loaded.` }
}

async function isPaneShown($: Dollar): Promise<boolean> {
  const panes = await $.ui.panes()
  return panes.some(pane => pane.id === PANE && pane.isShown)
}

function startTicks($: Dollar): void {
  if (tickTimer !== undefined) return
  tickCount = 0
  lastTickAt = performance.now()
  tickTimer = $.clock.every(TICK_MS, () => void onTick($))
}

/**
 * Idempotent: the tick runs while a game exists and the pane is shown. A hot
 * reload drops the timer with the module state; a /clear keeps the module but
 * ends the session's timers, so a timer that went quiet is started again.
 */
async function ensureTimers($: Dollar): Promise<void> {
  if (game === undefined) return
  if (tickTimer !== undefined) {
    if (performance.now() - lastTickAt < TICK_STALE_MS) return
    debug($, 'the tick timer went quiet (a /clear ends the session timers); starting it again')
    tickTimer = undefined
  }
  if (await isPaneShown($)) startTicks($)
}

async function blitFrame($: Dollar, current: Game, size: ViewSize): Promise<void> {
  const cells = encodeFrame({ width: current.width, height: current.height, pixels: current.frame() }, size.columns, size.rows)
  if (cells === lastCells) return
  const started = performance.now()
  const result = await $.ui.blit({ requestId: PANE, key: RASTER_KEY, cells, columns: size.columns, rows: size.rows })
  lastCells = cells
  const took = performance.now() - started
  const interval = blitEvery * TICK_MS
  if (took > interval * 1.5) {
    quickBlits = 0
    const slower = Math.min(blitEvery * 2, SLOWEST_BLIT_EVERY)
    if (slower !== blitEvery) {
      blitEvery = slower
      debug($, `a blit took ${Math.round(took)} ms: a frame every ${blitEvery} tics now (${Math.round(TICS_PER_SECOND / blitEvery)} fps)`)
    }
  } else if (took < interval * 0.5 && blitEvery > baseBlitEvery && ++quickBlits >= QUICK_BLITS_TO_SPEED_UP) {
    quickBlits = 0
    blitEvery--
    debug($, `blits are quick: a frame every ${blitEvery} tics (${Math.round(TICS_PER_SECOND / blitEvery)} fps)`)
  }
  if (result.deny === undefined) {
    denies = 0
    return
  }
  denies++
  if (denies === DENIES_BEFORE_REDRAW) {
    debug($, `blit denied ${denies}x (${result.deny}); asking for a redraw`)
    $.ui.invalidate('ui.render')
  } else if (denies >= DENIES_BEFORE_STOP) {
    debug($, `blit denied ${denies}x (${result.deny}); the tick stops`)
    stopTicks()
  }
}

async function onTick($: Dollar): Promise<void> {
  lastTickAt = performance.now()
  if (isTicking) return
  isTicking = true
  try {
    const current = game
    if (current === undefined) return stopTicks()
    tickCount++
    if (tickCount % PANE_CHECK_TICKS === 0 && !(await isPaneShown($))) return stopTicks()
    if (!isFocused) return
    const now = performance.now()
    const lapsed = lapse(holds, now)
    holds = lapsed.holds
    for (const event of lapsed.events) current.pushKey(event)
    const isDirty = current.tick()
    const stopped = current.stopped()
    if (stopped !== undefined) {
      stopTicks()
      await setStatus($, stopped.reason === 'quit' ? { kind: 'quit', wad: current.wadName } : { kind: 'error', message: stopped.message })
      return
    }
    hasNewFrame ||= isDirty
    if (hasNewFrame && view !== undefined && tickCount % blitEvery === 0) {
      hasNewFrame = false
      await blitFrame($, current, view)
    }
  } catch (error) {
    debug($, `tick failed: ${messageOf(error)}`)
  } finally {
    isTicking = false
  }
}

function pressHotkey(binding: Binding): void {
  const current = game
  if (current === undefined) return
  const pressed = press(holds, binding, performance.now())
  holds = pressed.holds
  for (const event of pressed.events) current.pushKey(event)
}

/** The pane lost or got the keys: release every held key when it goes. */
function setFocused(focused: boolean): void {
  if (isFocused === focused) return
  isFocused = focused
  if (focused) return
  const released = releaseAll(holds)
  holds = released.holds
  for (const event of released.events) game?.pushKey(event)
}

async function openPane($: Dollar): Promise<{ text: string }> {
  const opened = await $.ui.open({ id: PANE, title: 'DOOM', focus: true, columns: 160, rows: 50 })
  if (!opened.isPlaced) {
    return { text: `doom-pane: the pane waits undrawn (${opened.reason}). Widen the terminal or run /doom again.` }
  }
  startTicks($)
  return { text: 'DOOM pane opened. w a s d move, q e strafe, f fires, u uses, m opens the menu (r selects). Esc hands the keys back; click the pane to play again.' }
}

/** Runs the engine for a while and reports the cost; `/doom bench`. */
async function bench($: Dollar): Promise<{ text: string }> {
  if (game === undefined) {
    const loaded = await loadGame($)
    if (game === undefined) return loaded
  }
  const current = game
  const size = view ?? { columns: 120, rows: 45 }
  const ticks = 350
  const started = performance.now()
  let frames = 0
  for (let i = 0; i < ticks; i++) if (current.tick()) frames++
  const ticked = performance.now()
  let encoded = ''
  for (let i = 0; i < 35; i++) encoded = encodeFrame({ width: current.width, height: current.height, pixels: current.frame() }, size.columns, size.rows)
  const done = performance.now()
  const text =
    `doom-pane bench: ${ticks} ticks in ${Math.round(ticked - started)} ms (${((ticked - started) / ticks).toFixed(2)} ms/tick, ${frames} frames), ` +
    `encode ${size.columns}x${size.rows} ${((done - ticked) / 35).toFixed(2)} ms/frame (${encoded.length} chars), title "${current.title()}"`
  debug($, text)
  return { text }
}

export function register(on: On, options: PluginOptions): void {
  const maxCells = Number.parseInt(typeof options.maxCells === 'string' ? options.maxCells : '', 10)
  const maxFps = Number.parseInt(typeof options.maxFps === 'string' ? options.maxFps : '', 10)
  opts = {
    wadDir: typeof options.wadDir === 'string' ? options.wadDir.trim() : '',
    alwaysRun: options.alwaysRun !== false,
    maxCells: Number.isFinite(maxCells) && maxCells > 0 ? maxCells : undefined,
    maxFps: Number.isFinite(maxFps) && maxFps > 0 ? maxFps : DEFAULT_MAX_FPS,
  }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      await $.command.register({
        name: 'doom',
        description: 'Open or close the DOOM pane; new restarts the game, wads lists the prepared IWADs, <name> plays one, help lists the keys',
        argumentHint: '[new|wads|help|<wad>]',
      })
    } catch (error) {
      debug($, `/doom not registered: ${messageOf(error)}`)
    }
    return r
  }).catch(($, e, next) => {
    logFailure($, 'session.start', next.error.message)
    return next(e)
  })

  on('command.run', { command: 'doom' }, async ($, e) => {
    const [verb = ''] = e.args.trim().split(/\s+/)
    switch (verb) {
      case '': {
        if (await isPaneShown($)) {
          await $.ui.close({ id: PANE })
          return { text: 'DOOM pane closed; the game keeps its state. /doom opens it again.' }
        }
        if (game === undefined) {
          const loaded = await loadGame($)
          if (game === undefined) {
            if (!(await isPaneShown($))) await $.ui.open({ id: PANE, title: 'DOOM' })
            return loaded
          }
        }
        return openPane($)
      }
      case 'new': {
        const loaded = await loadGame($, game?.wadName)
        if (game === undefined) return loaded
        const opened = await openPane($)
        return { text: `${loaded.text} ${opened.text}` }
      }
      case 'wads': {
        const { ownRoot, wads } = await listWads($)
        if (wads.length === 0) return { text: `No IWAD found: the plugin's wads folder is missing and ${ownRoot} holds none; ${OWN_WAD_HINT}.` }
        const lines = wads.map(w => `${w.plan.name}: ${describeWad(w.plan.name)} (${w.plan.files.length} parts, ${w.source === 'bundled' ? 'ships with the plugin' : `in ${w.dir}`})`)
        return { text: `${lines.join('\n')}\n/doom <name> plays one; ${OWN_WAD_HINT}.` }
      }
      case 'help':
        return {
          text:
            'DOOM keys (the pane must hold the keyboard: /doom focuses it, Esc hands it back, a click gives it back):\n' +
            'w s forward/back, a d turn, q e strafe, f fire, u use (doors, switches), m menu, r enter, b back, t map, p pause, y n yes/no, 1-7 weapons.\n' +
            'Running is always on. Saves go to the plugin store. /doom new restarts, /doom wads lists the IWADs (Freedoom ships with the plugin), /doom <name> plays one.',
        }
      case 'bench':
        return bench($)
      default: {
        const loaded = await loadGame($, verb)
        if (game === undefined) return loaded
        const opened = await openPane($)
        return { text: `${loaded.text} ${opened.text}` }
      }
    }
  }).catch(($, e, next) => {
    logFailure($, 'command.run', next.error.message)
    return { text: `doom-pane: /doom failed (${next.error.message ?? 'no message'})` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const stored = await read($, statusAtom)
    // a /clear resets the state atoms but keeps this module and its game: the game is what the person sees
    const status: Status = stored.kind === 'idle' && game !== undefined ? { kind: 'running', wad: game.wadName } : stored
    if (e.surface !== 'terminal') return drawElsewhere($.ui.resolve(e))
    // a hot reload drops the timers and re-runs this hook for the open pane: bring the tick back
    void ensureTimers($)
    const size = viewSize({ bodyColumns: e.props.bodyColumns, bodyRows: e.props.scroll.bodyRows, legendRows: CHROME_ROWS, maxCells: opts.maxCells })
    if (!sameSize(size, view)) {
      view = size
      denies = 0
      lastCells = ''
      baseBlitEvery = ticsPerFrame(size.columns * size.rows, opts.maxFps)
      blitEvery = baseBlitEvery
      quickBlits = 0
      debug($, `view ${size.columns}x${size.rows}: a frame every ${blitEvery} tics (${Math.round(TICS_PER_SECOND / blitEvery)} fps)`)
    }
    setFocused(e.props.isFocused)
    const current = game
    const cells =
      current === undefined ? blankCells(size.columns, size.rows) : encodeFrame({ width: current.width, height: current.height, pixels: current.frame() }, size.columns, size.rows)
    const title = current?.title() ?? ''
    const onHotkey = (binding: Binding) => pressHotkey(binding)
    return drawPane($.ui.resolve(e), { status, view: size, cells, isFocused: e.props.isFocused, title, ownWadHint: OWN_WAD_HINT }, onHotkey)
  }).catch(($, e, next) => {
    logFailure($, 'ui.render', next.error.message)
    try {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>doom-pane: the pane could not be drawn; run /doom again.</Text>
    } catch {
      return next(e)
    }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopTicks()
    setFocused(false)
    return next(e)
  }).catch(($, e, next) => {
    logFailure($, 'ui.close', next.error.message)
    return next(e)
  })

  // A /clear ends the session (reason 'clear') with its timers and state atoms,
  // but keeps this module and its game; the next render of the pane brings the
  // tick back through ensureTimers, so the timer is let go of here.
  on('session.end', async ($, e, next) => {
    stopTicks()
    return next(e)
  }).catch(($, e, next) => {
    logFailure($, 'session.end', next.error.message)
    return next(e)
  })
}
