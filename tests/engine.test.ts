import { describe, expect, test } from 'claude-code/testing'

import createDoom from '../hooks/engine/doomgeneric.js'
import { createGame, SAVE_DIR } from '../hooks/engine/driver'
import { tinyIwad } from './fixtures'

describe('the generated engine', () => {
  test('loads without a console or a DOM and exposes the bridge', async () => {
    const lines: string[] = []
    const module = await createDoom({ print: l => lines.push(l), printErr: l => lines.push(l) })
    expect(typeof module._doomgeneric_Create).toBe('function')
    expect(typeof module._doomgeneric_Tick).toBe('function')
    expect(module._DG_GetScreenWidth()).toBe(320)
    expect(module._DG_GetScreenHeight()).toBe(200)
    expect(module.dg).toMatchObject({ ticksMs: 0, keys: [], frameDirty: false, title: '', quitRequested: false })
    module.FS.writeFile('/x.bin', new Uint8Array([1, 2, 3]))
    expect([...module.FS.readFile('/x.bin')]).toEqual([1, 2, 3])
  })

  test('createGame mounts the WAD and the saves and reports the engine exit on a bad IWAD', async () => {
    const lines: string[] = []
    const saved: string[] = []
    const save = new Uint8Array([9, 9, 9])
    await expect(
      createGame(createDoom, 'tiny.wad', tinyIwad(), { 'doomsav0.dsg': save }, { log: l => lines.push(l), onSave: file => saved.push(file) }),
    ).rejects.toThrow('exited with status')
    expect(lines.some(line => /IWAD/i.test(line))).toBe(true)
    expect(saved).toEqual([])
    expect(SAVE_DIR).toBe('/.savegame')
  })
})
