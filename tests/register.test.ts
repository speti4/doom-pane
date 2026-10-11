import type { FsEntry, On, UiPane } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { base64Of, tinyManifest, tinyParts } from './fixtures'

const T0 = 1_760_000_000_000
const PANE = 'doom'
const WAD_ROOT = 'C:/Users/test/.claude/doom-wads'
/** Stands for `${$.plugin.root}/wads`, whatever root the kit gives: the world matches on the suffix. */
const BUNDLED = '<plugin>/wads'

const PANE_PROPS = {
  title: 'DOOM',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const file = (name: string): FsEntry => ({ name, kind: 'file', size: 0, mtimeMs: 0, isLink: false })
const dir = (name: string): FsEntry => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })

// The world beneath the mod: a clock, a store over a Map, two WAD roots in
// memory (empty unless the test fills one), the pane list and the log.
function world(on: On, options: { own?: boolean; bundled?: boolean } = {}) {
  const files = new Map<string, string | { base64: string }>()
  const dirs = new Map<string, FsEntry[]>()
  const manifest = tinyManifest()
  const parts = tinyParts()
  if (options.own) {
    // the person's folder, as bundle-freedoom would write it: manifest and parts
    dirs.set(WAD_ROOT, [dir('tiny')])
    dirs.set(`${WAD_ROOT}/tiny`, [file('manifest.json'), ...manifest.parts.map(part => file(part.file))])
    files.set(`${WAD_ROOT}/tiny/manifest.json`, JSON.stringify(manifest))
    parts.forEach((part, i) => files.set(`${WAD_ROOT}/tiny/${manifest.parts[i]!.file}`, { base64: base64Of(part) }))
  }
  if (options.bundled) {
    // the plugin's folder, split with the OS's tools: parts and a licence, no manifest
    dirs.set(BUNDLED, [dir('tiny')])
    dirs.set(`${BUNDLED}/tiny`, [file('COPYING.txt'), file('xab'), file('xaa')])
    files.set(`${BUNDLED}/tiny/COPYING.txt`, 'BSD')
    files.set(`${BUNDLED}/tiny/xaa`, { base64: base64Of(parts[0]!) })
    files.set(`${BUNDLED}/tiny/xab`, { base64: base64Of(parts[1]!) })
  }
  const state = {
    store: new Map<string, unknown>(),
    logs: [] as string[],
    opened: [] as Record<string, unknown>[],
    closed: 0,
    blits: 0,
    panes: [] as UiPane[],
    listed: [] as string[],
  }
  const clock = mock.clock(on, { now: T0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: 'C:/Users/test' }))
  // the engine hands the path on with the platform's separators; the plugin's root is whatever the kit says
  const key = (path: string | undefined): string => {
    const slashed = (path ?? '').split('\\').join('/')
    const at = slashed.indexOf('/wads')
    return at >= 0 && !slashed.startsWith(WAD_ROOT) ? `${BUNDLED}${slashed.slice(at + '/wads'.length)}` : slashed
  }
  on('fs.list', ($, e) => {
    state.listed.push(key(e.path))
    const entries = dirs.get(key(e.path))
    if (entries === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: entries }
  })
  on('fs.read', ($, e) => {
    const content = files.get(key(e.path))
    if (content === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: content }
  })
  on('store.get', ($, e) => ({ value: state.store.get(e.key) }))
  on('store.set', ($, e) => {
    state.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    state.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', ($, e) => {
    state.opened.push({ ...e })
    state.panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: e.focus === true, isPlaced: true }]
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => {
    state.closed++
    state.panes = []
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: state.panes }))
  on('ui.blit', () => {
    state.blits++
    return { value: {} }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  return { state, clock }
}

const start = ($: Engine) => $.session.start({ cwd: 'E:/work', surface: 'terminal', isInteractive: true })

const run = ($: Engine, args: string) =>
  $.command.run({ command: 'doom', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

describe('register', () => {
  test('/doom with no IWAD anywhere opens the pane with the hint and looks under the plugin first', async ($, on) => {
    const { state } = world(on)
    await start($)
    const answer = await run($, '')
    expect(answer.text).toContain('no IWAD found')
    expect(answer.text).toContain('Your own IWAD')
    expect(state.listed[0]).toBe(BUNDLED)
    expect(state.listed[1]).toBe(WAD_ROOT)
    expect(state.opened).toHaveLength(1)
    expect(state.opened[0]?.focus).toBeUndefined()
    const ui = await $.ui.mount({ plugin: 'doom-pane', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /No IWAD found/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Raster' })).toHaveLength(0)
    await ui.unmount()
    const wads = await run($, 'wads')
    expect(wads.text).toContain('No IWAD found')
  })

  test('/doom help lists the keys without touching the WAD folders', async ($, on) => {
    const { state } = world(on)
    await start($)
    const help = await run($, 'help')
    expect(help.text).toContain('w s forward/back')
    expect(state.opened).toHaveLength(0)
    expect(state.listed).toHaveLength(0)
  })

  test('an own WAD with a manifest is read in parts; a bad IWAD reports the engine exit and the pane says so', async ($, on) => {
    const { state } = world(on, { own: true })
    await start($)
    const wads = await run($, 'wads')
    expect(wads.text).toContain('tiny.wad')
    expect(wads.text).toContain(`in ${WAD_ROOT}/tiny`)
    const answer = await run($, '')
    expect(answer.text).toContain('did not start')
    expect(answer.text).toContain('exited with status')
    expect(state.logs.some(line => line.includes('engine:'))).toBe(true)
    const ui = await $.ui.mount({ plugin: 'doom-pane', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /DOOM stopped/ })).toBeDefined()
    // the legend's hotkeys are in the tree whatever the state, so a press lands once a game runs
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.props.hotkey).slice(0, 4)).toEqual(['w', 's', 'a', 'd'])
    expect(await ui.findAll({ type: 'Raster' })).toHaveLength(1)
    await ui.press({ key: 'key-w' })
    await ui.unmount()
  })

  test('a bundled WAD without a manifest is listed first, played by name, and an unknown name is refused', async ($, on) => {
    const { state } = world(on, { own: true, bundled: true })
    await start($)
    const wads = await run($, 'wads')
    const lines = wads.text?.split('\n') ?? []
    expect(lines[0]).toContain('ships with the plugin')
    expect(lines[0]).toContain('2 parts')
    expect(lines[1]).toContain(`in ${WAD_ROOT}/tiny`)
    const missing = await run($, 'nope')
    expect(missing.text).toContain('no IWAD named nope')
    expect(state.opened).toHaveLength(0)
    const answer = await run($, 'tiny')
    expect(answer.text).toContain('exited with status')
  })

  test('a wide pane gets a large Raster, well past 100k characters of cells', async ($, on) => {
    world(on)
    await start($)
    const props = { ...PANE_PROPS, bodyColumns: 240, scroll: { offset: 0, bodyRows: 100 } }
    const ui = await $.ui.mount({ plugin: 'doom-pane', surface: 'terminal', component: 'Pane', requestId: PANE, props })
    const rasters = await ui.findAll({ type: 'Raster' })
    expect(rasters).toHaveLength(1)
    expect(rasters[0]?.props).toMatchObject({ columns: 240, rows: 90 })
    expect((rasters[0]?.props as { cells: string }).cells.length).toBe(240 * 90 * 16)
    await ui.unmount()
  })

  test('a surface without a Raster gets one line', async ($, on) => {
    world(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'doom-pane', surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /terminal only/ })).toBeDefined()
    await ui.unmount()
  })

  test('with no game the tick never blits and a close is quiet', async ($, on) => {
    const { state, clock } = world(on)
    await start($)
    await run($, '')
    await clock.advance(1000)
    expect(state.blits).toBe(0)
    await run($, '')
    expect(state.closed).toBe(1)
  })
})
