// doom-pane's contract: the values the pane's drawing reads from `$.state`.
// The engine instance, the frame and the key holds are module state (lost on a
// hot reload, which the status line then says).

/** Where the game stands; `message` is for the person. */
export type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; wad: string }
  | { kind: 'running'; wad: string }
  | { kind: 'no-wad'; dir: string }
  | { kind: 'error'; message: string }
  | { kind: 'quit'; wad: string }

declare module 'claude-code' {
  interface PluginState {
    'doom-pane': {
      status: Status
    }
  }
}
