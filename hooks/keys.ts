// Keys: the hotkey bindings the legend draws, their DOOM key codes, and the
// hold synthesizer. A terminal reports presses only (the OS key repeat re-sends
// a held key), so a press opens a hold window that each repeat extends and the
// tick closes with a release once it lapses. Pure: `now` comes in.

export type KeyEvent = { pressed: boolean; key: number }

/** DOOM key codes (doomkeys.h). */
export const KEYS = {
  UP: 0xad,
  DOWN: 0xaf,
  LEFT: 0xac,
  RIGHT: 0xae,
  STRAFE_L: 0xa0,
  STRAFE_R: 0xa1,
  USE: 0xa2,
  FIRE: 0xa3,
  ESCAPE: 27,
  ENTER: 13,
  TAB: 9,
  BACKSPACE: 0x7f,
  PAUSE: 0xff,
  RSHIFT: 0xb6,
} as const

export type Binding = {
  /** One lowercase letter or digit, as `Button hotkey` takes it. */
  hotkey: string
  /** The legend's label beside the hotkey. */
  label: string
  key: number
  /** `hold`: a movement-style key the repeat keeps down; `tap`: pressed and released. */
  mode: 'hold' | 'tap'
}

/** The legend rows: movement and action, menu, weapons. */
export const LEGEND: readonly (readonly Binding[])[] = [
  [
    { hotkey: 'w', label: 'fwd', key: KEYS.UP, mode: 'hold' },
    { hotkey: 's', label: 'back', key: KEYS.DOWN, mode: 'hold' },
    { hotkey: 'a', label: 'left', key: KEYS.LEFT, mode: 'hold' },
    { hotkey: 'd', label: 'right', key: KEYS.RIGHT, mode: 'hold' },
    { hotkey: 'q', label: 'strafe', key: KEYS.STRAFE_L, mode: 'hold' },
    { hotkey: 'e', label: 'strafe', key: KEYS.STRAFE_R, mode: 'hold' },
    { hotkey: 'f', label: 'fire', key: KEYS.FIRE, mode: 'hold' },
    { hotkey: 'u', label: 'use', key: KEYS.USE, mode: 'tap' },
  ],
  [
    { hotkey: 'm', label: 'menu', key: KEYS.ESCAPE, mode: 'tap' },
    { hotkey: 'r', label: 'enter', key: KEYS.ENTER, mode: 'tap' },
    { hotkey: 'b', label: 'back', key: KEYS.BACKSPACE, mode: 'tap' },
    { hotkey: 't', label: 'map', key: KEYS.TAB, mode: 'tap' },
    { hotkey: 'p', label: 'pause', key: KEYS.PAUSE, mode: 'tap' },
    { hotkey: 'y', label: 'yes', key: 'y'.charCodeAt(0), mode: 'tap' },
    { hotkey: 'n', label: 'no', key: 'n'.charCodeAt(0), mode: 'tap' },
  ],
  [
    { hotkey: '1', label: 'fist', key: '1'.charCodeAt(0), mode: 'tap' },
    { hotkey: '2', label: 'pistol', key: '2'.charCodeAt(0), mode: 'tap' },
    { hotkey: '3', label: 'shotgun', key: '3'.charCodeAt(0), mode: 'tap' },
    { hotkey: '4', label: 'chaingun', key: '4'.charCodeAt(0), mode: 'tap' },
    { hotkey: '5', label: 'rocket', key: '5'.charCodeAt(0), mode: 'tap' },
    { hotkey: '6', label: 'plasma', key: '6'.charCodeAt(0), mode: 'tap' },
    { hotkey: '7', label: 'bfg', key: '7'.charCodeAt(0), mode: 'tap' },
  ],
]

export const BINDINGS: readonly Binding[] = LEGEND.flat()

/** How long a first press stays down: past the OS repeat delay. */
export const FIRST_HOLD_MS = 550
/** How long each repeat extends the hold. */
export const REPEAT_HOLD_MS = 120
/** How long a tap stays down: a couple of tics, so the game sees it. */
export const TAP_MS = 60

/** Which keys are down, each with the time its hold lapses. */
export type Holds = ReadonlyMap<number, number>

export const noHolds: Holds = new Map()

export function bindingOf(hotkey: string): Binding | undefined {
  return BINDINGS.find(binding => binding.hotkey === hotkey)
}

/**
 * A hotkey press at `now`: a key not down goes down (an event) and gets its
 * window; one already down keeps it longer. A tap gets a short window either way.
 */
export function press(holds: Holds, binding: Binding, now: number): { holds: Holds; events: KeyEvent[] } {
  const next = new Map(holds)
  const isDown = next.has(binding.key)
  const window = binding.mode === 'tap' ? TAP_MS : isDown ? REPEAT_HOLD_MS : FIRST_HOLD_MS
  next.set(binding.key, now + window)
  return { holds: next, events: isDown ? [] : [{ pressed: true, key: binding.key }] }
}

/** Releases every hold that lapsed by `now`. */
export function lapse(holds: Holds, now: number): { holds: Holds; events: KeyEvent[] } {
  const events: KeyEvent[] = []
  let next: Map<number, number> | undefined
  for (const [key, until] of holds) {
    if (until > now) continue
    next ??= new Map(holds)
    next.delete(key)
    events.push({ pressed: false, key })
  }
  return { holds: next ?? holds, events }
}

/** Releases everything (the pane lost the keys). */
export function releaseAll(holds: Holds): { holds: Holds; events: KeyEvent[] } {
  const events = [...holds.keys()].map(key => ({ pressed: false, key }))
  return { holds: noHolds, events }
}
