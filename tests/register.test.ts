import type { FsEntry, On, UiPane } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { base64Of, tinyManifest, tinyParts } from './fixtures'

const T0 = 1_760_000_000_000
const PANE = 'doom'
const WAD_ROOT = 'C:/Users/test/.claude/doom-wads'

const PANE_PROPS = {
  title: 'DOOM',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

// The world beneath the mod: a clock, a store over a Map, a WAD folder in
// memory (none unless the test puts one there), the pane list and the log.
function world(on: On, options: { wad?: boolean } = {}) {
  const files = new Map<string, string | { base64: string }>()
  const dirs = new Map<string, FsEntry[]>()
  if (options.wad) {
    const manifest = tinyManifest()
    const parts = tinyParts()
    dirs.set(WAD_ROOT, [{ name: 'tiny', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }])
    files.set(`${WAD_ROOT}/tiny/manifest.json`, JSON.stringify(manifest))
    parts.forEach((part, i) => files.set(`${WAD_ROOT}/tiny/${manifest.parts[i]!.file}`, { base64: base64Of(part) }))
  }
  const state = {
    store: new Map<string, unknown>(),
    logs: [] as string[],
    opened: [] as Record<string, unknown>[],
    closed: 0,
    blits: 0,
    panes: [] as UiPane[],
  }
  const clock = mock.clock(on, { now: T0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: 'C:/Users/test' }))
  // the engine hands the path on with the platform's separators
  const slashes = (path: string | undefined): string => (path ?? '').replace(/\\/g, '/')
  on('fs.list', ($, e) => {
    const entries = dirs.get(slashes(e.path))
    if (entries === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: entries }
  })
  on('fs.read', ($, e) => {
    const file = files.get(slashes(e.path))
    if (file === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: file }
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
  test('/doom with no prepared WAD opens the pane with the prepare hint', async ($, on) => {
    const { state } = world(on)
    await start($)
    const answer = await run($, '')
    expect(answer.text).toContain('no prepared WAD')
    expect(answer.text).toContain('prepare-wad.mjs')
    expect(state.opened).toHaveLength(1)
    expect(state.opened[0]?.focus).toBeUndefined()
    const ui = await $.ui.mount({ plugin: 'doom-pane', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: /No WAD found/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Raster' })).toHaveLength(0)
    await ui.unmount()
    const wads = await run($, 'wads')
    expect(wads.text).toContain('No prepared WAD')
  })

  test('/doom help lists the keys without touching the WAD folder', async ($, on) => {
    const { state } = world(on)
    await start($)
    const help = await run($, 'help')
    expect(help.text).toContain('w s forward/back')
    expect(state.opened).toHaveLength(0)
  })

  test('a prepared WAD is read in parts; a bad IWAD reports the engine exit and the pane says so', async ($, on) => {
    const { state } = world(on, { wad: true })
    await start($)
    const wads = await run($, 'wads')
    expect(wads.text).toContain('tiny.wad')
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
