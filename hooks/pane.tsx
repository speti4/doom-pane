// The pane's tree: the Raster the game is blitted onto, a status line and the
// legend of hotkey Buttons (they must be in the tree for the hotkeys to work).
// Terminal only: the Raster is a fragment elsewhere, so a desktop gets a line.
import type { Elements } from 'claude-code'

import type { Status } from '../types'
import { LEGEND, type Binding } from './keys'
import type { ViewSize } from './view'

export type PaneEls = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Raster'>

export const RASTER_KEY = 'view'
/** Rows below the picture: the status line and the legend rows. */
export const CHROME_ROWS = LEGEND.length + 1

export type PaneModel = {
  status: Status
  view: ViewSize
  /** The Raster's cells for this draw (the game's frame, or blank). */
  cells: string
  isFocused: boolean
  title: string
  /** What to type to prepare a WAD, shown while none is found. */
  prepareHint: string
}

const MAUVE = '#cba6f7'
const RED = '#f38ba8'
const GREEN = '#a6e3a1'
const OVERLAY = '#6c7086'

function legend(els: PaneEls, onHotkey: (binding: Binding) => void) {
  const { Box, Button } = els
  return LEGEND.map((row, index) => (
    <Box key={`legend-${index}`} flexDirection="row" gap={1}>
      {row.map(binding => (
        <Button key={`key-${binding.hotkey}`} plain hotkey={binding.hotkey} label={binding.label} onPress={() => onHotkey(binding)} />
      ))}
    </Box>
  ))
}

function statusLine(els: PaneEls, model: PaneModel) {
  const { Text } = els
  const { status } = model
  switch (status.kind) {
    case 'running':
      return model.isFocused ? (
        <Text color={GREEN}>{model.title || status.wad}: playing. Esc hands the keys back and pauses.</Text>
      ) : (
        <Text color={MAUVE}>{model.title || status.wad}: paused. Click the pane (or ctrl+x, then tab) to play.</Text>
      )
    case 'loading':
      return <Text color={MAUVE}>Loading {status.wad}...</Text>
    case 'quit':
      return <Text color={MAUVE}>Quit {status.wad}. /doom new starts it again.</Text>
    case 'error':
      return <Text color={RED}>DOOM stopped: {status.message}. /doom new starts it again.</Text>
    case 'no-wad':
      return <Text color={RED}>No WAD found in {status.dir}.</Text>
    default:
      return <Text color={OVERLAY}>No game loaded (a reload drops it). Run /doom.</Text>
  }
}

/** The pane: the picture when a game runs, else what to do instead. */
export function drawPane(els: PaneEls, model: PaneModel, onHotkey: (binding: Binding) => void) {
  const { Box, Text, Raster } = els
  const { status, view } = model
  if (status.kind === 'no-wad') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {statusLine(els, model)}
        <Text>Prepare the shareware episode (downloads doom1.wad, 4 MB) or your own IWAD:</Text>
        <Text color={MAUVE}>{model.prepareHint}</Text>
        <Text dimColor>Then run /doom again.</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Raster key={RASTER_KEY} columns={view.columns} rows={view.rows} cells={model.cells} />
      <Box paddingX={1}>{statusLine(els, model)}</Box>
      <Box flexDirection="column" paddingX={1}>
        {legend(els, onHotkey)}
      </Box>
    </Box>
  )
}

/** The one line a surface without a Raster gets. */
export function drawElsewhere(els: Pick<Elements['desktop'], 'Text'>) {
  const { Text } = els
  return <Text dimColor>doom-pane draws in the terminal only (the picture is a Raster).</Text>
}
