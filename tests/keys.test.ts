import { describe, expect, test } from 'claude-code/testing'

import { BINDINGS, bindingOf, FIRST_HOLD_MS, KEYS, lapse, LEGEND, noHolds, press, releaseAll, REPEAT_HOLD_MS, TAP_MS } from '../hooks/keys'

const forward = bindingOf('w')!
const fire = bindingOf('f')!
const use = bindingOf('u')!

describe('bindings', () => {
  test('every hotkey is one lowercase letter or digit, used once', () => {
    const hotkeys = BINDINGS.map(b => b.hotkey)
    expect(new Set(hotkeys).size).toBe(hotkeys.length)
    for (const hotkey of hotkeys) expect(/^[a-z0-9]$/.test(hotkey)).toBe(true)
    expect(LEGEND).toHaveLength(3)
  })

  test('the movement keys are DOOM arrows, fire and use their own codes, the menu key is Escape', () => {
    expect(forward.key).toBe(KEYS.UP)
    expect(bindingOf('a')?.key).toBe(KEYS.LEFT)
    expect(fire.key).toBe(KEYS.FIRE)
    expect(use.key).toBe(KEYS.USE)
    expect(bindingOf('m')?.key).toBe(KEYS.ESCAPE)
    expect(bindingOf('r')?.key).toBe(KEYS.ENTER)
    expect(bindingOf('3')?.key).toBe('3'.charCodeAt(0))
    expect(bindingOf('x')).toBeUndefined()
  })
})

describe('holds', () => {
  test('a first press sends the key down and holds it past the repeat delay', () => {
    const first = press(noHolds, forward, 1000)
    expect(first.events).toEqual([{ pressed: true, key: KEYS.UP }])
    expect(lapse(first.holds, 1000 + FIRST_HOLD_MS - 1).events).toEqual([])
    const released = lapse(first.holds, 1000 + FIRST_HOLD_MS)
    expect(released.events).toEqual([{ pressed: false, key: KEYS.UP }])
    expect(released.holds.size).toBe(0)
  })

  test('a repeat extends the hold without a second key-down', () => {
    const first = press(noHolds, forward, 1000)
    const again = press(first.holds, forward, 1500)
    expect(again.events).toEqual([])
    expect(lapse(again.holds, 1500 + REPEAT_HOLD_MS - 1).events).toEqual([])
    expect(lapse(again.holds, 1500 + REPEAT_HOLD_MS).events).toEqual([{ pressed: false, key: KEYS.UP }])
  })

  test('a repeat that comes late, after the hold lapsed, is a new press', () => {
    const first = press(noHolds, forward, 1000)
    const lapsed = lapse(first.holds, 2000)
    expect(lapsed.events).toHaveLength(1)
    const again = press(lapsed.holds, forward, 2000)
    expect(again.events).toEqual([{ pressed: true, key: KEYS.UP }])
  })

  test('a tap stays down for a couple of tics only, even when repeated', () => {
    const tapped = press(noHolds, use, 1000)
    expect(tapped.events).toEqual([{ pressed: true, key: KEYS.USE }])
    expect(lapse(tapped.holds, 1000 + TAP_MS).events).toEqual([{ pressed: false, key: KEYS.USE }])
    const repeated = press(tapped.holds, use, 1010)
    expect(repeated.events).toEqual([])
    expect(lapse(repeated.holds, 1010 + TAP_MS).events).toHaveLength(1)
  })

  test('several keys lapse independently; releaseAll lets go of every one', () => {
    let holds = press(noHolds, forward, 1000).holds
    holds = press(holds, fire, 1200).holds
    const mid = lapse(holds, 1000 + FIRST_HOLD_MS)
    expect(mid.events).toEqual([{ pressed: false, key: KEYS.UP }])
    expect(mid.holds.has(KEYS.FIRE)).toBe(true)
    const all = releaseAll(mid.holds)
    expect(all.events).toEqual([{ pressed: false, key: KEYS.FIRE }])
    expect(all.holds.size).toBe(0)
    // nothing to release keeps the same map
    expect(lapse(all.holds, 9999).holds).toBe(all.holds)
  })
})
